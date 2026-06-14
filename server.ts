import express from "express";
import rateLimit from "express-rate-limit";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import Anthropic from "@anthropic-ai/sdk";
import dotenv from "dotenv";
import { buildStepContext, buildDMStepContext, buildDMIntegrationContext, uscsLoaded } from "./uscs";
import { makeThinkStripper, mistralTextContent, mistralHasThinking } from "./src/lib/reasoning";

dotenv.config();

// Build a log-safe summary of a provider/SDK error. A full error object can carry
// the request config — including the Authorization / x-api-key header that holds a
// visitor's key on a public BYOK deploy — so we never log it raw. Keep status +
// message only, and redact any key-shaped token a provider might echo back.
function safeErr(err: unknown): string {
  const e = err as any;
  const status = e?.status ?? e?.statusCode ?? e?.response?.status;
  let msg = typeof e === "string" ? e : (e?.message ?? String(e));
  msg = msg.replace(/\b(sk-[A-Za-z0-9_-]{8,}|AIza[A-Za-z0-9_-]{8,}|[A-Za-z0-9_-]{32,})\b/g, "[redacted]");
  return status ? `[${status}] ${msg}` : msg;
}

// Lazy initialization helpers
let anthropicClient: Anthropic | null = null;
function getAnthropic() {
  if (!anthropicClient) {
    let key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error("ANTHROPIC_API_KEY is not configured.");
    key = key.trim();
    anthropicClient = new Anthropic({ apiKey: key });
  }
  return anthropicClient;
}

// Normalize a Gemini-style chat history (+ the new user prompt) into a strictly
// ALTERNATING user/assistant message list. NOTE: as of 2026-06 every provider we
// call (Anthropic, Mistral, Gemini, OpenRouter, Ollama) was live-verified to
// TOLERATE non-alternating roles and empty turns — so this is DEFENSIVE/cleanup,
// not a guard against a current hard error. It still earns its keep: it strips
// empty turns (a failed/aborted generation or mid-stream drop leaves an empty
// assistant turn; once dropped, two user turns sit adjacent) and dedupes the
// five providers' identical role-mapping. It also protects against stricter
// older model snapshots / third-party OpenRouter models that historically 400'd
// or 422'd on non-alternating input. We drop empty turns, drop any leading
// assistant turn (the first message must be the user's), then MERGE consecutive
// same-role turns so the sequence always alternates. `assistantRole` is "model"
// for Gemini, "assistant" for every other provider.
function buildAlternatingMessages(
  history: any[] | undefined,
  prompt: string,
  assistantRole: "assistant" | "model" = "assistant"
): { role: "user" | "assistant" | "model"; content: string }[] {
  const raw = [
    ...(history || []).map((h: any) => ({
      role: (h.role === "model" || h.role === "assistant" ? assistantRole : "user") as
        "user" | "assistant" | "model",
      content: (h.parts?.[0]?.text || "").trim(),
    })),
    { role: "user" as const, content: (prompt || "").trim() },
  ].filter(m => m.content !== "");

  // The first message must come from the user.
  while (raw.length && raw[0].role === assistantRole) raw.shift();

  // Merge consecutive same-role turns so roles strictly alternate.
  const out: { role: "user" | "assistant" | "model"; content: string }[] = [];
  for (const m of raw) {
    const last = out[out.length - 1];
    if (last && last.role === m.role) last.content += "\n\n" + m.content;
    else out.push({ ...m });
  }
  return out;
}

// SSRF guard for the Ollama proxy. On a public deploy the server must not be
// usable to fetch arbitrary URLs (e.g. cloud metadata endpoints). Allow only
// loopback / private-LAN targets, which is all a real Ollama setup needs. A
// trusted self-host can opt out with OLLAMA_ALLOW_ANY=true.
function isPrivateOrLocalHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h === "host.docker.internal" || h === "::1") return true;
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const a = parseInt(m[1], 10), b = parseInt(m[2], 10);
    if (a === 127) return true;                       // loopback
    if (a === 10) return true;                         // 10.0.0.0/8
    if (a === 192 && b === 168) return true;           // 192.168.0.0/16
    if (a === 172 && b >= 16 && b <= 31) return true;  // 172.16.0.0/12
    return false;                                      // public, 169.254.x metadata, etc.
  }
  return false; // non-literal hostnames are not allowed by default
}
// The Ollama proxy lets the server make a request to a user-named host, which is
// an SSRF vector on a PUBLIC deploy. Enable it only where Ollama is genuinely
// used: local dev, or any deploy where the operator explicitly opted in by
// setting OLLAMA_BASE_URL or OLLAMA_ALLOW_ANY. A public box (e.g. Render) sets
// neither, so the proxy is inert there and cannot be abused by strangers.
function ollamaEnabled(): boolean {
  return process.env.NODE_ENV !== "production"
    || !!process.env.OLLAMA_BASE_URL?.trim()
    || process.env.OLLAMA_ALLOW_ANY === "true";
}

// Validate a (user- or operator-supplied) Ollama base URL and return a SAFE,
// fully reconstructed target for a FIXED path (e.g. "/api/chat"), or null if the
// base is not an allowed local/private http(s) address. We rebuild the URL from
// the parsed origin + a server-controlled path — never the raw string — so user
// input cannot smuggle in path traversal, query, fragment or credential tricks.
function buildOllamaTarget(rawBase: string, path: string): string | null {
  let u: URL;
  try { u = new URL(rawBase); } catch { return null; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null; // no file:/gopher:/etc.
  if (u.username || u.password) return null;                          // no embedded credentials
  if (process.env.OLLAMA_ALLOW_ANY !== "true" && !isPrivateOrLocalHost(u.hostname)) return null;
  return new URL(path, `${u.protocol}//${u.host}`).href;
}

async function startServer() {
  const app = express();
  // Render and most PaaS hosts put the app behind exactly one reverse-proxy hop.
  // Trust that single hop so the rate limiter (and req.ip) reads the real client
  // IP from X-Forwarded-For instead of lumping every visitor under the proxy IP.
  // A specific hop count (1) is safer than `true`, which would let clients spoof
  // their IP to dodge the limiter.
  app.set("trust proxy", 1);
  // Docker (NODE_ENV=production) listens on 3000 inside the container, which
  // docker-compose maps to host 3010. Local dev also uses 3010 so the app is
  // always reachable at localhost:3010 and never collides with Open WebUI on 3000.
  // Override with the PORT env var if needed.
  const PORT = Number(process.env.PORT) || (process.env.NODE_ENV === "production" ? 3000 : 3010);

  // Default body limit is 100kb — far too small here: every /api/assistant
  // request carries the full chat history + deskstate + captured deliverables
  // (Prompt Plot, Guidelines, character sheets, etc.), which easily exceeds
  // 100kb on a deep story and 413s ("PayloadTooLargeError"). 25mb is plenty.
  app.use(express.json({ limit: "25mb" }));

  // Basic denial-of-service guard (CWE-770 / CodeQL js/missing-rate-limiting):
  // cap requests per client IP across every route — the static file server and
  // the proxy/AI endpoints all do expensive work (disk reads, outbound calls).
  // The ceiling is generous (AI turns are slow and few per user) but stops floods.
  app.use(rateLimit({
    windowMs: 60_000, // 1 minute
    max: 300,         // 300 requests / minute / IP
    standardHeaders: true,
    legacyHeaders: false,
  }));

  // Configuration endpoint to expose server-side environment defaults
  app.get("/api/config", (req, res) => {
    res.json({
      ollamaBaseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
      uscsLoaded: uscsLoaded()
    });
  });

  // List currently-available models for a hosted provider, using the user's key
  // (falls back to the server env key). Lets the UI show real, up-to-date models
  // instead of a hardcoded list that drifts out of date.
  app.get("/api/models", async (req, res) => {
    const provider = (req.query.provider as string) || "gemini";
    const key = (req.query.key as string)?.trim();

    try {
      if (provider === "anthropic") {
        const apiKey = key || process.env.ANTHROPIC_API_KEY;
        if (!apiKey) return res.status(400).json({ error: "No Anthropic API key available." });
        const client = new Anthropic({ apiKey });
        const list = await client.models.list({ limit: 100 });
        const models = (list.data || []).map((m: any) => m.id);
        return res.json({ models });
      }

      if (provider === "gemini") {
        const apiKey = key || process.env.GEMINI_API_KEY;
        if (!apiKey) return res.status(400).json({ error: "No Gemini API key available." });
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 6000);
        const r = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}&pageSize=200`,
          { signal: controller.signal }
        );
        clearTimeout(timeoutId);
        if (!r.ok) throw new Error(`Gemini models list returned status ${r.status}`);
        const data = (await r.json()) as any;
        const models = (data.models || [])
          .filter((m: any) => (m.supportedGenerationMethods || []).includes("generateContent"))
          .map((m: any) => (m.name || "").replace(/^models\//, ""))
          .filter(Boolean);
        return res.json({ models });
      }

      if (provider === "openrouter") {
        // OpenRouter's model list is public; the key is optional for listing.
        const apiKey = key || process.env.OPENROUTER_API_KEY;
        const headers: Record<string, string> = {};
        if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 6000);
        const r = await fetch("https://openrouter.ai/api/v1/models", { headers, signal: controller.signal });
        clearTimeout(timeoutId);
        if (!r.ok) throw new Error(`OpenRouter models list returned status ${r.status}`);
        const data = (await r.json()) as any;
        const models = (data.data || [])
          .map((m: any) => m.id)
          .filter(Boolean)
          // Surface free models first so they're easy to find.
          .sort((a: string, b: string) => Number(b.endsWith(":free")) - Number(a.endsWith(":free")));
        return res.json({ models });
      }

      if (provider === "mistral") {
        const apiKey = key || process.env.MISTRAL_API_KEY;
        if (!apiKey) return res.status(400).json({ error: "No Mistral API key available." });
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 6000);
        const r = await fetch("https://api.mistral.ai/v1/models", {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        if (!r.ok) throw new Error(`Mistral models list returned status ${r.status}`);
        const data = (await r.json()) as any;
        // Mistral's /v1/models returns EVERY model on the account — including
        // non-chat ones (moderation, embeddings, OCR) that 400 on a chat call —
        // and lists alias ids as separate objects (so the same id appears twice).
        // Keep only chat-capable models (capabilities.completion_chat, lenient if
        // absent) and dedup, so the dropdown can't offer a foot-gun like
        // mistral-moderation-latest or show duplicate rows.
        const seen = new Set<string>();
        const models = (data.data || [])
          .filter((m: any) => m?.id && m?.capabilities?.completion_chat !== false)
          .map((m: any) => m.id as string)
          .filter((id: string) => (seen.has(id) ? false : (seen.add(id), true)))
          .sort();
        return res.json({ models });
      }

      return res.status(400).json({ error: "Model listing is not supported for this provider." });
    } catch (err: any) {
      console.info("Could not list %s models:", provider, err.message || err);
      return res.status(500).json({ error: err.message || String(err) });
    }
  });

  // Endpoint to fetch available models from local Ollama instance
  app.get("/api/ollama/models", async (req, res) => {
    if (!ollamaEnabled()) {
      return res.status(403).json({ error: "The Ollama provider is disabled on this server. It is available when self-hosting (set OLLAMA_BASE_URL or OLLAMA_ALLOW_ANY)." });
    }
    const rawBase = (req.query.url as string)?.trim() || process.env.OLLAMA_BASE_URL?.trim() || "http://localhost:11434";
    const target = buildOllamaTarget(rawBase, "/api/tags");
    if (!target) {
      return res.status(400).json({ error: "Ollama URL must be a local or private-network http(s) address." });
    }

    try {
      console.log("Checking local Ollama models on: %s", target);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000); // 4 second timeout for local lookup

      const response = await fetch(target, {
        signal: controller.signal,
        redirect: "error", // a private host must not 302-bounce us to a public/metadata target
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Ollama returned status ${response.status}`);
      }

      const data = await response.json() as any;
      const models = (data.models || []).map((m: any) => m.name);
      return res.json({ models });
    } catch (err: any) {
      console.info("Could not connect to Ollama at %s to fetch models:", target, err.message || err);
      return res.status(500).json({ error: `Connection failed: ${err.message || err}` });
    }
  });

  // Unified API Route for AI assistance
  // Assemble the Ollama chat payload (system prompt with the verbatim USCS step
  // slice injected, alternating messages, and a fitted context window) WITHOUT
  // calling any model. This lets the BROWSER stream from a visitor's OWN local
  // Ollama directly (their hardware) while the server still owns the USCS prompt
  // assembly — the visitor's machine is unreachable from the server, so the
  // inference itself must happen client-side. No provider keys are involved.
  app.post("/api/assistant/prepare", (req, res) => {
    try {
      const { prompt, history, systemInstruction, modelSettings, step, dmStep, combinedReview } = req.body;
      const settings = modelSettings || {};
      const uscsContext = combinedReview === true
        ? buildDMIntegrationContext()
        : typeof dmStep === "number" && dmStep >= 0
        ? buildDMStepContext(dmStep)
        : buildStepContext(typeof step === "number" ? step : 0);
      const fullSystem = `${uscsContext}\n\n${systemInstruction || ""}`.trim();

      const messages: any[] = [];
      if (fullSystem) messages.push({ role: "system", content: fullSystem });
      messages.push(...buildAlternatingMessages(history, prompt));

      // Size num_ctx to fit the prompt + reply headroom (mirrors the server-side
      // Ollama bridge), so a visitor's local model doesn't silently truncate the
      // injected USCS sections at Ollama's 4,096-token default.
      const approxPromptChars = fullSystem.length + messages.reduce((n: number, m: any) => n + (m.content?.length || 0), 0);
      const approxPromptTokens = Math.ceil(approxPromptChars / 4);
      const replyHeadroom = Math.min(settings.maxTokens || 2048, 4096);
      const numCtx = Math.min(32768, Math.max(4096, approxPromptTokens + replyHeadroom + 512));

      res.json({ messages, numCtx });
    } catch (err: any) {
      res.status(500).json({ error: safeErr(err) });
    }
  });

  app.post("/api/assistant", async (req, res) => {
    try {
      const { prompt, history, systemInstruction, provider, modelSettings, step, dmStep, combinedReview } = req.body;

      const aiProvider = provider || "gemini";
      const settings = modelSettings || {};

      // Assemble the system prompt server-side: the always-on USCS core directive
      // plus ONLY the verbatim slice of the master document for the current step,
      // followed by the client-supplied dynamic context (live deskstate + the
      // real-time [SET_*] UI-sync command protocol). On a Dungeon Mind step
      // (dmStep >= 0) we inject Section 27 instead of the story-step slice.
      const uscsContext = combinedReview === true
        ? buildDMIntegrationContext()
        : typeof dmStep === "number" && dmStep >= 0
        ? buildDMStepContext(dmStep)
        : buildStepContext(typeof step === "number" ? step : 0);
      const fullSystem = `${uscsContext}\n\n${systemInstruction || ""}`.trim();

      // --- Prompt caching prep (Anthropic) ---------------------------------
      // Caching keys on an EXACT prefix match: the stable bytes must come first,
      // the volatile bytes last, with the cache breakpoint between them. The
      // client's systemInstruction is laid out as [live deskstate] + [fixed
      // UI/capture/length protocols]; the deskstate changes as the story's
      // parameters evolve, so if it stayed in the prefix the cache would be
      // invalidated almost every turn. We split on the protocol-section marker
      // and reassemble as: STABLE (USCS step text + fixed protocols) → break →
      // VOLATILE (live deskstate). Falls back to caching the whole prompt if the
      // marker is absent.
      const SYNC_SECTION_MARKER = "================================================================================\nREAL-TIME UI SYNCHRONIZATION COMMANDS";
      let cacheStableSystem = fullSystem;
      let cacheVolatileSystem = "";
      {
        const si = systemInstruction || "";
        const markerIdx = si.indexOf(SYNC_SECTION_MARKER);
        if (markerIdx > -1) {
          const deskstate = si.slice(0, markerIdx).trim(); // volatile (per-turn)
          const protocols = si.slice(markerIdx).trim();    // stable (fixed)
          cacheStableSystem = `${uscsContext}\n\n${protocols}`.trim();
          cacheVolatileSystem = deskstate;
        }
      }

      // --- Streaming plumbing ----------------------------------------------
      // Chat turns request stream:true to surface tokens as they arrive (long
      // deliverables otherwise sit on a spinner for many seconds). Export and
      // other machine calls omit the flag and get the legacy JSON response.
      // Wire format: Server-Sent Events — {delta} per chunk, then a terminal
      // {done, truncated, usage}. Errors BEFORE any byte streams are returned as
      // a normal JSON error (client checks res.ok); errors mid-stream are sent
      // as an {error} event.
      const wantStream = req.body?.stream === true;
      let sseOpen = false;
      const sseInit = () => {
        if (sseOpen) return;
        res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache, no-transform");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("X-Accel-Buffering", "no"); // disable proxy buffering (nginx/Render)
        (res as any).flushHeaders?.();
        sseOpen = true;
      };
      const sseSend = (obj: any) => { res.write(`data: ${JSON.stringify(obj)}\n\n`); };
      const sseDelta = (t: string) => { if (t) { sseInit(); sseSend({ delta: t }); } };
      const sseDone = (truncated: boolean, usage?: any) => { sseInit(); sseSend({ done: true, truncated, usage }); res.end(); };
      // Pre-stream errors -> JSON (works for both modes since client checks res.ok
      // before reading the body); mid-stream errors -> SSE error event.
      const failOut = (status: number, message: string) => {
        if (sseOpen) { sseSend({ error: message }); res.end(); }
        else res.status(status).json({ error: message });
      };

      if (aiProvider === "gemini") {
        const apiKey = settings.geminiApiKey?.trim() || process.env.GEMINI_API_KEY;
        if (!apiKey) return res.status(500).json({ error: "GEMINI_API_KEY is not configured. Please supply an API key in the Model Settings menu." });

        try {
          const ai = new GoogleGenAI({ 
            apiKey,
            httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
          });

          const modelName = settings.model || "gemini-2.5-flash";
          
          // Format history for generateContent (Gemini uses the "model" role and
          // a parts[] shape). Normalized to strictly alternate user/model.
          const contents = buildAlternatingMessages(history, prompt, "model")
            .map(m => ({ role: m.role, parts: [{ text: m.content }] }));

          const geminiConfig = {
            systemInstruction: fullSystem || "You are a professional creative writing collaborator.",
            temperature: settings.temperature ?? 1,
            topP: settings.topP,
            topK: settings.topK,
            maxOutputTokens: settings.maxTokens || 2048,
          };

          if (wantStream) {
            const stream = await ai.models.generateContentStream({ model: modelName, contents, config: geminiConfig });
            let truncated = false;
            let any = false;
            for await (const chunk of stream) {
              const t = chunk.text;
              if (t) { any = true; sseDelta(t); }
              if ((chunk as any)?.candidates?.[0]?.finishReason === "MAX_TOKENS") truncated = true;
            }
            if (!any) throw new Error("Empty response from Gemini");
            console.log("Gemini stream complete with model: %s (truncated:%s)", modelName, truncated);
            return sseDone(truncated);
          }

          const result = await ai.models.generateContent({ model: modelName, contents, config: geminiConfig });

          const text = result.text;
          if (!text) throw new Error("Empty response from Gemini");
          const truncated = (result as any)?.candidates?.[0]?.finishReason === "MAX_TOKENS";
          return res.json({ text, truncated });
        } catch (geminiErr: any) {
          console.error("Gemini model call failed:", safeErr(geminiErr));
          const errorDetail = geminiErr.message || JSON.stringify(geminiErr);
          let errorMsg = `Gemini API error: ${errorDetail}`;
          
          if (errorDetail.includes("API_KEY_INVALID") || errorDetail.includes("invalid api key") || errorDetail.includes("key is invalid") || errorDetail.includes("API key not valid")) {
            errorMsg = "Your Gemini API key is invalid. Please verify and update it in your Model Settings panel.";
          } else if (errorDetail.includes("quota") || errorDetail.includes("limit exceeded") || errorDetail.includes("429")) {
            errorMsg = "Your Gemini API quota has been exceeded or rate limit hit. (Error 429: Rate Limit/Quota Exceeded)";
          } else if (errorDetail.includes("not found") || errorDetail.includes("model not found") || errorDetail.includes("404")) {
            errorMsg = `The selected Gemini model '${settings.model || "gemini-2.5-flash"}' was not found, or the API key lacks access. Check your Model Settings.`;
          }

          return failOut(400, errorMsg);
        }
      } 
      
      if (aiProvider === "anthropic") {
        const anthropicApiKey = settings.anthropicApiKey?.trim() || process.env.ANTHROPIC_API_KEY;
        if (!anthropicApiKey) return res.status(500).json({ error: "ANTHROPIC_API_KEY is not configured. Please supply your API key in the Model Settings menu." });

        const anthropic = new Anthropic({ apiKey: anthropicApiKey });
        
        // Convert history for Anthropic (requires strictly user/assistant alternating).
        const messages = buildAlternatingMessages(history, prompt) as Anthropic.MessageParam[];

        // claude-3-5-haiku-20241022 or other models might not be available in all regions or accounts yet.
        // We compile a fallback list of models to try in sequence if a 404 error is encountered.
        let requestedModel = settings.model || "claude-3-5-sonnet-20241022";
        if (requestedModel === "claude-3-5-sonnet-latest") {
          requestedModel = "claude-3-5-sonnet-20241022";
        } else if (requestedModel === "claude-3-5-haiku-latest") {
          requestedModel = "claude-3-5-haiku-20241022";
        } else if (requestedModel === "claude-3-opus-latest") {
          requestedModel = "claude-3-opus-20240229";
        }

        const modelsToTry = [requestedModel];
        if (requestedModel !== "claude-3-5-sonnet-20241022") modelsToTry.push("claude-3-5-sonnet-20241022");
        if (requestedModel !== "claude-3-5-sonnet-20240620") modelsToTry.push("claude-3-5-sonnet-20240620");
        if (requestedModel !== "claude-3-haiku-20240307") modelsToTry.push("claude-3-haiku-20240307");

        // Structured system prompt: cache the large STABLE prefix (USCS step text
        // + fixed protocols) with an ephemeral breakpoint; the VOLATILE deskstate
        // follows uncached. Repeat turns reuse the cached prefix at ~10% of the
        // input cost (cache_read) instead of paying full price every message.
        const systemBlocks: Anthropic.TextBlockParam[] = [
          { type: "text", text: cacheStableSystem, cache_control: { type: "ephemeral" } },
        ];
        if (cacheVolatileSystem) {
          systemBlocks.push({ type: "text", text: cacheVolatileSystem });
        }

        let response = null;
        let lastError = null;

        try {
          if (wantStream) {
            let wroteAny = false;
            let streamTruncated = false;
            let streamUsage: any = undefined;
            let streamed = false;
            for (const candidateModel of modelsToTry) {
              try {
                console.log("Attempting Anthropic stream with model: %s", candidateModel);
                const astream = anthropic.messages.stream({
                  model: candidateModel,
                  max_tokens: settings.maxTokens || 4096,
                  temperature: settings.temperature ?? 1,
                  system: systemBlocks,
                  messages: messages,
                });
                astream.on("text", (t: string) => { if (t) { wroteAny = true; sseDelta(t); } });
                const finalMsg = await astream.finalMessage();
                streamTruncated = finalMsg.stop_reason === "max_tokens";
                const fu = finalMsg.usage;
                streamUsage = fu ? {
                  input: fu.input_tokens,
                  output: fu.output_tokens,
                  cacheRead: fu.cache_read_input_tokens ?? 0,
                  cacheWrite: fu.cache_creation_input_tokens ?? 0,
                } : undefined;
                console.log("Anthropic stream complete with model: %s (in:%d out:%d truncated:%s)", candidateModel, fu?.input_tokens ?? 0, fu?.output_tokens ?? 0, streamTruncated);
                streamed = true;
                break;
              } catch (err: any) {
                console.warn("Stream failed with Anthropic model %s:", candidateModel, safeErr(err));
                lastError = err;
                if (wroteAny) throw err; // already streaming this model — cannot fall back mid-stream
                continue;
              }
            }
            if (!streamed) throw lastError || new Error("All candidate Anthropic models failed.");
            return sseDone(streamTruncated, streamUsage);
          }

          for (const candidateModel of modelsToTry) {
            try {
              console.log("Attempting Anthropic message generation with model: %s", candidateModel);
              response = await anthropic.messages.create({
                model: candidateModel,
                max_tokens: settings.maxTokens || 4096,
                temperature: settings.temperature ?? 1,
                system: systemBlocks,
                messages: messages,
              });
              console.log("Success with Anthropic model: %s", candidateModel);
              break; // Successfully got response
            } catch (err: any) {
              console.warn("Failed with Anthropic model %s:", candidateModel, safeErr(err));
              lastError = err;
              continue; // Try the next available candidate model in the sequence
            }
          }

          if (!response) {
            throw lastError || new Error("All candidate Anthropic models failed.");
          }

          const text = response.content[0].type === 'text' ? response.content[0].text : '';
          if (!text) throw new Error("Empty response from Anthropic");
          const truncated = response.stop_reason === "max_tokens";
          // Surface cache telemetry so the UI can show a hit indicator.
          const u = response.usage;
          const usage = u ? {
            input: u.input_tokens,
            output: u.output_tokens,
            cacheRead: u.cache_read_input_tokens ?? 0,
            cacheWrite: u.cache_creation_input_tokens ?? 0,
          } : undefined;
          return res.json({ text, truncated, usage });
        } catch (anthropicErr: any) {
          console.error("Anthropic failed completely:", safeErr(anthropicErr));
          
          const errorDetail = anthropicErr.message || JSON.stringify(anthropicErr);
          const statusCode = anthropicErr.status || anthropicErr.statusCode;
          
          let errorMsg = `Anthropic error: ${errorDetail}`;
          if (statusCode === 401 || errorDetail.includes("invalid x-api-key") || errorDetail.includes("401")) {
            errorMsg = "Your Anthropic API Key is invalid or expired. Please check your credentials in the Model Settings menu.";
          } else if (statusCode === 403 || errorDetail.includes("credit_limit") || errorDetail.includes("403")) {
            errorMsg = "Your Anthropic account has run out of credits or has hit its billing limit. Please verify your balance.";
          } else if (statusCode === 503 || errorDetail.includes("503") || errorDetail.includes("high demand") || errorDetail.includes("overloaded")) {
            errorMsg = "Anthropic's servers are currently experiencing high demand (503 Service Unavailable). Please retry shortly.";
          } else if (statusCode === 429 || errorDetail.includes("429") || errorDetail.includes("rate limit")) {
            errorMsg = "Anthropic rate limit has been exceeded (429 Rate Limit). Please wait a bit and try again.";
          } else if (statusCode === 404 || errorDetail.includes("404") || errorDetail.includes("not found") || errorDetail.includes("not_found")) {
            errorMsg = `Anthropic API returned a 404 Model Not Found error for '${requestedModel}'. This is common with brand new Anthropic accounts or keys without funds (Anthropic restricts access to Claude models and throws 404 until you have topped up the account balance with a minimum deposit, e.g., $5). Code: ${statusCode}`;
          }

          // No silent provider switching. Return the precise Anthropic error so
          // the user can act on it. (This previously rerouted to Gemini and
          // injected a "[SYSTEM NOTICE …]" string into the story text, which
          // could end up polluting exported deliverables — removed.)
          return failOut(400, errorMsg);
        }
      }

      if (aiProvider === "ollama") {
        if (!ollamaEnabled()) {
          return res.status(403).json({ error: "The Ollama provider is disabled on this server (public deploy). Run the app locally or set OLLAMA_BASE_URL / OLLAMA_ALLOW_ANY to use local models." });
        }
        const rawBase = settings.ollamaBaseUrl?.trim() || process.env.OLLAMA_BASE_URL?.trim() || "http://localhost:11434";
        const target = buildOllamaTarget(rawBase, "/api/chat");
        if (!target) {
          return res.status(400).json({ error: "Ollama URL must be a local or private-network http(s) address (set OLLAMA_ALLOW_ANY=true to override on a trusted self-host)." });
        }

        const modelName = settings.model || "llama3";

        // Format history for Ollama /api/chat (system first, then alternating turns).
        const messages: any[] = [];
        if (fullSystem) messages.push({ role: "system", content: fullSystem });
        messages.push(...buildAlternatingMessages(history, prompt));

        try {
          console.log("Forwarding request to Ollama at %s with model %s", target, modelName);
          // Ollama defaults to a 4,096-token context. Our system prompts inject
          // verbatim USCS sections (a DM step is ~4,400 tokens on its own), so the
          // default would SILENTLY TRUNCATE the prompt — the model then receives a
          // mangled instruction and emits garbage (e.g. a lone "["). Size num_ctx to
          // fit the real prompt plus headroom for the reply (~4 chars/token est),
          // clamped so we never allocate an absurd KV cache.
          const approxPromptChars = (fullSystem?.length || 0) + messages.reduce((n: number, m: any) => n + (m.content?.length || 0), 0);
          const approxPromptTokens = Math.ceil(approxPromptChars / 4);
          const replyHeadroom = Math.min(settings.maxTokens || 2048, 4096);
          const num_ctx = Math.min(32768, Math.max(4096, approxPromptTokens + replyHeadroom + 512));
          // Build the request body. `think: false` tells hybrid reasoning models
          // (qwen3, deepseek-r1, gpt-oss…) to answer DIRECTLY instead of spending
          // the whole token budget in a `message.thinking` stream we don't read —
          // otherwise `message.content` comes back empty and we'd report a bogus
          // "empty response". Pass `think === undefined` to omit the field entirely.
          const ollamaBody = (think?: boolean) => JSON.stringify({
            model: modelName,
            messages: messages,
            stream: wantStream,
            ...(think === undefined ? {} : { think }),
            options: {
              temperature: settings.temperature ?? 1.0,
              num_predict: settings.maxTokens || 4096,
              num_ctx
            }
          });
          const postOllama = (think?: boolean) => fetch(target, {
            method: "POST",
            redirect: "error", // a private host must not 302-bounce us to a public/metadata target
            headers: { "Content-Type": "application/json" },
            body: ollamaBody(think)
          });

          let response = await postOllama(false);
          if (!response.ok) {
            const errorText = await response.text();
            // Pure (non-hybrid) models reject the `think` field — retry without it.
            if (/think/i.test(errorText)) {
              response = await postOllama(undefined);
              if (!response.ok) {
                const e2 = await response.text();
                throw new Error(`Ollama returned status ${response.status}: ${e2 || response.statusText}`);
              }
            } else {
              throw new Error(`Ollama returned status ${response.status}: ${errorText || response.statusText}`);
            }
          }

          if (wantStream && response.body) {
            // Ollama streams newline-delimited JSON: {message:{content,thinking},done,done_reason}
            const reader = (response.body as any).getReader();
            const decoder = new TextDecoder();
            // `think:false` routes reasoning into message.thinking (skipped below),
            // but some local models still leak inline <think>…</think> into content.
            const stripper = makeThinkStripper();
            let buf = "";
            let truncated = false;
            let any = false;
            let thoughtOnly = false; // model emitted reasoning but never a final answer
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              buf += decoder.decode(value, { stream: true });
              let nl: number;
              while ((nl = buf.indexOf("\n")) >= 0) {
                const line = buf.slice(0, nl).trim();
                buf = buf.slice(nl + 1);
                if (!line) continue;
                let obj: any;
                try { obj = JSON.parse(line); } catch { continue; }
                const t = obj?.message?.content;
                if (t) { any = true; const out = stripper.push(t); if (out) sseDelta(out); }
                else if (obj?.message?.thinking) thoughtOnly = true;
                if (obj?.done && obj?.done_reason === "length") truncated = true;
              }
            }
            const tail = stripper.flush();
            if (tail) sseDelta(tail);
            if (!any) {
              throw new Error(thoughtOnly
                ? "The model returned only reasoning and no final answer — it likely ran out of context while 'thinking'. Try a non-reasoning model, or raise the model's context length."
                : "Empty response from Ollama");
            }
            console.log("Ollama stream complete with model: %s (truncated:%s)", modelName, truncated);
            return sseDone(truncated);
          }

          const responseData = (await response.json()) as any;
          const rawText = responseData?.message?.content;

          if (!rawText) {
            throw new Error(responseData?.message?.thinking
              ? "The model returned only reasoning and no final answer — it likely ran out of context while 'thinking'. Try a non-reasoning model, or raise the model's context length."
              : `No content from Ollama response: ${JSON.stringify(responseData)}`);
          }

          // Strip leaked inline reasoning; fall back to raw if the reply was pure reasoning.
          const stripper = makeThinkStripper();
          const text = (stripper.push(rawText) + stripper.flush()).trim() || rawText;

          const truncated = responseData?.done_reason === "length";
          return res.json({ text, truncated });
        } catch (ollamaErr: any) {
          console.error("Local Ollama bridge failed:", safeErr(ollamaErr));
          return failOut(500, `Could not connect to Ollama at ${target}. Error details: ${ollamaErr.message || ollamaErr}. Please verify that Ollama is running ('ollama serve') and accessible from the container.`);
        }
      }

      if (aiProvider === "openrouter") {
        const apiKey = settings.openRouterApiKey?.trim() || process.env.OPENROUTER_API_KEY;
        if (!apiKey) return res.status(500).json({ error: "OpenRouter API key is not configured. Add a free key from openrouter.ai/keys in the Model Settings menu." });

        const modelName = settings.model || "deepseek/deepseek-chat-v3-0324:free";

        // OpenRouter uses the OpenAI chat-completions shape.
        const messages: any[] = [];
        if (fullSystem) messages.push({ role: "system", content: fullSystem });
        messages.push(...buildAlternatingMessages(history, prompt));

        // Inactivity watchdog: OpenRouter sometimes holds a socket open with no
        // bytes (the "empty response" case) or stalls mid-stream. Without this the
        // server's own fetch/reader.read() would block until OpenRouter eventually
        // closes — keeping the client waiting too. Abort after a stretch of complete
        // silence; reset on every chunk so long generations aren't killed.
        const orController = new AbortController();
        const OR_STALL_MS = 300_000;
        let orWatchdog: ReturnType<typeof setTimeout> = setTimeout(() => orController.abort(), OR_STALL_MS);
        const bumpOr = () => { clearTimeout(orWatchdog); orWatchdog = setTimeout(() => orController.abort(), OR_STALL_MS); };

        try {
          console.log("Forwarding request to OpenRouter with model %s", modelName);
          const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${apiKey}`,
              // Optional attribution headers used by OpenRouter for app ranking.
              "HTTP-Referer": process.env.APP_URL || "http://localhost:3000",
              "X-Title": "Aether_Core USCS"
            },
            body: JSON.stringify({
              model: modelName,
              messages,
              temperature: settings.temperature ?? 1,
              max_tokens: settings.maxTokens || 4096,
              stream: wantStream
            }),
            signal: orController.signal
          });
          bumpOr(); // headers arrived — reset the clock for the stream body

          if (!response.ok) {
            const errorText = await response.text();
            let msg = `OpenRouter returned status ${response.status}: ${errorText || response.statusText}`;
            if (response.status === 401) {
              msg = "Your OpenRouter API key is invalid or missing. Get a free key at openrouter.ai/keys and add it in Model Settings.";
            } else if (response.status === 402) {
              msg = `The model '${modelName}' requires credits your OpenRouter account doesn't have. Pick a model tagged ':free', or add credits at openrouter.ai.`;
            } else if (response.status === 429) {
              msg = "OpenRouter rate limit reached (free models are rate-limited). Wait a moment, or switch to another model.";
            }
            throw new Error(msg);
          }

          if (wantStream && response.body) {
            // OpenRouter streams OpenAI-style SSE: "data: {choices:[{delta:{content}}]}" lines, ending with "data: [DONE]".
            const reader = (response.body as any).getReader();
            const decoder = new TextDecoder();
            // OpenRouter usually splits reasoning into a separate `reasoning`
            // field we ignore, but many free DeepSeek-R1 / QwQ / Qwen3 models
            // leak inline <think>…</think> into content — strip it.
            const stripper = makeThinkStripper();
            let buf = "";
            let truncated = false;
            let rawAny = false;
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              bumpOr();
              buf += decoder.decode(value, { stream: true });
              let nl: number;
              while ((nl = buf.indexOf("\n")) >= 0) {
                const line = buf.slice(0, nl).trim();
                buf = buf.slice(nl + 1);
                if (!line.startsWith("data:")) continue;
                const data = line.slice(5).trim();
                if (!data || data === "[DONE]") continue;
                let obj: any;
                try { obj = JSON.parse(data); } catch { continue; }
                const t = obj?.choices?.[0]?.delta?.content;
                if (t) { rawAny = true; const out = stripper.push(t); if (out) sseDelta(out); }
                if (obj?.choices?.[0]?.finish_reason === "length") truncated = true;
              }
            }
            const tail = stripper.flush();
            if (tail) sseDelta(tail);
            if (!rawAny) throw new Error("Empty response from OpenRouter (the model may have returned nothing — try another model).");
            console.log("OpenRouter stream complete with model: %s (truncated:%s)", modelName, truncated);
            return sseDone(truncated);
          }

          const responseData = (await response.json()) as any;
          const rawText = responseData?.choices?.[0]?.message?.content;

          if (!rawText) {
            throw new Error(`No content from OpenRouter response: ${JSON.stringify(responseData)}`);
          }

          // Strip inline reasoning traces; fall back to raw if the reply was pure reasoning.
          const stripper = makeThinkStripper();
          const text = (stripper.push(rawText) + stripper.flush()).trim() || rawText;

          const truncated = responseData?.choices?.[0]?.finish_reason === "length";
          return res.json({ text, truncated });
        } catch (orErr: any) {
          console.error("OpenRouter bridge failed:", safeErr(orErr));
          const msg = orErr?.name === "AbortError"
            ? "OpenRouter stopped responding (the connection stalled with no data). Try again, or switch to another model."
            : (orErr.message || String(orErr));
          return failOut(400, msg);
        } finally {
          clearTimeout(orWatchdog);
        }
      }

      if (aiProvider === "mistral") {
        const apiKey = settings.mistralApiKey?.trim() || process.env.MISTRAL_API_KEY;
        if (!apiKey) return res.status(500).json({ error: "Mistral API key is not configured. Add a free key from console.mistral.ai in the Model Settings menu." });

        const modelName = settings.model || "mistral-medium-latest";

        // Mistral's API is OpenAI chat-completions compatible. (Mistral medium was
        // live-verified to tolerate non-alternating roles; we still normalize for
        // consistency with the other providers — see buildAlternatingMessages.)
        const messages: any[] = [];
        if (fullSystem) messages.push({ role: "system", content: fullSystem });
        messages.push(...buildAlternatingMessages(history, prompt));

        try {
          console.log("Forwarding request to Mistral with model %s", modelName);
          const response = await fetch("https://api.mistral.ai/v1/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Accept": wantStream ? "text/event-stream" : "application/json",
              "Authorization": `Bearer ${apiKey}`
            },
            body: JSON.stringify({
              model: modelName,
              messages,
              temperature: settings.temperature ?? 1,
              max_tokens: settings.maxTokens || 4096,
              stream: wantStream
            })
          });

          if (!response.ok) {
            const errorText = await response.text();
            let msg = `Mistral returned status ${response.status}: ${errorText || response.statusText}`;
            if (response.status === 401) {
              msg = "Your Mistral API key is invalid or missing. Get a free key at console.mistral.ai and add it in Model Settings.";
            } else if (response.status === 422) {
              msg = `Mistral rejected the request for model '${modelName}' (422). Check the model name in Model Settings.`;
            } else if (response.status === 429) {
              msg = "Mistral rate limit reached (the free tier is rate-limited). Wait a moment, or switch to another model.";
            }
            throw new Error(msg);
          }

          if (wantStream && response.body) {
            // Mistral streams OpenAI-style SSE: "data: {choices:[{delta:{content}}]}" lines, ending with "data: [DONE]".
            // For magistral the delta content is a chunk array; mistralTextContent
            // keeps only the answer text and drops {type:"thinking"} reasoning.
            const reader = (response.body as any).getReader();
            const decoder = new TextDecoder();
            let buf = "";
            let truncated = false;
            let answered = false;   // emitted at least one answer-text token
            let sawThinking = false; // model produced reasoning
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              buf += decoder.decode(value, { stream: true });
              let nl: number;
              while ((nl = buf.indexOf("\n")) >= 0) {
                const line = buf.slice(0, nl).trim();
                buf = buf.slice(nl + 1);
                if (!line.startsWith("data:")) continue;
                const data = line.slice(5).trim();
                if (!data || data === "[DONE]") continue;
                let obj: any;
                try { obj = JSON.parse(data); } catch { continue; }
                const c = obj?.choices?.[0]?.delta?.content;
                if (mistralHasThinking(c)) sawThinking = true;
                const piece = mistralTextContent(c);
                if (piece) { answered = true; sseDelta(piece); }
                if (obj?.choices?.[0]?.finish_reason === "length") truncated = true;
              }
            }
            if (!answered) {
              throw new Error(sawThinking
                ? "The model returned only reasoning and no final answer — it likely ran out of tokens while 'thinking'. Raise max tokens, or switch to a non-reasoning model."
                : "Empty response from Mistral (the model may have returned nothing — try another model).");
            }
            console.log("Mistral stream complete with model: %s (truncated:%s)", modelName, truncated);
            return sseDone(truncated);
          }

          const responseData = (await response.json()) as any;
          const content = responseData?.choices?.[0]?.message?.content;
          const text = mistralTextContent(content);

          if (!text) {
            throw new Error(mistralHasThinking(content)
              ? "The model returned only reasoning and no final answer — it likely ran out of tokens while 'thinking'. Raise max tokens, or switch to a non-reasoning model."
              : `No content from Mistral response: ${JSON.stringify(responseData)}`);
          }

          const truncated = responseData?.choices?.[0]?.finish_reason === "length";
          return res.json({ text, truncated });
        } catch (mErr: any) {
          console.error("Mistral bridge failed:", safeErr(mErr));
          return failOut(400, mErr.message || String(mErr));
        }
      }

      res.status(400).json({ error: "Unsupported AI provider." });
    } catch (error: any) {
      console.error("AI API Error:", safeErr(error));
      res.status(500).json({ error: error.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();

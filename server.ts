import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import Anthropic from "@anthropic-ai/sdk";
import dotenv from "dotenv";

dotenv.config();

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

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Configuration endpoint to expose server-side environment defaults
  app.get("/api/config", (req, res) => {
    res.json({
      ollamaBaseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434"
    });
  });

  // Endpoint to fetch available models from local Ollama instance
  app.get("/api/ollama/models", async (req, res) => {
    let ollamaUrl = (req.query.url as string)?.trim() || process.env.OLLAMA_BASE_URL?.trim() || "http://localhost:11434";
    if (ollamaUrl.endsWith("/")) {
      ollamaUrl = ollamaUrl.slice(0, -1);
    }

    try {
      console.log(`Checking local Ollama models on: ${ollamaUrl}/api/tags`);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000); // 4 second timeout for local lookup

      const response = await fetch(`${ollamaUrl}/api/tags`, {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Ollama returned status ${response.status}`);
      }

      const data = await response.json() as any;
      const models = (data.models || []).map((m: any) => m.name);
      return res.json({ models });
    } catch (err: any) {
      console.info(`Could not connect to Ollama at ${ollamaUrl} to fetch models:`, err.message || err);
      return res.status(500).json({ error: `Connection failed: ${err.message || err}` });
    }
  });

  // Unified API Route for AI assistance
  app.post("/api/assistant", async (req, res) => {
    try {
      const { prompt, history, systemInstruction, provider, modelSettings } = req.body;
      
      const aiProvider = provider || "gemini";
      const settings = modelSettings || {};

      if (aiProvider === "gemini") {
        const apiKey = settings.geminiApiKey?.trim() || process.env.GEMINI_API_KEY;
        if (!apiKey) return res.status(500).json({ error: "GEMINI_API_KEY is not configured." });

        const ai = new GoogleGenAI({ 
          apiKey,
          httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
        });

        const modelName = settings.model || "gemini-3-flash-preview"; 
        
        // Format history for generateContent
        const contents = (history || []).map((h: any) => ({
          role: h.role,
          parts: h.parts
        }));
        contents.push({ role: "user", parts: [{ text: prompt }] });

        const result = await ai.models.generateContent({
          model: modelName,
          contents: contents,
          config: {
            systemInstruction: systemInstruction || "You are a professional creative writing collaborator.",
            temperature: settings.temperature ?? 1,
            topP: settings.topP,
            topK: settings.topK,
            maxOutputTokens: settings.maxTokens || 2048,
          }
        });

        const text = result.text;
        if (!text) throw new Error("Empty response from Gemini");
        return res.json({ text });
      } 
      
      if (aiProvider === "anthropic") {
        const anthropicApiKey = settings.anthropicApiKey?.trim() || process.env.ANTHROPIC_API_KEY;
        if (!anthropicApiKey) return res.status(500).json({ error: "ANTHROPIC_API_KEY is not configured." });

        const anthropic = new Anthropic({ apiKey: anthropicApiKey });
        
        // Convert history for Anthropic (expects strictly user/assistant alternating)
        const messages = (history || [])
          .map((h: any) => ({
            role: h.role === "model" ? "assistant" : "user",
            content: h.parts[0]?.text || ""
          }))
          .filter(m => m.content.trim() !== "");

        messages.push({ role: "user", content: prompt });

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

        let response = null;
        let lastError = null;

        try {
          for (const candidateModel of modelsToTry) {
            try {
              console.log(`Attempting Anthropic message generation with model: ${candidateModel}`);
              response = await anthropic.messages.create({
                model: candidateModel,
                max_tokens: settings.maxTokens || 4096,
                temperature: settings.temperature ?? 1,
                system: systemInstruction,
                messages: messages,
              });
              console.log(`Success with Anthropic model: ${candidateModel}`);
              break; // Successfully got response
            } catch (err: any) {
              console.warn(`Failed with Anthropic model ${candidateModel}:`, err.message || err);
              lastError = err;
              continue; // Try the next available candidate model in the sequence
            }
          }

          if (!response) {
            throw lastError || new Error("All candidate Anthropic models failed.");
          }

          const text = response.content[0].type === 'text' ? response.content[0].text : '';
          if (!text) throw new Error("Empty response from Anthropic");
          return res.json({ text });
        } catch (anthropicErr: any) {
          console.error("Anthropic failed completely. Falling back to Gemini:", anthropicErr);
          
          // Gemini fallback
          const apiKey = settings.geminiApiKey?.trim() || process.env.GEMINI_API_KEY;
          if (!apiKey) {
            throw new Error(`Anthropic error: ${anthropicErr.message || anthropicErr}. Additionally, GEMINI_API_KEY is not configured for fallback.`);
          }

          const ai = new GoogleGenAI({ 
            apiKey,
            httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
          });

          // Format history for generateContent
          const contents = (history || []).map((h: any) => ({
            role: h.role,
            parts: h.parts
          }));
          contents.push({ role: "user", parts: [{ text: prompt }] });

          const fallbackModel = "gemini-2.5-flash"; // Extremely fast and capable public model
          const result = await ai.models.generateContent({
            model: fallbackModel,
            contents: contents,
            config: {
              systemInstruction: systemInstruction || "You are a professional creative writing collaborator.",
              temperature: settings.temperature ?? 1,
              maxOutputTokens: settings.maxTokens || 2048,
            }
          });

          const geminiText = result.text;
          if (!geminiText) {
            throw new Error(`Anthropic call failed with: ${anthropicErr.message || anthropicErr}. Gemini fallback also failed.`);
          }

          const errorDetail = anthropicErr.message || JSON.stringify(anthropicErr);
          const statusCode = anthropicErr.status || anthropicErr.statusCode;
          
          let errorMsg = `Anthropic error: ${errorDetail}`;
          if (statusCode === 503 || errorDetail.includes("503") || errorDetail.includes("high demand") || errorDetail.includes("overloaded")) {
            errorMsg = "Anthropic's servers are currently experiencing high demand (503 Service Unavailable)";
          } else if (statusCode === 429 || errorDetail.includes("429") || errorDetail.includes("rate limit")) {
            errorMsg = "Anthropic rate limit has been exceeded (429 Rate Limit)";
          } else if (statusCode === 404 || errorDetail.includes("404") || errorDetail.includes("not found") || errorDetail.includes("not_found")) {
            errorMsg = "Your Anthropic API key was rejected by Anthropic's gateway (likely due to an unprovisioned, newly-created, or zero-balance billing account which returns 404 for certain Claude models)";
          }

          const warningMessage = `⚠️ [SYSTEM NOTICE: ${errorMsg}. To ensure your creative flow in Aether_Core v6.1 is not interrupted, we have automatically routed this connection to Gemini-2.5-Flash.] ⚠️\n\n`;
          return res.json({ text: warningMessage + geminiText });
        }
      }

      if (aiProvider === "ollama") {
        let ollamaUrl = settings.ollamaBaseUrl?.trim() || process.env.OLLAMA_BASE_URL?.trim() || "http://localhost:11434";
        // Ensure no trailing slashes
        if (ollamaUrl.endsWith("/")) {
          ollamaUrl = ollamaUrl.slice(0, -1);
        }
        
        const modelName = settings.model || "llama3";

        // Format history for Ollama /api/chat
        const messages = [];
        
        // Add system message if present
        if (systemInstruction) {
          messages.push({ role: "system", content: systemInstruction });
        }

        // Add history
        (history || []).forEach((h: any) => {
          messages.push({
            role: h.role === "model" ? "assistant" : "user",
            content: h.parts[0]?.text || ""
          });
        });

        // Add current user prompt
        messages.push({ role: "user", content: prompt });

        try {
          console.log(`Forwarding request to Ollama at ${ollamaUrl}/api/chat with model ${modelName}`);
          const response = await fetch(`${ollamaUrl}/api/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model: modelName,
              messages: messages,
              stream: false,
              options: {
                temperature: settings.temperature ?? 1.0,
                num_predict: settings.maxTokens || 4096
              }
            })
          });

          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Ollama returned status ${response.status}: ${errorText || response.statusText}`);
          }

          const responseData = (await response.json()) as any;
          const text = responseData?.message?.content;
          
          if (!text) {
            throw new Error(`No content from Ollama response: ${JSON.stringify(responseData)}`);
          }

          return res.json({ text });
        } catch (ollamaErr: any) {
          console.error("Local Ollama bridge failed:", ollamaErr);
          return res.status(500).json({ 
            error: `Could not connect to Ollama at ${ollamaUrl}. Error details: ${ollamaErr.message || ollamaErr}. Please verify that Ollama is running ('ollama serve') and accessible from the container.` 
          });
        }
      }

      res.status(400).json({ error: "Unsupported AI provider." });
    } catch (error: any) {
      console.error("AI API Error:", error);
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

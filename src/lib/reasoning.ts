// Reasoning-trace handling for model responses. Pure (no I/O, no deps) so it can
// be unit-tested. Used by the server bridges (server.ts).
//
// Two distinct mechanisms, because providers surface reasoning differently:
//  - makeThinkStripper: removes INLINE <think>…</think> / [THINK]…[/THINK] tag
//    blocks from a string response. Some models (and older local runtimes) emit
//    the reasoning trace right inside the content; the workshop only wants the
//    final answer, and an unstripped trace otherwise lands in a captured
//    deliverable. OpenRouter and Ollama use this.
//  - mistralTextContent / mistralHasThinking: Mistral's reasoning models
//    (magistral) instead return content as a STRUCTURED array of chunks, so the
//    reasoning is dropped by keeping only the text chunks.

// Stateful inline-tag stripper. Works across streamed deltas where a tag may
// straddle two chunks (push per delta; flush once at the end). For non-reasoning
// models (no tags) it is a pass-through.
export function makeThinkStripper() {
  const OPENERS = ["<think>", "[THINK]"];
  const CLOSERS = ["</think>", "[/THINK]"];
  const MAXTAG = 8; // longest tag, for boundary hold-back
  let inside = false;
  let carry = "";
  const earliest = (tags: string[]) => {
    let idx = -1, tag = "";
    for (const t of tags) {
      const i = carry.indexOf(t);
      if (i >= 0 && (idx < 0 || i < idx)) { idx = i; tag = t; }
    }
    return { idx, tag };
  };
  const step = (flushAll: boolean): string => {
    let out = "";
    for (;;) {
      if (!inside) {
        const { idx, tag } = earliest(OPENERS);
        if (idx < 0) {
          // No opener; emit all but a possible partial-tag tail held for next chunk.
          const keep = flushAll ? 0 : Math.min(MAXTAG - 1, carry.length);
          out += carry.slice(0, carry.length - keep);
          carry = carry.slice(carry.length - keep);
          break;
        }
        out += carry.slice(0, idx);
        carry = carry.slice(idx + tag.length);
        inside = true;
      } else {
        const { idx, tag } = earliest(CLOSERS);
        if (idx < 0) {
          // Still inside the reasoning block; drop everything but a partial closer tail.
          carry = flushAll ? "" : carry.slice(Math.max(0, carry.length - (MAXTAG - 1)));
          break;
        }
        carry = carry.slice(idx + tag.length);
        inside = false;
      }
    }
    return out;
  };
  return {
    push: (delta: string): string => { carry += delta; return step(false); },
    flush: (): string => step(true),
  };
}

// Mistral returns assistant content as EITHER a plain string (normal models)
// or, for reasoning models (magistral), a structured array of chunks —
// {type:"thinking", …} for the reasoning trace and {type:"text", text} for the
// answer. Keep only the text chunks; the thinking chunks must never reach a
// captured deliverable. A plain string passes straight through.
export function mistralTextContent(content: any): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((c: any) => c?.type === "text")
      .map((c: any) => c?.text || "")
      .join("");
  }
  return "";
}

export function mistralHasThinking(content: any): boolean {
  return Array.isArray(content) && content.some((c: any) => c?.type === "thinking");
}

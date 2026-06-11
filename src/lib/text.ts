// Text / colour / sync-tag helpers — pure, no React. Extracted from App.tsx so the
// "silent correctness" spots (token counting, card recolouring, [SET_*] parsing)
// can be unit-tested in text.test.ts the way capture.ts is. A regex slip in any of
// these quietly corrupts a creator's package, so they live here, isolated.

import { encode } from "gpt-tokenizer";
import { isPlaceholderContent } from "./capture";

// Token count via cl100k_base (gpt-tokenizer). Close enough to Claude's tokenizer
// to replace the old chars/4 heuristic which overestimated by ~20%.
export function estimateTokens(text: string): number {
  return encode(text || "").length;
}

// Strip the real-time UI-sync tags ([SET_*], [SYNC_PROCEED]) from exported text.
export function stripSyncTags(text: string): string {
  return text.replace(/\[(?:SET_[A-Z_]+:[^\]]*|SYNC_PROCEED)\]/gi, "").trim();
}

// Parse a #rgb / #rrggbb hex string to an [r,g,b] triple, or null if not a hex.
export function hexToRgb(hex: string): [number, number, number] | null {
  let h = (hex || "").trim().replace(/^#/, "");
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  if (h.length !== 6 || /[^0-9a-fA-F]/.test(h)) return null;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

// Recolor card HTML by mapping each fromPalette[i] → toPalette[i]. Replaces BOTH
// the hex form (case-insensitive, 3- and 6-digit) AND the matching r,g,b triple
// inside any rgb()/rgba() (alpha preserved) — cards use solid hex for accent TEXT
// and rgba() of the SAME palette colour for borders/fills, so a hex-only swap
// would leave borders/tints stuck on the old colour. Off-palette colours (neutral
// darks the model invented) are intentionally left untouched. Two-phase via
// sentinels so a swap can't chain into a later slot (A→B then B→C rehitting B).
export function recolorHtml(html: string, from: string[] | undefined, to: string[]): string {
  if (!html || !from || !to) return html;
  const pairs: { i: number; fromHex: string; fr: [number, number, number]; toHex: string; tr: [number, number, number] }[] = [];
  for (let i = 0; i < Math.min(from.length, to.length); i++) {
    const fr = hexToRgb(from[i]), tr = hexToRgb(to[i]);
    if (!fr || !tr) continue;
    if (from[i].trim().toLowerCase() === to[i].trim().toLowerCase()) continue;
    pairs.push({ i, fromHex: from[i].trim().replace(/^#/, ""), fr, toHex: to[i].trim(), tr });
  }
  if (!pairs.length) return html;
  const S = (i: number, k: string) => `@!PAL${i}${k}!@`;
  let out = html;
  // Phase 1: from-colour forms → unique sentinels
  for (const p of pairs) {
    out = out.replace(new RegExp("#" + p.fromHex, "gi"), S(p.i, "H"));
    if (p.fromHex[0] === p.fromHex[1] && p.fromHex[2] === p.fromHex[3] && p.fromHex[4] === p.fromHex[5])
      out = out.replace(new RegExp("#" + p.fromHex[0] + p.fromHex[2] + p.fromHex[4] + "\\b", "gi"), S(p.i, "H"));
    const [r, g, b] = p.fr;
    out = out.replace(
      new RegExp("(rgba?\\(\\s*)" + r + "(\\s*,\\s*)" + g + "(\\s*,\\s*)" + b + "(\\s*[,)])", "gi"),
      `$1${S(p.i, "R")}$2${S(p.i, "G")}$3${S(p.i, "B")}$4`
    );
  }
  // Phase 2: sentinels → to-colour
  for (const p of pairs) {
    out = out.split(S(p.i, "H")).join(p.toHex);
    out = out.split(S(p.i, "R")).join(String(p.tr[0]));
    out = out.split(S(p.i, "G")).join(String(p.tr[1]));
    out = out.split(S(p.i, "B")).join(String(p.tr[2]));
  }
  return out;
}

// The result of scanning an assistant message for [SET_*] UI-sync tags: the partial
// state patch to merge, and the human-readable toast lines describing each change.
export interface ParsedSetTags {
  updates: Record<string, unknown>;
  toastMsgs: string[];
}

// Parse the [SET_*] real-time sync tags out of a full assistant message into a state
// patch + toast list. MIRRORS the inline parser in App.tsx's response handler (kept
// in sync deliberately) so the regexes — especially the multiline SET_RULES form and
// the SET_PALETTE validation — can be exercised in isolation. Pure: no state, no toasts.
export function parseSetTags(fullText: string): ParsedSetTags {
  const updates: Record<string, unknown> = {};
  const toastMsgs: string[] = [];

  const modeMatch = fullText.match(/\[SET_MODE:\s*(SFW|NSFW)\]/i);
  if (modeMatch) { updates.mode = modeMatch[1].toUpperCase(); toastMsgs.push(`Mode: ${updates.mode}`); }
  const heatMatch = fullText.match(/\[SET_HEAT:\s*([1-5])\]/i);
  if (heatMatch) { updates.heatLevel = parseInt(heatMatch[1], 10); toastMsgs.push(`Heat: ${updates.heatLevel}/5`); }
  const titleMatch = fullText.match(/\[SET_TITLE:\s*([^\]\n]+)\]/i);
  if (titleMatch) { updates.title = titleMatch[1].trim(); toastMsgs.push(`Title: "${updates.title}"`); }
  const conceptMatch = fullText.match(/\[SET_CONCEPT:\s*([^\]]+)\]/i);
  if (conceptMatch) { updates.concept = conceptMatch[1].trim(); toastMsgs.push("Premise Concept"); }
  const summaryMatch = fullText.match(/\[SET_SUMMARY:\s*([^\]]+)\]/i);
  if (summaryMatch) { updates.summary = summaryMatch[1].trim(); toastMsgs.push("Narrative Summary"); }
  const settingMatch = fullText.match(/\[SET_SETTING:\s*([^\]\n]+)\]/i);
  if (settingMatch) { updates.settingType = settingMatch[1].trim(); toastMsgs.push(`Setting: ${updates.settingType}`); }
  const toneMatch = fullText.match(/\[SET_TONE:\s*([^\]\n]+)\]/i);
  if (toneMatch) { updates.tone = toneMatch[1].trim(); toastMsgs.push(`Tone: ${updates.tone}`); }
  // SET_RULES carries a large multiline payload that can itself contain "]"
  // (e.g. "[PROTOCOL_01]"). The robust form captures up to the ']' that ends
  // the tag — the one followed by end-of-message or another [TAG] — so inner
  // brackets don't truncate it. Fall back to the simple form if needed.
  let rulesContent: string | null = null;
  const rulesRobust = fullText.match(/\[SET_RULES:\s*([\s\S]*?)\]\s*(?=\[|$)/i);
  if (rulesRobust) rulesContent = rulesRobust[1];
  else { const m = fullText.match(/\[SET_RULES:\s*([^\]]+)\]/i); if (m) rulesContent = m[1]; }
  // Skip a "[SET_RULES: ...]" placeholder (model wrote rules as prose, tagged a
  // placeholder) — capturing "..." would wipe the editor. Same guard as capture.ts.
  if (rulesContent !== null && rulesContent.trim() && !isPlaceholderContent(rulesContent)) { updates.groundingRules = rulesContent.trim(); toastMsgs.push("Reality Protocols"); }
  const aestheticMatch = fullText.match(/\[SET_AESTHETIC:\s*(Literary|Structured|Chaos)\]/i);
  if (aestheticMatch) { const modeVal = aestheticMatch[1].trim(); updates.aestheticMode = modeVal.charAt(0).toUpperCase() + modeVal.slice(1).toLowerCase(); toastMsgs.push(`Aesthetic: ${updates.aestheticMode}`); }
  const artStyleMatch = fullText.match(/\[SET_ART_STYLE:\s*([^\]\n]+)\]/i);
  if (artStyleMatch) { updates.artStyle = artStyleMatch[1].trim(); toastMsgs.push(`Art Style: ${updates.artStyle}`); }
  const paletteMatch = fullText.match(/\[SET_PALETTE:\s*([^\]]+)\]/i);
  if (paletteMatch) {
    const colors = paletteMatch[1].split(",").map((c: string) => c.trim()).filter((c: string) => c.startsWith("#") && (c.length === 7 || c.length === 4));
    if (colors.length >= 3) { updates.palette = colors; toastMsgs.push("Palette Config"); }
  }

  return { updates, toastMsgs };
}

// Flatten an HTML deliverable into clean plain text for the TEXT portion of the
// Export_Core package. The Title & Summary block in particular ships as
// <h1>/<h2>/<h3>/<p>/<strong> markup, and those tags must not leak into the
// exported .txt. Block-level tags become line breaks, inline tags are dropped,
// and common entities are decoded. Whitespace inside a line is left alone so
// already-plain blocks (Prompt Plot, Guidelines, descriptions) pass through
// essentially untouched — only stray tags/entities are cleaned.
export function htmlToText(input: string): string {
  if (!input) return "";
  let s = input.replace(/\r\n/g, "\n");
  // <br> and the end of a block element start a new line.
  s = s.replace(/<\s*br\s*\/?\s*>/gi, "\n");
  s = s.replace(/<\/\s*(p|div|h[1-6]|tr|ul|ol|section|article|header|footer|blockquote)\s*>/gi, "\n");
  // A list item opens with a bullet (its </li> is dropped with the other tags so
  // items stay single-spaced); other block openers just break the line.
  s = s.replace(/<\s*li\b[^>]*>/gi, "\n- ");
  s = s.replace(/<\s*(p|div|h[1-6]|tr|ul|ol|section|article|header|footer|blockquote)\b[^>]*>/gi, "\n");
  // Drop every remaining tag.
  s = s.replace(/<[^>]+>/g, "");
  // Decode the entities a model actually emits.
  const named: Record<string, string> = {
    amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
    mdash: "—", ndash: "–", hellip: "…",
    rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“",
  };
  s = s.replace(/&(amp|lt|gt|quot|apos|nbsp|mdash|ndash|hellip|rsquo|lsquo|rdquo|ldquo);/gi,
    (m, n: string) => named[n.toLowerCase()] ?? m);
  s = s.replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(parseInt(n, 10)));
  s = s.replace(/&#x([0-9a-fA-F]+);/g, (_m, n: string) => String.fromCodePoint(parseInt(n, 16)));
  // Tidy: strip trailing spaces per line, collapse 3+ blank lines to one gap.
  s = s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

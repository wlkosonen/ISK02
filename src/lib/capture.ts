// Capture layer — the heart of the workshop's correctness.
//
// The assistant emits finished deliverables wrapped in <<<USCS_BLOCK TYPE>>> …
// <<<END USCS_BLOCK>>> sentinels; `captureDeliverables` parses the LATEST version
// of each block out of a message into the package. A single regex slip here can
// silently lose a creator's work, so this module is deliberately pure (no React)
// and unit-tested in capture.test.ts.

export interface CharacterDeliverable {
  name: string;
  desc: string;   // Part B — AI prompt description (COUNTS toward budget)
  card: string;   // Part A — HTML card (does NOT count)
  cardPalette?: string[];  // baseline palette baked into `card` right now (the "from" for recolorHtml)
  editPalette?: string[];  // per-card WORKING palette the user tweaks before hitting Recolor (the "to")
  prevDesc?: string;       // one-level restore: the description before it was last overwritten
  prevCard?: string;       // one-level restore: the card HTML before it was last overwritten
}

// Dungeon Mind (DM) config — a SEPARATE deliverable set (USCS §27). The DM is a
// game-mechanics agent (dice/stats/inventory/rules) the creator attaches to a
// storyline on ISK0; these seven fields mirror ISK0's DM editor. Not part of the
// story package and NOT subject to the 20k story-package ceiling.
export interface DMConfig {
  name: string;             // Field 1 — config name
  model: string;            // Field 2 — recommended ISK0 DM model (a note, not our provider)
  statSchema: string;       // Field 7 — stat list (modes: Numeric/Text/Enum; Alive always present)
  gameRules: string;        // Field 3 — ruleset (cap 10,000 tok)
  gameRuleReminder: string; // Field 4 — 3–5 must-never-forget rules (~500 tok)
  instruction: string;      // Field 5 — bridge telling the story-AI when to invoke the DM
  playerGuide: string;      // Field 6 — player-facing guide (max 1000 CHARACTERS)
}

export interface Deliverables {
  titleSummary: string;
  plotCard: string;
  plotCardPalette?: string[];  // palette the plot card was generated/recolored with (for instant local recolor)
  promptPlot: string;
  guidelines: string;
  reminders: string;
  playerPersona: string;
  scenarios: string;
  imagePrompts: string;
  characters: CharacterDeliverable[];
  firstMessages: { label: string; content: string }[];   // one per scenario variant — COUNTS
  dmConfig: DMConfig;     // Dungeon Mind config (USCS §27) — only built on DM tracks
  // One-level restore: each scalar block's value BEFORE it was last overwritten by a
  // capture. Populated by withRestorePoints; not counted, not exported.
  prev?: Partial<Record<RestorableScalar, string>>;
}

// The scalar story-package blocks that support one-level "restore previous".
export const RESTORABLE_SCALARS = [
  "titleSummary", "plotCard", "promptPlot", "guidelines",
  "reminders", "playerPersona", "scenarios", "imagePrompts",
] as const;
export type RestorableScalar = typeof RESTORABLE_SCALARS[number];

export const DELIVERABLE_LABELS: Record<string, string> = {
  TITLE_SUMMARY: "Title & Summary", PLOT_CARD: "Plot Card", PROMPT_PLOT: "Prompt Plot",
  GUIDELINES: "Guidelines", REMINDERS: "Reminders", PLAYER_PERSONA: "Player Persona",
  SCENARIOS: "Scenarios", IMAGE_PROMPTS: "Image Prompts",
  DM_STAT_SCHEMA: "Stat Schema", DM_GAME_RULES: "Game Rules", DM_REMINDER: "Game Rule Reminder",
  DM_INSTRUCTION: "Story-AI Instruction", DM_PLAYER_GUIDE: "Player Guide", DM_NAME_MODEL: "Name & Model",
};

// Parse <<<USCS_BLOCK TYPE>>> … <<<END USCS_BLOCK>>> sentinels out of an assistant
// message: capture the latest version of each block into the package, and return
// the message text with the marker lines removed (the block content stays visible).
//
// TOLERANT BY DESIGN. Real providers (live-tested: mistral-medium drifts badly as a
// conversation lengthens) mangle the format in predictable ways, and we'd rather
// capture than silently drop a creator's work:
//   • two angle brackets ("…>>") instead of three — accept 2+ on each side;
//   • a MISSING closing <<<END USCS_BLOCK>>> — accept the block if it's bounded by
//     the next opener OR closed off by a ``` code fence;
//   • the whole block wrapped in a ``` / ~~~ code fence — strip the wrapping fence.
// The closing marker also tolerates a repeated type (`<<<END USCS_BLOCK TYPE>>>`).
// CRUCIAL EXCEPTION: a block that opens and then runs to end-of-message with NO end
// marker AND no closing fence is a TRUNCATED response, not a finished deliverable —
// we skip it so half-streamed garbage never captures (the user hits Continue).
export const OPEN_RE = /<{2,}\s*USCS_BLOCK\s+([A-Z_]+)(?::\s*([^>\n]+?))?\s*>{2,}/g;
const END_RE = /<{2,}\s*END\s+USCS_BLOCK(?:[ \t:]+[^>\n]*)?>{2,}/g;
const FENCE_LINE = /^[ \t]*(?:`{3,}|~{3,})[^\n]*$/;

// True if the last non-blank line of `s` is a code-fence line — the signal that a
// model deliberately closed an END-less block (vs. being cut off mid-stream).
function endsWithFence(s: string): boolean {
  const lines = s.replace(/\r/g, "").replace(/\s+$/, "").split("\n");
  return FENCE_LINE.test(lines[lines.length - 1] || "");
}

// Drop leading/trailing blank or code-fence lines that wrap a captured block, so a
// ```markdown … ``` wrapper (or a trailing block's opening fence) never ends up
// stored in the deliverable itself.
function stripWrappingFences(s: string): string {
  const lines = s.replace(/\r/g, "").split("\n");
  while (lines.length && (lines[0].trim() === "" || FENCE_LINE.test(lines[0]))) lines.shift();
  while (lines.length && (lines[lines.length - 1].trim() === "" || FENCE_LINE.test(lines[lines.length - 1]))) lines.pop();
  return lines.join("\n").trim();
}

// Weak models sometimes echo the literal placeholder from the prompt
// ("<<<USCS_BLOCK CHAR_DESC: Name>>>") instead of substituting the real
// character name. Treat those as "no real name" so we don't spawn a ghost
// character literally called "Name"/"NAME" (and silently duplicate the cast).
// True if a block's ENTIRE content is a do-it-later placeholder — an ellipsis
// ("...", "…", optionally wrapped in brackets like "[...]") or a TBD marker. Weak
// models (and even mistral-medium as a chat lengthens) sometimes write a
// deliverable out as prose and then emit the capture block with only a placeholder
// inside, expecting a follow-up turn to fill it. Capturing that silently overwrites
// real, good content with junk — so we skip + warn instead.
export function isPlaceholderContent(content: string): boolean {
  const t = content.trim().replace(/^[[<({"'`]+/, "").replace(/[\]>)}"'`]+$/, "").trim();
  if (/^[.…]+$/.test(t)) return true;            // ... or … (optionally bracketed)
  return ["tbd", "todo", "placeholder", "n/a", "content here", "to be added"].includes(t.toLowerCase());
}

// Strip decorative **bold** markers from a TEXT deliverable. Models (mistral-medium
// especially) bold half the words; that emphasis renders nowhere in the workshop and
// carries no meaning for the deployed ISK0 AI that consumes the block — it's pure
// token bloat (~800 bold pairs ≈ 1–1.6k tokens were measured on one package, ~15% of
// budget). We remove only PAIRED inline `**…**` (and `__…__`); single `*` italics,
// list bullets, and unbalanced markers are left untouched, and this is NEVER applied
// to the HTML card deliverables (PLOT_CARD / CHAR_CARD).
export function stripDecorativeMarkdown(s: string): string {
  return s
    .replace(/\*\*(?=\S)([^\n]+?)\*\*/g, "$1")
    .replace(/__(?=\S)([^\n_]+?)__/g, "$1");
}

// Apply stripDecorativeMarkdown to every TEXT deliverable, leaving the HTML card
// blocks (plotCard, character cards) alone. Used as a one-time migration when loading
// a package captured before bold-stripping existed (and harmless/idempotent after).
export function normalizeDeliverables(d: Deliverables): Deliverables {
  const t = stripDecorativeMarkdown;
  return {
    ...d,
    titleSummary: t(d.titleSummary || ""),
    promptPlot: t(d.promptPlot || ""),
    guidelines: t(d.guidelines || ""),
    reminders: t(d.reminders || ""),
    playerPersona: t(d.playerPersona || ""),
    scenarios: t(d.scenarios || ""),
    imagePrompts: t(d.imagePrompts || ""),
    characters: d.characters.map(c => ({ ...c, desc: t(c.desc || "") })),       // card = HTML, untouched
    firstMessages: d.firstMessages.map(f => ({ ...f, content: t(f.content || "") })),
    dmConfig: {
      ...d.dmConfig,
      statSchema: t(d.dmConfig.statSchema || ""),
      gameRules: t(d.dmConfig.gameRules || ""),
      gameRuleReminder: t(d.dmConfig.gameRuleReminder || ""),
      instruction: t(d.dmConfig.instruction || ""),
      playerGuide: t(d.dmConfig.playerGuide || ""),
    },
  };
}

export function isPlaceholderCharName(name: string): boolean {
  const n = name.trim().replace(/^[<[("'{]+|[>\])"'}]+$/g, "").trim().toLowerCase();
  return [
    "", "name", "names", "character", "character name", "characters name",
    "character's name", "char name", "char_name", "charname", "your name",
    "the name", "name here", "full name", "character_name", "tbd", "todo",
    "example", "example name", "placeholder", "n/a",
  ].includes(n);
}

export function captureDeliverables(text: string, current: Deliverables, palette?: string[], priorBlock?: string): { next: Deliverables; captured: string[]; cleaned: string; warnings: string[]; pendingBlock: string | null } {
  const next: Deliverables = { ...current, characters: current.characters.map(c => ({ ...c })), firstMessages: current.firstMessages.map(f => ({ ...f })), dmConfig: { ...current.dmConfig } };
  const captured: string[] = [];
  const warnings: string[] = [];
  // The trailing block that ran to EOF with no close — handed back so the caller
  // can stitch the NEXT (Continue) turn onto it instead of losing the half. Null
  // unless a real truncation happened.
  let pendingBlock: string | null = null;

  // STITCHING: when the previous turn was cut off mid-block, `priorBlock` is that
  // unterminated block's raw text (opener marker onward). We SCAN over priorBlock +
  // this turn so the earlier opener pairs with this turn's closing <<<END>>> and
  // captures as one block. The visible `cleaned` text is computed from THIS turn
  // only (below) — the earlier half is never re-displayed.
  const scanText = priorBlock ? priorBlock + "\n" + text : text;

  // Pass 1: locate every opening marker (tolerant). Pass 2: for each, take its
  // content up to the earliest of — a closing END marker, the next opener, or EOF.
  const openers: { type: string; name: string; markerStart: number; contentStart: number }[] = [];
  OPEN_RE.lastIndex = 0;
  let om: RegExpExecArray | null;
  while ((om = OPEN_RE.exec(scanText)) !== null) {
    openers.push({ type: om[1].toUpperCase(), name: (om[2] || "").trim(), markerStart: om.index, contentStart: OPEN_RE.lastIndex });
  }

  for (let oi = 0; oi < openers.length; oi++) {
    const op = openers[oi];
    const type = op.type;
    const name = op.name;
    const nextStart = oi + 1 < openers.length ? openers[oi + 1].markerStart : scanText.length;
    END_RE.lastIndex = op.contentStart;
    const endM = END_RE.exec(scanText);
    const hasEnd = !!endM && endM.index < nextStart;
    let regionEnd: number;
    let eofBounded = false;
    if (hasEnd) regionEnd = endM!.index;
    else if (oi + 1 < openers.length) regionEnd = nextStart;
    else { regionEnd = scanText.length; eofBounded = true; }
    const raw = scanText.slice(op.contentStart, regionEnd);
    // No end marker AND last block AND not fence-closed → truncated mid-stream. Hand
    // the whole block (opener onward) back as pendingBlock so the next Continue turn
    // can stitch the rest onto it, instead of silently dropping the half.
    if (eofBounded && !endsWithFence(raw)) { pendingBlock = scanText.slice(op.markerStart); continue; }
    let content = stripWrappingFences(raw);
    if (!content) continue;
    // Strip decorative **bold** from TEXT blocks (token bloat the consumer ignores).
    // NEVER touch the HTML card blocks — they're real markup, not markdown.
    if (type !== "PLOT_CARD" && type !== "CHAR_CARD") content = stripDecorativeMarkdown(content);
    // A block whose whole body is a placeholder ("[...]", "...", "TBD") is the model
    // saying "I'll fill this in next turn" — never capture it, or it clobbers a good
    // prior value with junk. Warn so the message stays re-capturable from history.
    if (isPlaceholderContent(content)) {
      const label = DELIVERABLE_LABELS[type] || (name ? `${name} (${type === "CHAR_CARD" ? "card" : "description"})` : type);
      warnings.push(`The ${label} block came back as just a placeholder — nothing was saved. Ask the collaborator to emit the full content inside the block.`);
      continue;
    }

    if (type === "CHAR_DESC" || type === "CHAR_CARD") {
      if (!name) continue;
      // Placeholder name (model didn't substitute it): route to the character
      // actually in progress instead of creating a junk "NAME" character.
      if (isPlaceholderCharName(name)) {
        let target: CharacterDeliverable | undefined;
        for (let i = next.characters.length - 1; i >= 0; i--) {
          const c = next.characters[i];
          if (type === "CHAR_CARD" ? (c.desc && !c.card) : !c.desc) { target = c; break; }
        }
        if (!target) {
          // Nothing sensible to attach to — drop it rather than spawn a ghost.
          warnings.push(`A ${type === "CHAR_CARD" ? "card" : "description"} came back without a real character name — re-run that character and it'll capture.`);
          continue;
        }
        if (type === "CHAR_DESC") { target.desc = content; captured.push(`${target.name} (description)`); }
        else { target.card = content; if (palette) target.cardPalette = [...palette]; captured.push(`${target.name} (card)`); }
        continue;
      }
      let ch = next.characters.find(c => c.name.toLowerCase() === name.toLowerCase());
      if (!ch) { ch = { name, desc: "", card: "" }; next.characters.push(ch); }
      if (type === "CHAR_DESC") { ch.desc = content; captured.push(`${name} (description)`); }
      else { ch.card = content; if (palette) ch.cardPalette = [...palette]; captured.push(`${name} (card)`); }
      continue;
    }

    if (type === "FIRST_MESSAGE" || type === "FIRST_MESSAGES") {
      const label = name || `${next.firstMessages.length + 1}`;
      let fm = next.firstMessages.find(f => f.label.toLowerCase() === label.toLowerCase());
      if (!fm) { fm = { label, content: "" }; next.firstMessages.push(fm); }
      fm.content = content;
      captured.push(`First Message ${label}`);
      continue;
    }

    switch (type) {
      case "TITLE_SUMMARY": next.titleSummary = content; break;
      case "PLOT_CARD": next.plotCard = content; if (palette) next.plotCardPalette = [...palette]; break;
      case "PROMPT_PLOT": next.promptPlot = content; break;
      case "GUIDELINES": next.guidelines = content; break;
      case "REMINDERS": next.reminders = content; break;
      case "PLAYER_PERSONA": next.playerPersona = content; break;
      case "SCENARIOS": next.scenarios = content; break;
      case "IMAGE_PROMPTS": next.imagePrompts = content; break;
      // Dungeon Mind config fields (USCS §27)
      case "DM_STAT_SCHEMA": next.dmConfig.statSchema = content; break;
      case "DM_GAME_RULES": next.dmConfig.gameRules = content; break;
      case "DM_REMINDER": next.dmConfig.gameRuleReminder = content; break;
      case "DM_INSTRUCTION": next.dmConfig.instruction = content; break;
      case "DM_PLAYER_GUIDE": next.dmConfig.playerGuide = content; break;
      case "DM_NAME_MODEL": {
        // "Name | Model" or "Name :: Model" or two lines — split leniently.
        const parts = content.split(/\s*(?:\||::|\n)\s*/).map(s => s.replace(/^(name|model)\s*[:=-]\s*/i, "").trim()).filter(Boolean);
        next.dmConfig.name = parts[0] || content.trim();
        if (parts[1]) next.dmConfig.model = parts[1];
        break;
      }
      default: continue;
    }
    captured.push(DELIVERABLE_LABELS[type] || type);
  }

  // Remove only the sentinel marker lines for display; keep the block content.
  // Computed from THIS turn's `text` only (never the stitched scanText), so a prior
  // truncated half is never re-shown in the chat.
  const cleaned = text
    .replace(/^[ \t]*<{2,}\s*USCS_BLOCK[^\n>]*>{2,}[ \t]*\r?\n?/gm, "")
    .replace(/^[ \t]*<{2,}\s*END\s+USCS_BLOCK[^\n>]*>{2,}[ \t]*\r?\n?/gm, "")
    .trim();

  return { next, captured, cleaned, warnings, pendingBlock };
}

// After a capture, stash the PRIOR value of every block that was just overwritten
// with a different, non-empty old value — so a bad AI re-skin can be undone one
// level. `old` is the package before this capture, `neu` the one after. Unchanged
// blocks keep whatever restore point they already had. Returns `neu` augmented.
export function withRestorePoints(old: Deliverables, neu: Deliverables): Deliverables {
  const prev: Partial<Record<RestorableScalar, string>> = { ...(neu.prev || {}) };
  for (const k of RESTORABLE_SCALARS) {
    if (neu[k] !== old[k] && (old[k] || "").trim()) prev[k] = old[k] as string;
  }
  const characters = neu.characters.map(c => {
    const o = old.characters.find(x => x.name.toLowerCase() === c.name.toLowerCase());
    if (!o) return c; // brand-new character — nothing to restore to
    const patch: Partial<CharacterDeliverable> = {};
    if (c.desc !== o.desc && (o.desc || "").trim()) patch.prevDesc = o.desc;
    if (c.card !== o.card && (o.card || "").trim()) patch.prevCard = o.card;
    return Object.keys(patch).length ? { ...c, ...patch } : c;
  });
  return { ...neu, prev, characters };
}

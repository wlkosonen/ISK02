/**
 * USCS v6.1 master-document loader.
 *
 * The full framework (docs/USCS_v6.1.txt) is the unaltered source of truth.
 * Instead of feeding the whole 7,000-line document — or a watered-down summary —
 * to the model on every turn, we parse it once at startup and inject only the
 * verbatim slice relevant to the creator's CURRENT pipeline step:
 *   - the STEP block from "SECTION 2 — BUILD ORDER" (the build-order instruction), and
 *   - the detail SECTION(s) that step references (the actual craft rules/templates).
 */

import fs from "fs";
import path from "path";

// Match either an em dash (—), en dash (–) or hyphen after the id.
const DASH = "[\\u2014\\u2013-]";
const SECTION_RE = new RegExp(`^SECTION\\s+(\\d+[A-Z]?)\\s*${DASH}`);
const STEP_RE = new RegExp(`^STEP\\s+(\\d+[A-Z]?)\\s*${DASH}`);

// UI step index (App.tsx STEPS array) -> master STEP block id(s) from Section 2.
const STEP_BLOCKS: Record<number, string[]> = {
  0: ["1"],                 // Mode Selection
  1: ["2"],                 // Concept Intake
  2: ["3"],                 // Setting & Tone
  3: ["4"],                 // Art Style Profile
  4: ["5"],                 // Palette & Identity
  5: ["6", "6A"],           // World Grounding (+ Naming)
  6: ["7", "8"],            // Title & Summary
  7: ["9"],                 // Plot Card
  8: ["12"],                // Character Sheets (v6.0 reorder: master STEP 12)
  9: ["10", "10A"],         // Scenarios (+ Three-Act Hooks)
  10: ["11"],               // Prompt Plot
  11: ["14"],               // Guidelines (v6.0 reorder: master STEP 14)
  12: ["15"],               // Reminders (v6.0 reorder: master STEP 15)
  13: ["13", "16"],         // First Message (draft + final polish)
  14: ["17A", "17B", "17C"],// Image Prompts (image / video / emotion edits)
  15: ["18", "20", "21"],   // Compliance & Assembly
};

// UI step index -> verbatim detail SECTION id(s) the step depends on.
const DETAIL_SECTIONS: Record<number, string[]> = {
  0: ["3-modes", "4"],      // modes + heat (NOT setting types) + compliance
  1: ["22"],                // emotional architecture (§22.4) ONLY — setting types belong to Step 2, injecting them here makes weak models present the setting menu prematurely
  2: ["3-settings"],        // setting types / mode lock
  3: ["12-style"],          // art style PROFILE only (NOT image-prompt syntax — that's Step 14; split avoids weak models emitting render syntax early)
  4: ["5-palette"],         // palette/visual-identity tail of Section 5 only (NOT full card-construction reference — that's Step 7; split saves ~1k tokens/turn + avoids early card drafting)
  5: ["15", "3-settings"],  // naming protocol + world grounding setting rules
  6: [],                    // title/summary — build-order block is sufficient
  7: ["16", "5"],           // plot card templates + HTML reference
  8: ["10", "17", "21"],    // character sheet structure + card templates + budget caps
  9: ["9A", "17B", "19"],   // scenario variants + narrative loop + module system
  10: ["6", "6A"],          // prompt-plot subsections + Architect Protocol
  11: ["7", "7A", "7B", "22"], // guidelines + social web + status dashboard + emotional mandate
  12: ["8", "22"],          // reminders + emotional target
  13: ["9", "9A"],          // first message rules + scenario variants
  14: ["12", "12B", "13", "14"], // image + video + emotion edit + location prompts
  15: ["4", "18", "21"],    // compliance checklist + final assembly + token budget
};

const CORE_PREAMBLE = `ISK0 / ISEKAI ZERO — ULTIMATE STORY CREATION SYSTEM v6.1 PIPELINE ENGINE
You are the under-the-hood Modus Operandi for this story-creation workshop: a professional story-architecture compiler and creative collaborator. You guide the creator step-by-step through the USCS v6.1 pipeline to build a complete, highly polished, copy-paste-ready story package.

CORE DIRECTIVE — NEVER VIOLATE:
- You are ONLY co-writing and architecting. You NEVER roleplay as a character, narrate the game, or simulate interactive turns ("What do you do?"). You work at the META level: the story is the product; you are not a participant in it.
- TWO LAYERS: (1) WORKSHOP LAYER — your direct, collaborative dialog with the Creator (use "we"/"let's", suggest, refine). (2) TEMPLATE LAYER — structured craft output (HTML cards, prompt plots, guidelines, reminders, image prompts) written in the third person FOR a SEPARATE performer AI to execute later. Never mix the layers; never write self-instructions inside craft output.
- The image prompts, video prompts, and HTML you produce are deliverables to be copied into OTHER tools/AIs. Make them complete and self-contained.

AUTHORITATIVE SPECIFICATION:
The verbatim USCS v6.1 specification governing the CURRENT step follows below. Treat it as the single source of truth — follow its rules, structures, required subsections, word counts, and templates EXACTLY. Do not summarize, abbreviate, or water it down; produce output to the full depth the specification requires.`;

// The full-story-vs-Dungeon-Mind "track" decision is now owned by a dedicated
// on-screen control (and re-stated to the model in the live deskstate). The
// verbatim framework, however, instructs the AI to OFFER/ASK that choice in chat
// at Step 1 — which made the model keep re-asking even after the creator picked
// it on the UI. We strip ONLY those offer/ask lines from the injected text; all
// Dungeon Mind mechanics and sections remain fully intact.
const TRACK_OFFER_LINE_RES: RegExp[] = [
  /^\s*ALSO OFFER/i,   // anchored: the directive header only, NOT a mid-sentence "also offer:" (e.g. STEP 4's image-analysis line)
  /Are you building a full story/i,
  /If DM-only\s*:/i,
  /ALTERNATE ENTRY POINT\s*[—–-]\s*DUNGEON MIND ONLY/i,
  /offer a DM-only track/i,
];
function stripTrackOffer(text: string): string {
  return text
    .split(/\r?\n/)
    .filter(line => !TRACK_OFFER_LINE_RES.some(re => re.test(line)))
    .join("\n");
}

// The Concept Intake build-order block (Section 2, STEP 2) tells the AI to also
// ask "What is the setting?" and "What tone are they going for?" — but in
// Aether_Core both have DEDICATED later UI steps (Setting & Tone). The framework
// intends a light premise-capture at intake and a hard lock at Step 3; here that
// reads as the model jumping ahead with a redundant questionnaire (it even says
// "we'll lock this later" while asking). We strip ONLY those two solicitation
// lines from the Concept Intake step text — STEP-SCOPED, so Step 3 keeps them.
// Hook / characters / cast-size / entry points / emotional archetype stay (cast
// size legitimately belongs here — it sizes the token budget + sheet count).
const CONCEPT_FORWARD_ASK_RES: RegExp[] = [
  /What is the setting\?/i,
  /What tone are they going for/i,
];
function stripConceptForwardAsks(text: string): string {
  return text
    .split(/\r?\n/)
    .filter(line => !CONCEPT_FORWARD_ASK_RES.some(re => re.test(line)))
    .join("\n");
}

// Step-scoped PARAGRAPH strips: drop whole blank-line-delimited blocks whose
// first non-empty line matches. Same "don't solicit things owned by a dedicated
// UI control or a later step" rationale as the setting/tone strip — these blocks
// of build-order text instruct the model to ask about choices the creator
// already makes via on-screen controls, or that belong to much later steps.
const STEP_PARAGRAPH_STRIPS: Record<number, RegExp[]> = {
  // Art Style Profile (uiStep 3): Aesthetic Mode and Image Generation Service
  // are both UI controls ON this step (button toggle + dropdown), so asking in
  // chat is redundant and reads as jumping ahead. Reference-image upload is not
  // supported in this app at all, so drop those offers entirely rather than
  // dangle a capability that doesn't exist. (imageService value is carried to
  // the model via the deskstate sync instead — see App.tsx syncDeskstateToAI.)
  3: [
    /^ALSO:\s*Ask about Aesthetic Mode/i,
    /^IMAGE GENERATION SERVICE:/i,
    /^HTML VISUAL REFERENCE OPTION:/i,
    /^If the AI model is capable of image analysis/i,
  ],
  // Title & Summary (uiStep 6): the 20-word CHARACTER summaries are written with
  // the Character Sheets (uiStep 8, two steps later in the v6.0 reorder); asking
  // for them here means summarising characters that don't exist yet. Section 10
  // (injected at Character Sheets) carries the 20-word-summary rule there.
  6: [
    /^CHARACTER SUMMARIES/i,
  ],
  // Plot Card (uiStep 7): premature character-image-URL solicitation — images are
  // produced ~7 steps later (Image Prompts) and there's no image-upload path here.
  7: [
    /^IMAGE PLACEMENT NOTE:/i,
  ],
};
function stripParagraphs(text: string, startRes: RegExp[]): string {
  if (!startRes.length) return text;
  return text
    .split(/\n[ \t]*\n/)
    .filter(p => {
      const first = (p.split(/\r?\n/).find(l => l.trim().length > 0) || "").trim();
      return !startRes.some(re => re.test(first));
    })
    .join("\n\n");
}

interface ParsedDoc {
  sections: Map<string, string>;
  steps: Map<string, string>;
  loaded: boolean;
}

let cache: ParsedDoc | null = null;
let cacheMtimeMs = 0;

function sliceBlocks(lines: string[], headerRe: RegExp, includeLineAbove: boolean): Map<string, string> {
  const map = new Map<string, string>();
  const hits: { id: string; idx: number }[] = [];
  lines.forEach((line, idx) => {
    const m = line.match(headerRe);
    if (m) hits.push({ id: m[1], idx });
  });
  hits.forEach((hit, i) => {
    // Section headers are wrapped in `===` rules; include the rule line above for fidelity.
    const start = includeLineAbove && hit.idx > 0 ? hit.idx - 1 : hit.idx;
    const end = i + 1 < hits.length
      ? (includeLineAbove ? hits[i + 1].idx - 1 : hits[i + 1].idx)
      : lines.length;
    map.set(hit.id, lines.slice(start, end).join("\n").trim());
  });
  return map;
}

function load(): ParsedDoc {
  const docPath = path.join(process.cwd(), "docs", "USCS_v6.1.txt");
  // Production: parse once and cache for the process lifetime. Dev: re-read when
  // the master doc's mtime changes, so edits to docs/USCS_v6.1.txt take effect
  // WITHOUT a server restart (paired with `tsx watch`, which restarts the process
  // on server.ts / uscs.ts edits). The statSync gate keeps the steady state a
  // cheap no-op — we only re-parse when the file actually changes on disk.
  if (cache) {
    if (process.env.NODE_ENV === "production") return cache;
    try { if (fs.statSync(docPath).mtimeMs === cacheMtimeMs) return cache; } catch { return cache; }
  }

  try {
    const raw = fs.readFileSync(docPath, "utf-8");
    const lines = raw.split(/\r?\n/);

    const sections = sliceBlocks(lines, SECTION_RE, true);

    // Section 3 ("MODES, HEAT LEVELS, AND SETTING TYPES") bundles three things,
    // but most steps need only part of it: Mode Selection needs modes+heat,
    // while the Setting/Concept/Grounding steps need the setting-type catalog.
    // Injecting the whole block on every one of those steps wastes ~1.4k tokens
    // and pulls off-topic content (the setting catalog) into Mode Selection,
    // which nudges the model to drift. We register two virtual sub-sections:
    //   "3-modes"    = SECTION 3 header + 3.1 Modes + 3.2 Heat Levels
    //   "3-settings" = 3.3 Setting Types
    // The original "3" is left intact as a fallback. If the 3.3 subheader can't
    // be found (doc edited), both virtual ids alias the full section so nothing
    // silently loses content.
    {
      const sec3 = sections.get("3");
      if (sec3) {
        const l3 = sec3.split(/\r?\n/);
        const idx = l3.findIndex(l => /^3\.3\s*[—–-]\s*SETTING TYPES/i.test(l.trim()));
        if (idx > 0) {
          let headStart = idx;
          while (headStart > 0 && /^[-\s]*$/.test(l3[headStart - 1])) headStart--;
          const modesHeat = l3.slice(0, headStart).join("\n").trim();
          const settings = l3.slice(headStart).join("\n").trim();
          sections.set("3-modes", modesHeat);
          sections.set(
            "3-settings",
            "================================================================================\n" +
            "USCS v6.1 — SECTION 3.3: SETTING TYPES\n" +
            "================================================================================\n" +
            settings
          );
        } else {
          sections.set("3-modes", sec3);
          sections.set("3-settings", sec3);
        }
      }
    }

    // Section 12 ("IMAGE GENERATION PROMPTS & ART STYLE PROFILES") bundles two
    // steps' worth of content: a short "Art Style Statement" definition (relevant
    // at the Art Style Profile step) and the full per-service image-prompt syntax
    // (MidJourney/SD/NovelAI/DALL-E/Flux + per-character prompt briefs) which is
    // the LATER Image Prompts step's job. Injecting the whole thing at Art Style
    // made weak models start emitting render syntax / quizzing on aspect ratios.
    // Register a virtual "12-style" = just the Art Style Statement block. The full
    // "12" stays for the Image Prompts step. Falls back to full section if the
    // seam headers can't be found (doc edited).
    {
      const sec12 = sections.get("12");
      if (sec12) {
        const l12 = sec12.split(/\r?\n/);
        const startIdx = l12.findIndex(l => /^ART STYLE STATEMENT/i.test(l.trim()));
        const endIdx = l12.findIndex(l => /^PER-SERVICE SYNTAX RULES/i.test(l.trim()));
        if (startIdx >= 0 && endIdx > startIdx) {
          const styleBlock = l12.slice(startIdx, endIdx).join("\n").trim();
          sections.set(
            "12-style",
            "================================================================================\n" +
            "USCS v6.1 — SECTION 12 (ART STYLE PROFILE: THE ART STYLE STATEMENT)\n" +
            "================================================================================\n" +
            styleBlock
          );
        } else {
          sections.set("12-style", sec12);
        }
      }
    }

    // Section 5 ("HTML REFERENCE") is ~1,200 lines of plot/character card
    // construction (rules, build patterns 1-9/A-F, card structure) plus a tail
    // covering aesthetic modes, typography and the colour/palette rules. Only the
    // tail is relevant at the Palette & Identity step; the card-construction bulk
    // belongs to the later Plot Card / Character Sheet steps (and is a heavy token
    // cost on every palette turn). Register a virtual "5-palette" = the tail from
    // the "5.12 — AESTHETIC MODES" header to the end of section 5. The full "5"
    // stays for the Plot Card step. Falls back to full section if seam not found.
    {
      const sec5 = sections.get("5");
      if (sec5) {
        const l5 = sec5.split(/\r?\n/);
        const idx = l5.findIndex(l => /^5\.12\s*[—–-]\s*AESTHETIC MODES/i.test(l.trim()));
        if (idx > 0) {
          let headStart = idx;
          while (headStart > 0 && /^[=\s]*$/.test(l5[headStart - 1])) headStart--;
          const tail = l5.slice(headStart).join("\n").trim();
          sections.set(
            "5-palette",
            "================================================================================\n" +
            "USCS v6.1 — SECTION 5 (PALETTE & VISUAL IDENTITY EXCERPT: AESTHETIC MODES, TYPOGRAPHY, COLOUR & PALETTE RULES)\n" +
            "================================================================================\n" +
            tail
          );
        } else {
          sections.set("5-palette", sec5);
        }
      }
    }

    // STEP blocks live inside "SECTION 2 — BUILD ORDER". Parse that section's body.
    const section2 = sections.get("2") || "";
    const steps = sliceBlocks(section2.split(/\r?\n/), STEP_RE, false);

    cache = { sections, steps, loaded: sections.size > 0 };
    try { cacheMtimeMs = fs.statSync(docPath).mtimeMs; } catch { /* ignore */ }
    console.log(`USCS v6.1 loaded: ${sections.size} sections, ${steps.size} step blocks.`);
  } catch (err: any) {
    console.warn(`USCS master doc could not be loaded from ${docPath}: ${err.message || err}. Falling back to core directive only.`);
    cache = { sections: new Map(), steps: new Map(), loaded: false };
  }
  return cache;
}

/**
 * Build the system-prompt context for a given UI step: the always-on core
 * directive + that step's verbatim build-order block + its detail section(s).
 */
export function buildStepContext(uiStep: number): string {
  const doc = load();
  const parts: string[] = [CORE_PREAMBLE];

  const stepIds = STEP_BLOCKS[uiStep] || [];
  let stepText = stripTrackOffer(stepIds.map(id => doc.steps.get(id)).filter(Boolean).join("\n\n")).trim();
  // Concept Intake (uiStep 1): also drop the setting/tone solicitation — they
  // have dedicated later UI steps, so asking here reads as jumping ahead.
  if (uiStep === 1) stepText = stripConceptForwardAsks(stepText).trim();
  // Other step-scoped paragraph strips (redundant-with-UI / later-step asks).
  if (STEP_PARAGRAPH_STRIPS[uiStep]) stepText = stripParagraphs(stepText, STEP_PARAGRAPH_STRIPS[uiStep]).trim();
  if (stepText) {
    parts.push(
      "================================================================================\n" +
      "BUILD-ORDER INSTRUCTION FOR THIS STEP (verbatim — USCS v6.1 Section 2)\n" +
      "================================================================================\n" +
      stepText
    );
  }

  const secIds = DETAIL_SECTIONS[uiStep] || [];
  const secText = stripTrackOffer(secIds.map(id => doc.sections.get(id)).filter(Boolean).join("\n\n")).trim();
  if (secText) {
    parts.push(
      "================================================================================\n" +
      "AUTHORITATIVE SPECIFICATION FOR THIS STEP (verbatim — USCS v6.1)\n" +
      "================================================================================\n" +
      secText
    );
  }

  return parts.join("\n\n");
}

// Per-DM-step focus directive. The full Section 27 (Dungeon Mind System) is
// injected for every DM step — it's the complete spec and the DM config is not
// subject to the story package's 20k ceiling, so the token cost is acceptable —
// and THIS scopes the model to the single field the current step produces, with
// the exact capture sentinel to emit.
const DM_STEP_FOCUS: Record<number, string> = {
  0: `CURRENT DM BUILD STEP — Concept & Scope (USCS §27.4, DM STEP 1). Help the creator LOCK: genre, which mechanics are essential (combat/skills/inventory/survival), whether death is permanent or recoverable, the dice system (d20 or custom), and complexity (light/medium/heavy). ALSO lock the CORE RESOLUTION MATH now, not later: the stat→modifier formula (e.g. floor((stat-10)/2)), how defense/AC is computed, and the base damage formula — the schema and rules are built on these. Recommend a starting stat schema for the genre per §27.3 Field 7. Do NOT write the full game rules yet, and do NOT emit any capture block this step — this is scoping discussion only.`,
  1: `CURRENT DM BUILD STEP — Stat Schema (USCS §27.3 Field 7 / §27.4 DM STEP 2). Design the stat list (each stat: name, mode Numeric/Text/Enum, one-line role). The "Alive" enum [alive] [dead] is mandatory. For every numeric resource that depletes and has a ceiling (HP, MP, Stamina), include a PAIRED Max stat (Max HP, Max MP) — the rules will reference the cap, so the cap must be a tracked stat. Target 5–15 stats. When confirmed, emit the finished schema wrapped in <<<USCS_BLOCK DM_STAT_SCHEMA>>> … <<<END USCS_BLOCK>>>.`,
  2: `CURRENT DM BUILD STEP — Game Rules (USCS §27.3 Field 3 / §27.4 DM STEP 3). Write the full Game Rules document with every applicable required section, in direct imperative voice, referencing the schema stat names exactly. EXECUTABILITY GATE — every quantity the DM must COMPUTE needs an explicit formula or table; a reference is not a definition. Before finishing, confirm NONE of these is left dangling: stat→modifier formula, defense/AC formula, the skill-check DC ladder (with numbers), the damage formula (+ weapon-die table if weapons vary), the death-save DC, progression numbers (XP per level + per-level gains), condition magnitudes (e.g. "-2 Sanity on seeing undead"), and the encumbrance threshold. Never leave "d20 + STR modifier vs. AC" without defining the modifier and AC. DEPTH — do NOT be terse: treat 3,000 tokens as a FLOOR (target 3,000–6,000, hard cap 10,000). A ruleset that names a section but omits its numbers, magnitudes, or examples is incomplete — e.g. listing "Sanity drops in horror" without the per-event amounts ("-2 on seeing undead, -1d4 on a failed fear check") fails the gate. Include a worked numeric example for each core subsystem: one sample attack with the actual math, one sample skill check, one sample condition application showing the stat change. Emit wrapped in <<<USCS_BLOCK DM_GAME_RULES>>> … <<<END USCS_BLOCK>>>.`,
  3: `CURRENT DM BUILD STEP — Game Rule Reminder (USCS §27.3 Field 4 / §27.4 DM STEP 4). Extract ONLY the 3–5 most critical, easily-forgotten rules into compressed imperative bullets (this feeds the highest-priority reminder layer). Keep under ~500 tokens. Emit wrapped in <<<USCS_BLOCK DM_REMINDER>>> … <<<END USCS_BLOCK>>>.`,
  4: `CURRENT DM BUILD STEP — Instruction (USCS §27.3 Field 5 / §27.4 DM STEP 5). Write the bridge that tells the STORY AI what the DM handles and exactly when to pause and let it resolve. Emit wrapped in <<<USCS_BLOCK DM_INSTRUCTION>>> … <<<END USCS_BLOCK>>>.`,
  5: `CURRENT DM BUILD STEP — Player Guide (USCS §27.3 Field 6 / §27.4 DM STEP 6). Write the friendly player-facing guide (system, key stats, how rolls/combat work, must-know rules). Markdown allowed. HARD LIMIT 1,000 CHARACTERS. Emit wrapped in <<<USCS_BLOCK DM_PLAYER_GUIDE>>> … <<<END USCS_BLOCK>>>.`,
  6: `CURRENT DM BUILD STEP — Name & Model (USCS §27.3 Fields 1–2 / §27.4 DM STEP 7). Propose a descriptive config name and recommend the appropriate ISK0 DM model for the ruleset's complexity. Emit EXACTLY one block whose body is "Name: <name> | Model: <model>", wrapped in <<<USCS_BLOCK DM_NAME_MODEL>>> … <<<END USCS_BLOCK>>>.`,
  7: `CURRENT DM BUILD STEP — Final Review (USCS §27.4 DM STEP 8). Present the complete DM config (all seven fields, in order) for the creator's confirmation. If they want a change, re-emit ONLY the affected field in its capture block. Do not invent new fields.`,
};

// The exact capture sentinel TYPE each capturing DM step must emit. Steps 0
// (scope discussion) and 7 (final review) produce no new capture block.
const DM_STEP_SENTINEL: Record<number, string> = {
  1: "DM_STAT_SCHEMA",
  2: "DM_GAME_RULES",
  3: "DM_REMINDER",
  4: "DM_INSTRUCTION",
  5: "DM_PLAYER_GUIDE",
  6: "DM_NAME_MODEL",
};

// A loud, literal reminder of the capture format. Weaker local models tend to
// write the content but SKIP the opening `<<<USCS_BLOCK …>>>` marker (or replace
// it with a markdown heading), which means the workshop can't save the field.
// Showing the exact required first/last line — with the concrete type — fixes
// that far more reliably than a one-line mention buried in prose.
function dmCaptureFormatReminder(type: string): string {
  return (
    "================================================================================\n" +
    "OUTPUT FORMAT — MANDATORY CAPTURE SENTINELS (the workshop parses these LITERALLY)\n" +
    "================================================================================\n" +
    "When you emit the FINISHED field, wrap it EXACTLY like this — each marker ALONE on its own line:\n\n" +
    `<<<USCS_BLOCK ${type}>>>\n` +
    "…the finished field content goes here…\n" +
    "<<<END USCS_BLOCK>>>\n\n" +
    "NON-NEGOTIABLE RULES:\n" +
    `• The FIRST line of the block MUST be exactly \`<<<USCS_BLOCK ${type}>>>\` — three '<' characters, the literal word USCS_BLOCK, a space, the type ${type}, then three '>' characters. Do NOT replace it with a markdown heading (### …), bold text (**…**), a code fence, or any prose. Do NOT skip it.\n` +
    "• The LAST line MUST be exactly `<<<END USCS_BLOCK>>>` (do NOT repeat the type on the closing marker).\n" +
    "• Put ALL conversational explanation OUTSIDE the two markers. ONLY the finished field belongs between them.\n" +
    `• If you omit the opening \`<<<USCS_BLOCK ${type}>>>\` line, the workshop CANNOT capture the field and the creator loses your work — so include it every time you finalize.`
  );
}

/**
 * Build the system-prompt context for a Dungeon Mind build step (USCS §27):
 * the core directive + the full Section 27 spec + a per-step focus directive +
 * (for capturing steps) a loud, literal capture-sentinel format reminder.
 */
export function buildDMStepContext(dmStep: number): string {
  const doc = load();
  const parts: string[] = [CORE_PREAMBLE];

  const sec27 = doc.sections.get("27");
  if (sec27) {
    parts.push(
      "================================================================================\n" +
      "AUTHORITATIVE SPECIFICATION — DUNGEON MIND SYSTEM (verbatim — USCS v6.1 §27)\n" +
      "================================================================================\n" +
      sec27
    );
  }

  const focus = DM_STEP_FOCUS[dmStep];
  if (focus) {
    parts.push(
      "================================================================================\n" +
      "CURRENT DUNGEON MIND BUILD STEP — WORK ONLY ON THIS\n" +
      "================================================================================\n" +
      focus
    );
  }

  const sentinelType = DM_STEP_SENTINEL[dmStep];
  if (sentinelType) {
    parts.push(dmCaptureFormatReminder(sentinelType));
  }

  return parts.join("\n\n");
}

/**
 * Context for the story-dm "Story + DM Review" coherence step: the core directive,
 * the full Section 27 (which contains §27.5 integration guidance), and a focus
 * directive to cross-check the assembled story package against the DM config.
 */
export function buildDMIntegrationContext(): string {
  const doc = load();
  const parts: string[] = [CORE_PREAMBLE];
  const sec27 = doc.sections.get("27");
  if (sec27) {
    parts.push(
      "================================================================================\n" +
      "AUTHORITATIVE SPECIFICATION — DUNGEON MIND SYSTEM (verbatim — USCS v6.1 §27)\n" +
      "================================================================================\n" +
      sec27
    );
  }
  parts.push(
    "================================================================================\n" +
    "STORY + DUNGEON MIND COHERENCE REVIEW — WORK ONLY ON THIS\n" +
    "================================================================================\n" +
    `Both the story package and the Dungeon Mind config are built. Per USCS §27.5, cross-check them: the Guidelines must contain a DUNGEON MIND ACTIVE rule and must NOT track stats the DM owns; the Prompt Plot must not restate game mechanics the DM handles; any module triggers must reference stat names that exist in the DM stat schema; the player persona should note which stats the player assigns. Report misalignments and, for each fix, re-emit the affected block in its capture sentinel (story blocks use their normal sentinels; DM fields use DM_* sentinels). Do not produce new deliverables — only reconcile the existing ones.`
  );
  return parts.join("\n\n");
}

export function uscsLoaded(): boolean {
  return load().loaded;
}

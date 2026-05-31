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
  0: ["3", "4"],            // modes/heat + compliance
  1: ["22", "3"],           // emotional architecture (§22.4) + setting types
  2: ["3"],                 // setting types / mode lock
  3: ["12"],                // image gen & art style profiles
  4: ["5"],                 // HTML reference (palette / card visual identity)
  5: ["15", "3"],           // naming protocol + world grounding setting rules
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

interface ParsedDoc {
  sections: Map<string, string>;
  steps: Map<string, string>;
  loaded: boolean;
}

let cache: ParsedDoc | null = null;

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
  if (cache) return cache;

  const docPath = path.join(process.cwd(), "docs", "USCS_v6.1.txt");
  try {
    const raw = fs.readFileSync(docPath, "utf-8");
    const lines = raw.split(/\r?\n/);

    const sections = sliceBlocks(lines, SECTION_RE, true);

    // STEP blocks live inside "SECTION 2 — BUILD ORDER". Parse that section's body.
    const section2 = sections.get("2") || "";
    const steps = sliceBlocks(section2.split(/\r?\n/), STEP_RE, false);

    cache = { sections, steps, loaded: sections.size > 0 };
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
  const stepText = stepIds.map(id => doc.steps.get(id)).filter(Boolean).join("\n\n");
  if (stepText) {
    parts.push(
      "================================================================================\n" +
      "BUILD-ORDER INSTRUCTION FOR THIS STEP (verbatim — USCS v6.1 Section 2)\n" +
      "================================================================================\n" +
      stepText
    );
  }

  const secIds = DETAIL_SECTIONS[uiStep] || [];
  const secText = secIds.map(id => doc.sections.get(id)).filter(Boolean).join("\n\n");
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

export function uscsLoaded(): boolean {
  return load().loaded;
}

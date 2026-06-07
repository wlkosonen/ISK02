/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { captureDeliverables, type Deliverables, type DMConfig } from "./lib/capture";
import { 
  Settings, 
  BookOpen, 
  Users, 
  Image as ImageIcon, 
  FileText, 
  CheckCircle2, 
  ChevronRight, 
  ChevronLeft,
  Terminal,
  Zap,
  Sword,
  Shield,
  Heart,
  Palette,
  Layout,
  MessageSquare,
  Sparkles,
  Save,
  Download,
  AlertTriangle,
  X,
  Cpu,
  ShieldAlert,
  Compass,
  HelpCircle,
  RefreshCw,
  Eye,
  EyeOff,
  Star,
  Copy,
  Check
} from "lucide-react";

// --- Types ---

type Mode = "SFW" | "NSFW";
type HeatLevel = 1 | 2 | 3 | 4 | 5;

interface MessageUsage {
  input: number;     // uncached input tokens (full price)
  output: number;    // output tokens
  cacheRead: number; // input tokens served from cache (~10% price)
  cacheWrite: number;// input tokens written to cache (~125% price, one-time)
}
interface Message {
  role: "user" | "assistant";
  content: string;
  usage?: MessageUsage; // present on assistant turns when the provider reports it (Anthropic)
  streaming?: boolean;  // transient: true while tokens are still arriving for this turn
}

// Cleans the live-streaming buffer for display: hides capture sentinels and
// UI-sync tags so the user sees readable prose instead of raw protocol noise as
// it streams. The FULL raw text is still processed (captured, parsed) on
// completion — this only affects the in-flight view.
function cleanStreamingText(raw: string): string {
  let t = raw;
  // Completed capture blocks -> compact note
  t = t.replace(/<<<USCS_BLOCK\s+([A-Z_]+)(?::[^>\n]*)?>>>[\s\S]*?<<<END\s+USCS_BLOCK(?:[ \t:]+[^>\n]*)?>>>/g, (_m, type) => `\n〔✓ ${type} captured〕\n`);
  // In-progress (still streaming, unclosed) capture block at the tail -> spinner note
  t = t.replace(/<<<USCS_BLOCK\s+([A-Z_]+)(?::[^>\n]*)?>>>[\s\S]*$/g, (_m, type) => `\n〔⏳ generating ${type}…〕\n`);
  // Strip control + completed SET_* tags
  t = t.replace(/\[SYNC_PROCEED\]/gi, "");
  t = t.replace(/\[SET_[A-Z_]+:[^\]]*\]/gi, "");
  return t.replace(/\n{3,}/g, "\n\n").trim();
}

// Captured story-package deliverables. The "counting" fields (promptPlot,
// guidelines, reminders, playerPersona, characters[].desc, firstMessages[].content)
// all count toward the 20k platform ceiling — including first messages, which ISK0
// counts too. The rest (HTML cards, scenarios planning, image prompts) are part of
// the export but do NOT count toward the budget.
// Deliverable types (CharacterDeliverable, DMConfig, Deliverables) live in
// ./lib/capture, next to the capture parser that produces them.
const EMPTY_DM_CONFIG: DMConfig = {
  name: "", model: "", statSchema: "", gameRules: "", gameRuleReminder: "", instruction: "", playerGuide: "",
};

const EMPTY_DELIVERABLES: Deliverables = {
  titleSummary: "", plotCard: "", promptPlot: "", guidelines: "",
  reminders: "", playerPersona: "", scenarios: "", imagePrompts: "", characters: [], firstMessages: [],
  dmConfig: { ...EMPTY_DM_CONFIG },
};

// §21 base per-section token caps (defaults). A creator-set custom limit overrides
// the default for that block; null = use the default.
const SECTION_CAPS = { promptPlot: 2500, guidelines: 3000, reminders: 800, characters: 1500 } as const;

// Dungeon Mind platform caps (USCS §27). Game Rules / Reminder are token caps;
// Player Guide is a CHARACTER cap (special-cased — the platform measures chars).
const DM_CAPS = { gameRules: 10000, gameRuleReminder: 500, playerGuideChars: 1000 } as const;

// Which pipeline the creator is building. "story" = the 16-step narrative package
// (default). "dm-only" = just a Dungeon Mind game-mechanics config (USCS §27), no
// story. "story-dm" = a full story package WITH a DM attached (story steps then DM
// steps). Replaces the old isDMOnly boolean (which was a mislabeled story stub).
type WorkshopTrack = "story" | "dm-only" | "story-dm";

interface StoryState {
  step: number;
  mode: Mode | null;
  heatLevel: HeatLevel;
  workshopTrack: WorkshopTrack;
  concept: string;
  settingType: string;
  tone: string;
  artStyle: string;
  imageService: string;
  palette: string[];
  aestheticMode: "Literary" | "Structured" | "Chaos";
  groundingRules: string;
  title: string;
  summary: string;
  tokenBudgetMin: number;
  tokenBudgetMax: number;
  budgetTierMode: boolean;
  // Per-component overrides: relax the §21 cap for these blocks (richer output),
  // while the 20k total platform ceiling still holds.
  customLimits: { promptPlot: number | null; guidelines: number | null; reminders: number | null; characters: number | null };
  leanGuidelines: boolean;   // Guidelines step "Compact mode" — assemble a leaner rule set
  deliverables: Deliverables;
  assistantHistory: Message[];
  isAssistantLoading: boolean;
  aiProvider: "gemini" | "anthropic" | "ollama" | "openrouter" | "mistral";
  modelSettings: {
    model: string;
    temperature: number;
    maxTokens: number;
    maxTokensTouched?: boolean;  // user moved the slider → stop auto-defaulting per model
    ollamaBaseUrl?: string;
    geminiApiKey?: string;
    anthropicApiKey?: string;
    openRouterApiKey?: string;
    mistralApiKey?: string;
  };
}

const STEPS = [
  "Mode Selection",
  "Concept Intake",
  "Setting & Tone",
  "Art Style Profile",
  "Palette & Identity",
  "World Grounding",
  "Title & Summary",
  "Plot Card",
  "Character Sheets",
  "Scenario & System Planning",
  "Prompt Plot",
  "Guidelines",
  "Reminders",
  "First Message",
  "Image Prompts",
  "Compliance & Assembly"
];

// Dungeon Mind build pipeline (USCS §27.4). Index here = the DM sub-step passed to
// the server to fetch the matching Section 27 slice (buildDMStepContext).
const DM_STEPS = [
  "DM Concept & Scope",
  "Stat Schema",
  "Game Rules",
  "Game Rule Reminder",
  "Story-AI Instruction",
  "Player Guide",
  "Name & Model",
  "DM Final Review",
];

const TRACK_LABELS: Record<WorkshopTrack, string> = {
  "story": "Full Story Package",
  "dm-only": "Dungeon Mind only",
  "story-dm": "Story + Dungeon Mind",
};

// A planned step in the active pipeline. EXACTLY one of story/dm is set, OR
// combined=true (the story-dm coherence wrap-up). `story` indexes STEPS + the
// renderStep switch; `dm` indexes DM_STEPS + renderDMStep.
interface PlannedStep { label: string; story?: number; dm?: number; combined?: boolean }

// The ordered step plan for a track. This is the single source of truth for what
// runs where — decoupling a step's PLAN POSITION (state.step) from the story/DM
// sub-index used to fetch its content, which lets story-dm interleave the two.
function getStepPlan(track: WorkshopTrack): PlannedStep[] {
  if (track === "dm-only") {
    return [{ label: STEPS[0], story: 0 }, ...DM_STEPS.map((label, i) => ({ label, dm: i }))];
  }
  if (track === "story-dm") {
    // Mode Selection → Concept Intake → (pull DM Scope + Stat Schema EARLY so the
    // real stat names exist before Guidelines/Prompt Plot) → rest of the story →
    // remaining DM fields after assembly → a final Story + DM coherence review.
    const plan: PlannedStep[] = [
      { label: STEPS[0], story: 0 },        // Mode Selection
      { label: STEPS[1], story: 1 },        // Concept Intake
      { label: DM_STEPS[0], dm: 0 },        // DM Concept & Scope
      { label: DM_STEPS[1], dm: 1 },        // Stat Schema
    ];
    for (let i = 2; i < STEPS.length; i++) plan.push({ label: STEPS[i], story: i }); // Setting & Tone … Compliance & Assembly
    for (let i = 2; i < DM_STEPS.length; i++) plan.push({ label: DM_STEPS[i], dm: i }); // Game Rules … DM Final Review
    plan.push({ label: "Story + DM Review", combined: true });
    return plan;
  }
  return STEPS.map((label, i) => ({ label, story: i }));
}

// Label list for the active track (used for the pipeline UI, progress dots, etc.).
function getActiveSteps(track: WorkshopTrack): string[] {
  return getStepPlan(track).map(p => p.label);
}

// Per-step OUTPUT COMPLETENESS gates for the heavy craft steps. The full spec is
// already injected server-side (verbatim USCS sections); this is a terse checklist
// that stops weaker models from abbreviating a multi-part deliverable down to a
// few parts, and reminds them to wrap the result for capture. It reinforces — does
// NOT replace — the injected specification. Steps without an entry have no gate.
const STEP_MANDATES: Record<number, string> = {
  6: `Produce BOTH a Title and a ~20-word user-facing Plot Summary. Wrap the finished pair in <<<USCS_BLOCK TITLE_SUMMARY>>> … <<<END USCS_BLOCK>>>.`,
  7: `Produce the COMPLETE Plot Card (user-facing HTML) with every required field from the spec — do not abbreviate. Wrap it in <<<USCS_BLOCK PLOT_CARD>>> … <<<END USCS_BLOCK>>>.`,
  8: `ONE FULL sheet PER character — primary AND supporting, no exceptions, no "secondary" shortcuts. Each character gets BOTH parts: Part A HTML card → <<<USCS_BLOCK CHAR_CARD: [character's real name]>>>, and Part B AI prompt description → <<<USCS_BLOCK CHAR_DESC: [character's real name]>>>. ALWAYS substitute the character's ACTUAL name into the sentinel (e.g. "CHAR_DESC: Aria Vance") — never emit the literal word "Name", or the workshop will create a junk placeholder character. Respect §21 caps on Part B (≤1500 primary / ≤800 supporting). Build and confirm one character fully before starting the next.`,
  9: `Produce 2–3 DISTINCT scenario variants (alternative entry points) per the spec. Wrap the finished set in <<<USCS_BLOCK SCENARIOS>>> … <<<END USCS_BLOCK>>>.`,
  10: `The Prompt Plot MUST contain ALL Section 6 required subsections, IN ORDER: 1) Quick Reference, 2) {{user}}'s Role, 3) Narrative Perspective, 4) Primary Dramatic Engine, 5) Core Conflict Management, 6) Agency Protection, 7) Setting Description, 8) World Grounding / Genre Anchor, 9) Genre Mechanics, 10) Heat Level Guidelines (NSFW only), 11) Pacing & Revelation / Phase Structure — PLUS the mandatory Architect Protocol block (Section 6A). If a subsection is genuinely N/A (e.g. Heat Guidelines in SFW, Genre Mechanics in a plain contemporary story), write its heading followed by "N/A — <reason>"; NEVER drop one silently. Wrap the finished Prompt Plot (Architect Protocol included) in <<<USCS_BLOCK PROMPT_PLOT>>> … <<<END USCS_BLOCK>>>.`,
  11: `The Guidelines MUST: open with the one-paragraph Emotional Mandate (§22.4); contain at least 15 behavioral rules; include Section 7A (NPC Social Web / Anti-Harem) IN FULL if the story has 2+ NPCs; include Section 7B rules if a Status Dashboard is active; include module integration if the Module System is active. Do not abbreviate. Wrap in <<<USCS_BLOCK GUIDELINES>>> … <<<END USCS_BLOCK>>>.`,
  12: `Reminders are non-negotiable rules ONLY (plus a keys-only Quick Reference and the critical character table) — never re-state Plot/Guidelines prose. Keep within the §21 cap (≤800 tok). Wrap in <<<USCS_BLOCK REMINDERS>>> … <<<END USCS_BLOCK>>>.`,
  14: `Produce every required prompt per the spec (at minimum: portrait, cover, and title-edit image prompts, plus one emotion-edit set per character). Wrap the finished set in <<<USCS_BLOCK IMAGE_PROMPTS>>> … <<<END USCS_BLOCK>>>.`,
};

const PROVIDERS = {
  gemini: {
    name: "Google Gemini",
    // Fallback list only — the live model list is fetched from the API when a key is set.
    models: ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash"],
  },
  anthropic: {
    name: "Anthropic Claude",
    models: ["claude-3-5-sonnet-20241022", "claude-3-5-haiku-20241022", "claude-3-opus-20240229"],
  },
  ollama: {
    name: "Local Ollama",
    models: ["llama3", "gemma2", "mistral", "phi3", "deepseek-coder"],
  },
  openrouter: {
    name: "OpenRouter",
    // Fallback list only — the full live list (300+ models) is fetched from
    // openrouter.ai/api/v1/models. Models tagged ":free" cost nothing.
    models: [
      "deepseek/deepseek-chat-v3-0324:free",
      "google/gemini-2.0-flash-exp:free",
      "meta-llama/llama-3.3-70b-instruct:free",
      "anthropic/claude-3.5-sonnet",
      "openai/gpt-4o-mini",
      "x-ai/grok-2-1212",
    ],
  },
  mistral: {
    name: "Mistral AI",
    // Fallback list only — the live list is fetched from api.mistral.ai/v1/models
    // when a key is set. Default is Medium 3.5: best-suited here (strong creative
    // writing + precise instruction-following, dense 128B, cheaper than Large 3).
    models: [
      "mistral-medium-latest",
      "mistral-large-latest",
      "mistral-small-latest",
      "ministral-8b-latest",
      "open-mistral-nemo",
      "magistral-medium-latest",
    ],
  }
};

const SETTING_TYPES = [
  "Contemporary Real World",
  "Fantasy / High Fantasy",
  "Isekai",
  "Sci-Fi / Futuristic / Cyberpunk",
  "Historical / Period",
  "Modern Supernatural",
  "Horror / Psychological",
  "Post-Apocalyptic / Survival"
];

const ART_STYLE_TEMPLATES = [
  "Anime / VN Style",
  "Cyberpunk / Neon Noir",
  "Classic Oil Painting",
  "Digital Illustration (Flat)",
  "Gothic / Dark Fantasy",
  "Minimalist Vector"
];

// NOTE: The USCS v6.1 system prompt is no longer embedded in the client.
// The server (uscs.ts) loads the unaltered master document (docs/USCS_v6.1.txt)
// and injects the always-on core directive + only the verbatim slice for the
// CURRENT step. The client supplies the dynamic deskstate + [SET_*] sync protocol
// (see askAssistant below). This keeps each request lean while giving the model
// the full-depth specification instead of a watered-down summary.

const IMAGE_SERVICES = ["Midjourney", "DALL-E 3", "Stable Diffusion", "NovelAI", "Flux", "Other"];

// Target size for the AI INSTRUCTION PACKAGE (Prompt Plot + Guidelines + Reminders
// + Character AI descriptions + Player Persona). Per USCS §21.1 the platform ceiling
// is 20k tokens for this package; HTML cards and image/location prompts do NOT count.
const BUDGET_PRESETS: { label: string; min: number; max: number; hint: string; tier?: boolean }[] = [
  { label: "Budget", min: 4000, max: 7000, hint: "Free/budget models · stays under the 'complex narrative' tag", tier: true },
  { label: "Standard", min: 7000, max: 10000, hint: "~1–2 characters · quality-first" },
  { label: "Rich", min: 10000, max: 15000, hint: "~3–4 characters · gains the 'complex narrative' tag" },
  { label: "Max", min: 15000, max: 20000, hint: "~5–6 characters · near the 20k platform ceiling" },
];

// Version of THIS app (the Aether_Core tool), distinct from the USCS framework
// version it implements. Bump this when you ship changes.
const APP_VERSION = "0.11.0";
// Version of the USCS framework/spec this build targets (docs/USCS_v6.1.txt).
const USCS_VERSION = "6.1";

// --- Session persistence ---
// Story state, chat history and typed API keys survive a page reload (per tab).
const STORAGE_KEY = "aether_core_state_v1";

// Favourite models persist across sessions (localStorage), keyed by provider,
// so the user doesn't re-search the 300+ OpenRouter list every time.
const FAV_STORAGE_KEY = "aether_core_favourites_v1";
function loadFavourites(): Record<string, string[]> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(FAV_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return {};
}

// Docked-width + floating-window size persist across sessions so a creator who
// has sized the collaborator chat to their screen doesn't reset to defaults on
// every reload.
const CHAT_LAYOUT_KEY = "aether_core_chat_layout_v1";
function loadChatLayout(): { dockedChatWidth: number; chatSize: { width: number; height: number } } {
  const fallback = { dockedChatWidth: 384, chatSize: { width: 400, height: 600 } };
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(CHAT_LAYOUT_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      return {
        dockedChatWidth: typeof p.dockedChatWidth === "number" ? p.dockedChatWidth : fallback.dockedChatWidth,
        chatSize: p.chatSize && typeof p.chatSize.width === "number" ? p.chatSize : fallback.chatSize,
      };
    }
  } catch { /* ignore */ }
  return fallback;
}

const DEFAULT_STATE: StoryState = {
  step: 0,
  mode: null,
  heatLevel: 1,
  workshopTrack: "story",
  concept: "",
  settingType: "",
  tone: "",
  artStyle: "Anime/VN Style",
  imageService: "Midjourney",
  palette: ["#1a1a24", "#f8f8f8", "#14b8a6", "#f43f5e", "#fbbf24"],
  aestheticMode: "Structured",
  groundingRules: "",
  title: "",
  summary: "",
  tokenBudgetMin: 7000,
  tokenBudgetMax: 10000,
  budgetTierMode: false,
  customLimits: { promptPlot: null, guidelines: null, reminders: null, characters: null },
  leanGuidelines: false,
  deliverables: EMPTY_DELIVERABLES,
  assistantHistory: [],
  isAssistantLoading: false,
  aiProvider: "gemini",
  modelSettings: {
    model: "gemini-2.5-flash",
    temperature: 1.0,
    maxTokens: 8192,  // default to the model's output ceiling (see getModelTokenCeiling);
                      // refreshed per model on change unless the user sets it manually
    geminiApiKey: "",
    anthropicApiKey: "",
    openRouterApiKey: "",
    mistralApiKey: "",
  },
};

// --- Deskstate sync: single source of truth -------------------------------
// "Has the creator changed a synced parameter since the AI last saw it?" is
// driven by ONE field list. isSyncNeeded, the change summary in the sync toast,
// and the post-sync baseline snapshot all derive from it — so adding a synced
// field is a single entry here, not three parallel edits that silently drift
// (the old failure mode: forget to compare or snapshot a new field and a change
// either never triggers a sync, or is forgotten the moment one fires).
type DeskSnapshot = Pick<StoryState,
  "mode" | "heatLevel" | "workshopTrack" | "concept" | "settingType" | "tone" |
  "artStyle" | "palette" | "aestheticMode" | "groundingRules" | "title" | "summary" |
  "tokenBudgetMin" | "tokenBudgetMax" | "budgetTierMode" | "customLimits" | "step">;

const deskArrEq = (a: string[], b: string[]) => a.join(",") === b.join(",");
const deskJsonEq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const tokenBudgetLabel = (s: StoryState) => `Token Budget: ~${s.tokenBudgetMin / 1000}k–${s.tokenBudgetMax / 1000}k`;

// key = both the StoryState field and its snapshot slot; eq overrides strict
// equality for arrays/objects; label (optional) is the human line in the sync toast.
const DESKSTATE_FIELDS: { key: keyof DeskSnapshot; eq?: (a: any, b: any) => boolean; label?: (s: StoryState) => string }[] = [
  { key: "mode", label: s => `Mode: ${s.mode || "None"}` },
  { key: "heatLevel", label: s => `Heat: ${s.heatLevel}` },
  { key: "workshopTrack", label: s => `Track: ${TRACK_LABELS[s.workshopTrack]}` },
  { key: "concept", label: () => "Narrative Seed modified" },
  { key: "settingType", label: s => `Setting: ${s.settingType || "None"}` },
  { key: "tone", label: s => `Tone: ${s.tone || "None"}` },
  { key: "artStyle", label: s => `Style: ${s.artStyle}` },
  { key: "palette", eq: deskArrEq, label: () => "Visual Palette updated" },
  { key: "aestheticMode", label: s => `Aesthetic Mode: ${s.aestheticMode}` },
  { key: "groundingRules", label: () => "Grounding Rules modified" },
  { key: "title", label: s => `Title: ${s.title || "Untitled"}` },
  { key: "summary", label: () => "Narrative Summary modified" },
  // Min/Max share one label; the Set in the sync handler dedupes when both move.
  { key: "tokenBudgetMin", label: tokenBudgetLabel },
  { key: "tokenBudgetMax", label: tokenBudgetLabel },
  { key: "budgetTierMode", label: s => `Budget-Tier Mode: ${s.budgetTierMode ? "ON" : "OFF"}` },
  { key: "customLimits", eq: deskJsonEq, label: () => "Custom section limits changed" },
  { key: "step", label: s => `Moved to Step: ${s.step + 1} (${getActiveSteps(s.workshopTrack)[s.step]})` },
];

function deskSnapshot(s: StoryState): DeskSnapshot {
  return {
    mode: s.mode, heatLevel: s.heatLevel, workshopTrack: s.workshopTrack,
    concept: s.concept, settingType: s.settingType, tone: s.tone, artStyle: s.artStyle,
    palette: [...s.palette], aestheticMode: s.aestheticMode, groundingRules: s.groundingRules,
    title: s.title, summary: s.summary, tokenBudgetMin: s.tokenBudgetMin, tokenBudgetMax: s.tokenBudgetMax,
    budgetTierMode: s.budgetTierMode, customLimits: { ...s.customLimits }, step: s.step,
  };
}

// The synced fields whose value differs from the AI's last-seen baseline.
function deskFieldsChanged(s: StoryState, last: DeskSnapshot) {
  return DESKSTATE_FIELDS.filter(f => {
    const eq = f.eq ?? ((a, b) => a === b);
    return !eq((s as any)[f.key], (last as any)[f.key]);
  });
}

// True if loadInitialState restored a non-trivial prior session (used to warn
// the user they're resuming an old story rather than starting fresh).
let SESSION_RESTORED = false;

// Resolve the workshop track from persisted/loaded data, migrating the legacy
// isDMOnly boolean. A valid new value wins; otherwise default to the story track.
function migrateTrack(parsed: any): WorkshopTrack {
  if (parsed?.workshopTrack === "dm-only" || parsed?.workshopTrack === "story-dm" || parsed?.workshopTrack === "story") {
    return parsed.workshopTrack;
  }
  return "story";
}

function loadInitialState(): StoryState {
  if (typeof window === "undefined") return DEFAULT_STATE;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Did the prior session actually contain creative work?
      SESSION_RESTORED = !!(
        (parsed.assistantHistory && parsed.assistantHistory.length) ||
        parsed.step || parsed.concept || parsed.mode || parsed.title || parsed.settingType
      );
      return {
        ...DEFAULT_STATE,
        ...parsed,
        // Never restore a transient "loading" flag from a previous session.
        isAssistantLoading: false,
        // Migrate the legacy isDMOnly boolean: the old toggle produced a story
        // package regardless, so map any prior session to the story track.
        workshopTrack: migrateTrack(parsed),
        modelSettings: { ...DEFAULT_STATE.modelSettings, ...(parsed.modelSettings || {}) },
        deliverables: { ...EMPTY_DELIVERABLES, ...(parsed.deliverables || {}), dmConfig: { ...EMPTY_DM_CONFIG, ...(parsed.deliverables?.dmConfig || {}) } },
        customLimits: { ...DEFAULT_STATE.customLimits, ...(parsed.customLimits || {}) },
      };
    }
  } catch (err) {
    console.warn("Could not restore saved workshop state:", err);
  }
  return DEFAULT_STATE;
}

// Per-model output-token ceilings, so the Max_Tokens slider can't exceed what a
// model actually accepts (e.g. Claude 3 Opus / Haiku cap at 4096).
function getModelTokenCeiling(_provider: string, model: string): number {
  // Claude 3 Opus / Haiku cap output at 4096 — whether called natively or via
  // OpenRouter (e.g. "anthropic/claude-3-opus"). Everything else: 8192.
  if (/claude-3-opus/.test(model) || /claude-3-haiku/.test(model)) return 4096;
  return 8192;
}

// Strip the real-time UI-sync tags ([SET_*], [SYNC_PROCEED]) from exported text.
function stripSyncTags(text: string): string {
  return text.replace(/\[(?:SET_[A-Z_]+:[^\]]*|SYNC_PROCEED)\]/gi, "").trim();
}

// Rough token estimate (~4 chars/token). Used for the budget gauge — applied to
// the captured deliverables only, so it reflects the real package, not chat.
function estimateTokens(text: string): number {
  return Math.round((text || "").length / 4);
}

// Parse a #rgb / #rrggbb hex string to an [r,g,b] triple, or null if not a hex.
function hexToRgb(hex: string): [number, number, number] | null {
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
function recolorHtml(html: string, from: string[] | undefined, to: string[]): string {
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

// DELIVERABLE_LABELS, BLOCK_RE, isPlaceholderCharName and captureDeliverables
// now live in ./lib/capture (pure + unit-tested in capture.test.ts).

// Tokens that count toward the USCS §21.1 platform ceiling.
function countingPackageTokens(d: Deliverables): number {
  const counted = [d.promptPlot, d.guidelines, d.reminders, d.playerPersona, ...d.characters.map(c => c.desc), ...d.firstMessages.map(f => f.content)]
    .filter(Boolean).join("\n");
  return estimateTokens(counted);
}

function sanitizeFilename(name: string): string {
  return (name || "ISK0_Story").trim().replace(/[^\w\- ]+/g, "").replace(/\s+/g, "_").slice(0, 60) || "ISK0_Story";
}

// Trigger a browser download of a plain-text file.
function downloadTextFile(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// --- Components ---

export default function App() {
  const [showSettings, setShowSettings] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [showRestoreNotice, setShowRestoreNotice] = useState(SESSION_RESTORED);
  const [favourites, setFavourites] = useState<Record<string, string[]>>(loadFavourites);

  useEffect(() => {
    try { window.localStorage.setItem(FAV_STORAGE_KEY, JSON.stringify(favourites)); } catch { /* ignore */ }
  }, [favourites]);

  const toggleFavourite = (provider: string, m: string) => {
    setFavourites(f => {
      const list = f[provider] || [];
      const next = list.includes(m) ? list.filter(x => x !== m) : [...list, m];
      return { ...f, [provider]: next };
    });
  };
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [isXL, setIsXL] = useState(false);
  const [isShort, setIsShort] = useState(false); // short viewport height — drives compact chat density
  const [isChatDetached, setIsChatDetached] = useState(false);
  const [chatPosition, setChatPosition] = useState({ x: 0, y: 0 });
  const [chatSize, setChatSize] = useState(() => loadChatLayout().chatSize);
  const [dockedChatWidth, setDockedChatWidth] = useState(() => loadChatLayout().dockedChatWidth); // Default w-96
  const [hoverHeatLevel, setHoverHeatLevel] = useState<HeatLevel | null>(null);

  useEffect(() => {
    const checkScreen = () => {
      setIsMobile(window.innerWidth < 1024);
      setIsXL(window.innerWidth >= 1280);
      setIsShort(window.innerHeight < 820);
    };
    checkScreen();
    window.addEventListener('resize', checkScreen);
    return () => window.removeEventListener('resize', checkScreen);
  }, []);

  useEffect(() => {
    try { window.localStorage.setItem(CHAT_LAYOUT_KEY, JSON.stringify({ dockedChatWidth, chatSize })); } catch { /* ignore */ }
  }, [dockedChatWidth, chatSize]);

  const [lastSyncedState, setLastSyncedState] = useState<DeskSnapshot>(() => deskSnapshot(DEFAULT_STATE));

  const [toast, setToast] = useState<{ message: string; type: "ai-to-ui" | "ui-to-ai" | "info" } | null>(null);

  const triggerToast = (message: string, type: "ai-to-ui" | "ui-to-ai" | "info") => {
    setToast({ message, type });
  };

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => {
        setToast(null);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const [state, setState] = useState<StoryState>(loadInitialState);

  // The ordered step plan for the current track and the current planned step.
  // `cur` tells us whether the creator is on a story step, a DM step, or the
  // combined review — and which sub-index — without assuming DM steps are
  // contiguous (story-dm interleaves them). activeSteps = the label list.
  const stepPlan = getStepPlan(state.workshopTrack);
  const cur = stepPlan[Math.min(state.step, stepPlan.length - 1)] || stepPlan[0];
  const activeSteps = stepPlan.map(p => p.label);

  // Persist the workshop to sessionStorage on every change (minus the transient
  // loading flag) so a reload doesn't wipe story progress, chat, or typed keys.
  useEffect(() => {
    try {
      const { isAssistantLoading, ...persistable } = state;
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(persistable));
    } catch (err) {
      console.warn("Could not persist workshop state:", err);
    }
  }, [state]);

  const [localOllamaModels, setLocalOllamaModels] = useState<string[]>([]);
  const [ollamaError, setOllamaError] = useState<string | null>(null);
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [showGeminiKey, setShowGeminiKey] = useState(false);
  const [showAnthropicKey, setShowAnthropicKey] = useState(false);
  const [showOpenRouterKey, setShowOpenRouterKey] = useState(false);
  const [showMistralKey, setShowMistralKey] = useState(false);
  const [remoteModels, setRemoteModels] = useState<string[]>([]);
  const [isFetchingRemoteModels, setIsFetchingRemoteModels] = useState(false);
  const [remoteModelError, setRemoteModelError] = useState<string | null>(null);
  const [modelFilter, setModelFilter] = useState("");
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState("");
  // Soft advance-gate: armed when the AI signals the current step is complete
  // ([SYNC_PROCEED]). Prompts the user to advance, but never forces or blocks it.
  const [readyToAdvance, setReadyToAdvance] = useState(false);
  // Set when the last response hit the Max_Tokens wall (finish reason = length).
  const [responseTruncated, setResponseTruncated] = useState(false);

  // Disarm the gate whenever the step changes (advance / revert / sidebar jump).
  useEffect(() => { setReadyToAdvance(false); }, [state.step]);

  // Fetch initial configuration from server to get correct OLLAMA_BASE_URL default
  useEffect(() => {
    async function fetchConfig() {
      try {
        const res = await fetch("/api/config");
        if (res.ok) {
          const config = await res.json();
          if (config.ollamaBaseUrl) {
            setState(s => ({
              ...s,
              modelSettings: {
                ...s.modelSettings,
                ollamaBaseUrl: s.modelSettings.ollamaBaseUrl || config.ollamaBaseUrl
              }
            }));
          }
        }
      } catch (err) {
        console.warn("Could not fetch server config:", err);
      }
    }
    fetchConfig();
  }, []);

  // Fetch Ollama models whenever Provider is Ollama or the base URL is changed
  useEffect(() => {
    if (state.aiProvider !== "ollama") return;

    const controller = new AbortController();
    let isMounted = true;

    async function fetchModels() {
      setIsFetchingModels(true);
      setOllamaError(null);
      const url = state.modelSettings.ollamaBaseUrl || "http://localhost:11434";
      try {
        let fetchedModels: string[] = [];
        let success = false;
        
        // Try server-side proxy fetch first
        try {
          const res = await fetch(`/api/ollama/models?url=${encodeURIComponent(url)}`, {
            signal: controller.signal
          });
          if (res.ok) {
            const data = await res.json();
            fetchedModels = data.models || [];
            success = true;
          } else {
            const errorData = await res.json().catch(() => ({}));
            console.info("Server proxy for Ollama model-fetch returned status:", res.status, errorData);
          }
        } catch (srvErr) {
          console.info("Server proxy for Ollama model-fetch failed. Trying client-side fallback...");
        }

        // If server-side proxy failed, try direct browser-side fetch to local Ollama (CORS needs to be allowed)
        if (!success) {
          let directUrl = url;
          if (directUrl.includes("host.docker.internal")) {
            directUrl = directUrl.replace("host.docker.internal", "localhost");
          }
          const directRes = await fetch(`${directUrl}/api/tags`, {
            signal: controller.signal
          });
          if (directRes.ok) {
            const data = await directRes.json();
            fetchedModels = (data.models || []).map((m: any) => m.name);
            success = true;
          } else {
            throw new Error(`Could not connect to Ollama at ${url}. Please verify that Ollama is running ('ollama serve') and accessible.`);
          }
        }

        if (isMounted && success) {
          setLocalOllamaModels(fetchedModels);
          setOllamaError(null);
          
          // If the currently selected model is NOT in the list of local models, 
          // and we have local models available, auto-select the first one.
          if (fetchedModels.length > 0) {
            const currentModel = state.modelSettings.model;
            // Match with or without tag
            const hasExactModel = fetchedModels.some((m: string) => m.toLowerCase() === currentModel.toLowerCase());
            const hasTaglessModel = fetchedModels.some((m: string) => m.split(":")[0]?.toLowerCase() === currentModel.toLowerCase());
            
            if (!hasExactModel && !hasTaglessModel) {
              setState(s => ({
                ...s,
                modelSettings: {
                  ...s.modelSettings,
                  model: fetchedModels[0]
                }
              }));
            }
          }
        }
      } catch (err: any) {
        if (err.name !== "AbortError" && isMounted) {
          console.info("Error fetching Ollama models:", err);
          setOllamaError(err.message || "Failed to connect to local Ollama daemon");
          setLocalOllamaModels([]);
        }
      } finally {
        if (isMounted) {
          setIsFetchingModels(false);
        }
      }
    }

    const timeoutId = setTimeout(() => {
      fetchModels();
    }, 500);

    return () => {
      isMounted = false;
      controller.abort();
      clearTimeout(timeoutId);
    };
  }, [state.aiProvider, state.modelSettings.ollamaBaseUrl]);

  // Fetch live, up-to-date model lists for hosted providers (Anthropic / Gemini).
  useEffect(() => {
    const HOSTED = ["anthropic", "gemini", "openrouter", "mistral"];
    if (!HOSTED.includes(state.aiProvider)) {
      setRemoteModels([]);
      setRemoteModelError(null);
      return;
    }

    const provider = state.aiProvider;
    const key = provider === "anthropic"
      ? state.modelSettings.anthropicApiKey?.trim()
      : provider === "gemini"
      ? state.modelSettings.geminiApiKey?.trim()
      : provider === "mistral"
      ? state.modelSettings.mistralApiKey?.trim()
      : state.modelSettings.openRouterApiKey?.trim();

    const controller = new AbortController();
    let isMounted = true;

    async function fetchRemoteModels() {
      setIsFetchingRemoteModels(true);
      setRemoteModelError(null);
      try {
        const q = new URLSearchParams({ provider });
        if (key) q.set("key", key);
        const res = await fetch(`/api/models?${q.toString()}`, { signal: controller.signal });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `Status ${res.status}`);
        if (isMounted) setRemoteModels(data.models || []);
      } catch (err: any) {
        if (err.name !== "AbortError" && isMounted) {
          setRemoteModelError(err.message || "Could not list models");
          setRemoteModels([]);
        }
      } finally {
        if (isMounted) setIsFetchingRemoteModels(false);
      }
    }

    const timeoutId = setTimeout(fetchRemoteModels, 400);
    return () => { isMounted = false; controller.abort(); clearTimeout(timeoutId); };
  }, [state.aiProvider, state.modelSettings.anthropicApiKey, state.modelSettings.geminiApiKey, state.modelSettings.openRouterApiKey, state.modelSettings.mistralApiKey]);

  // Max_Tokens follows the active model's real output ceiling. Until the creator
  // moves the slider themselves (maxTokensTouched), we DEFAULT it to that ceiling
  // on every model/provider change — so a model that can emit 8k isn't silently
  // stuck at an old 4k value and truncating long HTML cards / guideline sets. Once
  // touched, we only clamp DOWN to the new ceiling and never override their choice.
  useEffect(() => {
    const ceiling = getModelTokenCeiling(state.aiProvider, state.modelSettings.model);
    setState(s => {
      const target = s.modelSettings.maxTokensTouched
        ? Math.min(s.modelSettings.maxTokens, ceiling)
        : ceiling;
      if (target === s.modelSettings.maxTokens) return s;
      return { ...s, modelSettings: { ...s.modelSettings, maxTokens: target } };
    });
  }, [state.aiProvider, state.modelSettings.model]);

  const providerFavourites = favourites[state.aiProvider] || [];
  const isFavourite = (m: string) => providerFavourites.includes(m);
  const selectModel = (m: string) => setState(s => ({ ...s, modelSettings: { ...s.modelSettings, model: m } }));

  // A model row with select + a favourite star (used across all provider lists).
  const renderModelRow = (m: string, badge?: React.ReactNode) => {
    const selected = state.modelSettings.model === m;
    const fav = isFavourite(m);
    return (
      <div key={m} className={`flex items-center rounded-lg border transition-all ${selected ? "border-accent bg-accent/5" : "border-border bg-bg hover:bg-white/5"}`}>
        <button onClick={() => selectModel(m)} className={`flex-1 min-w-0 p-3 text-left text-[11px] font-mono flex items-center justify-between gap-2 ${selected ? "text-accent" : "text-text-dim hover:text-text-muted"}`}>
          <span className="truncate">{m}</span>
          {badge}
        </button>
        <button
          onClick={() => toggleFavourite(state.aiProvider, m)}
          title={fav ? "Remove from favourites" : "Add to favourites"}
          className="p-2.5 shrink-0 text-text-dim hover:text-[#fbbf24] transition-colors"
        >
          <Star className={`w-3.5 h-3.5 ${fav ? "fill-[#fbbf24] text-[#fbbf24]" : ""}`} />
        </button>
      </div>
    );
  };
  const freeBadge = <span className="text-[8px] bg-[#10b981]/15 text-[#10b981] px-1.5 py-0.5 rounded uppercase font-bold tracking-widest font-sans shrink-0">Free</span>;
  const liveBadge = <span className="text-[8px] bg-accent/15 text-accent px-1.5 py-0.5 rounded uppercase font-bold tracking-widest font-sans shrink-0">Live</span>;
  const installedBadge = <span className="text-[8px] bg-accent/15 text-accent px-1.5 py-0.5 rounded uppercase font-bold tracking-widest font-sans shrink-0">Installed</span>;
  const hostedBadge = (m: string) => m.endsWith(":free") ? freeBadge : (remoteModels.length > 0 ? liveBadge : null);

  const hostedModels = remoteModels.length > 0 ? remoteModels : PROVIDERS[state.aiProvider].models;
  const visibleHostedModels = modelFilter.trim()
    ? hostedModels.filter(m => m.toLowerCase().includes(modelFilter.trim().toLowerCase()))
    : hostedModels;
  const tokenCeiling = getModelTokenCeiling(state.aiProvider, state.modelSettings.model);

  const isSyncNeeded = deskFieldsChanged(state, lastSyncedState).length > 0;

  // Editing a deskstate field after the AI marked the step complete invalidates
  // that "complete" signal, so disarm the gate until the AI re-confirms.
  useEffect(() => {
    if (isSyncNeeded) setReadyToAdvance(false);
  }, [isSyncNeeded]);

  const syncDeskstateToAI = () => {
    const updatedFields = [...new Set(
      deskFieldsChanged(state, lastSyncedState).map(f => f.label?.(state)).filter(Boolean)
    )] as string[];

    setLastSyncedState(deskSnapshot(state));

    triggerToast(`Workspace parameters synced to collaborator!`, "ui-to-ai");

    // Only report parameters the creator has ACTUALLY established. Fields still
    // at their default value are listed as "not yet decided" so the AI doesn't
    // mistake an untouched default (e.g. the default art style / palette / heat)
    // for a locked choice and race ahead to later steps.
    const established: string[] = [];
    const pending: string[] = [];
    const d = DEFAULT_STATE;

    if (state.mode) established.push(`Narrative Mode: ${state.mode} (${TRACK_LABELS[state.workshopTrack]})`);
    else pending.push("Narrative Mode (SFW/NSFW)");

    if (state.mode || state.heatLevel !== d.heatLevel) established.push(`Heat Level: ${state.heatLevel}/5`);
    else pending.push("Heat Level");

    if (state.settingType) established.push(`Setting Type: ${state.settingType}`);
    else pending.push("Setting Type");

    if (state.tone) established.push(`Tone: ${state.tone}`);
    else pending.push("Tone");

    if (state.concept) established.push(`Narrative Premise: "${state.concept}"`);
    else pending.push("Narrative Premise / Concept");

    const visualTouched = state.artStyle !== d.artStyle || state.aestheticMode !== d.aestheticMode;
    if (visualTouched) established.push(`Visual Art Style: ${state.artStyle} (${state.aestheticMode} approach)`);
    else pending.push("Visual Art Style / Aesthetic");

    // Image generation service is a UI dropdown (defaults to Midjourney). Convey
    // it once the creator is engaging the visual steps (or has changed it) so the
    // model writes image prompts in the right syntax at the Image Prompts step —
    // we stripped the chat "which service?" ask from the Art Style build-order.
    if (visualTouched || state.imageService !== d.imageService) established.push(`Image Generation Service: ${state.imageService} (write ALL image prompts in this service's syntax)`);
    else pending.push("Image Generation Service");

    if (state.palette.join(",") !== d.palette.join(",")) established.push(`HEX Palette: [${state.palette.join(", ")}]`);
    else pending.push("Colour Palette");

    if (state.groundingRules) established.push(`Reality Protocols: "${state.groundingRules}"`);
    else pending.push("Reality Protocols / Grounding Rules");

    if (state.title) established.push(`Draft Title: "${state.title}"`);
    else pending.push("Title");

    if (state.summary) established.push(`Narrative Summary (20-word discovery hook): "${state.summary}"`);
    else pending.push("Narrative Summary (20-word hook)");

    // Budget is chosen on Concept Intake. Only report it if the creator actually
    // moved it off the default range (or turned on Budget-Tier Mode); otherwise
    // it's an untouched default and must not be presented as a locked target.
    const budgetTouched = state.tokenBudgetMin !== d.tokenBudgetMin || state.tokenBudgetMax !== d.tokenBudgetMax || state.budgetTierMode !== d.budgetTierMode;
    if (budgetTouched) established.push(`Target Instruction-Package Budget: ~${state.tokenBudgetMin / 1000}k–${state.tokenBudgetMax / 1000}k tokens (USCS §21.1 package: Prompt Plot + Guidelines + Reminders + Character AI descriptions; HTML/images excluded)${state.budgetTierMode ? " · BUDGET-TIER MODE ACTIVE (apply USCS §21 free-model optimizations)" : ""}`);
    else pending.push("Token Budget target");

    const syncPrompt = `[SYSTEM ACTION - MANUAL STATE SYNC]
The creator synced the workspace. We are currently on **Step ${state.step + 1} ("${activeSteps[state.step]}")**.

ESTABLISHED parameters (already chosen — treat these as locked):
${established.map(e => `- ${e}`).join("\n")}

NOT YET DECIDED — these belong to later steps. Do NOT assume, invent, lock, or present them as chosen. Do not list them as decided in any status block:
${pending.length > 0 ? pending.map(p => `- ${p}`).join("\n") : "- (none — all parameters established)"}

${updatedFields.length > 0 ? `Just modified: ${updatedFields.join(", ")}.` : "No key differences since the last sync."}

Acknowledge the established parameters, leave everything under NOT YET DECIDED untouched, and guide the creator ONLY on the current step ("${activeSteps[state.step]}"). Do not jump ahead to future steps.`;

    askAssistant(syncPrompt);
  };

  const nextStep = () => setState(prev => ({ ...prev, step: Math.min(prev.step + 1, getActiveSteps(prev.workshopTrack).length - 1) }));
  const prevStep = () => setState(prev => ({ ...prev, step: Math.max(prev.step - 1, 0) }));

  const askAssistant = async (prompt: string, requestHistoryOverride?: Message[]) => {
    // A new turn supersedes any prior "step complete" signal until the AI re-confirms.
    setReadyToAdvance(false);
    setResponseTruncated(false);
    // The conversation context sent to the model. Normally the current history;
    // on a retry we pass an explicit (trimmed) history so the failed turn + its
    // error bubble are NOT replayed to the model.
    const requestHistory = requestHistoryOverride ?? state.assistantHistory;

    const cl = state.customLimits;
    const customLimitLines = [
      cl.promptPlot != null && `Prompt Plot ≤${cl.promptPlot}`,
      cl.guidelines != null && `Guidelines ≤${cl.guidelines}`,
      cl.reminders != null && `Reminders ≤${cl.reminders}`,
      cl.characters != null && `each character ≤${cl.characters}`,
    ].filter(Boolean).join(", ");
    // 1. Immediately update UI with user message and loading state
    const userMessage: Message = { role: "user", content: prompt };
    setState(s => ({
      ...s,
      assistantHistory: [...s.assistantHistory, userMessage],
      isAssistantLoading: true
    }));

    try {
      const response = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          stream: true,
          provider: state.aiProvider,
          modelSettings: state.modelSettings,
          history: requestHistory.map(m => ({
            role: m.role === "assistant" ? "model" : "user",
            parts: [{ text: m.content }]
          })),
          step: cur.story ?? -1,
          dmStep: cur.dm ?? -1,
          combinedReview: !!cur.combined,
          systemInstruction: `================================================================================
CURRENT WORKSHOP DESKSTATE (COLLABORATOR SYNC CONTEXT)
================================================================================
- WORKSHOP PIPELINE (the creator's REAL UI steps, in order — when you refer to any step, use these EXACT names; never invent step names or numbers like "Character & Setting" or "World-Building"):
${activeSteps.map((s, i) => `    ${i + 1}. ${s}${i === state.step ? "   ← CURRENT STEP" : ""}`).join("\n")}
  Work ONLY on the current step. Do not advance to, pre-empt, or ask the creator about anything that belongs to a later step.
- CURRENT STEP: ${activeSteps[state.step]} (step ${state.step + 1} of ${activeSteps.length})
- ⚠️ OUTPUT TRACK — LOCKED VIA UI, DO NOT RE-ASK: The creator has ALREADY selected the "${TRACK_LABELS[state.workshopTrack]}" track using a dedicated on-screen control. ${state.workshopTrack === "dm-only" ? "This is a STANDALONE DUNGEON MIND build (USCS §27): produce ONLY the DM game-mechanics config (stat schema, game rules, reminder, story-AI instruction, player guide, name & model) — do NOT produce a plot card, character sheets, prompt plot, or any story-package deliverable." : state.workshopTrack === "story-dm" ? "This is a full story package WITH a Dungeon Mind attached: build the story first, then the DM config (USCS §27), applying the §27.5 integration guidance." : "This is a Full Story Package (a continuous narrative protagonist with a story spine)."} This is final and authoritative. Do NOT ask, confirm, double-check, or re-open the track question in any form, and do NOT list it as an open/pending decision. If the USCS framework text says to establish this track, consider it ALREADY established by the UI selection. Simply proceed.
- Mode: ${state.mode || "Pending"}
- Heat Level: ${state.heatLevel}
- Setting: ${state.settingType || "Pending"}
- Concept: ${state.concept || "Variable"}
- Tone: ${state.tone || "Undefined"}
- Reality Protocols / Grounding Rules:
${state.groundingRules || "No strict rules established yet."}${state.groundingRules ? `
  ⚠️ These grounding rules ALREADY EXIST in the creator's on-screen editor and ARE the World Grounding deliverable. Do NOT regenerate them, do NOT restate the full list back, and do NOT invent a separate or parallel ruleset — treat them as locked. If the creator asks to change ONE rule: reply with just that single revised rule in prose, then emit ONE [SET_RULES: <complete updated ruleset>] to update the editor. If they're satisfied, acknowledge in a sentence and signal readiness — never re-print the whole ruleset.` : ""}
- Target Instruction-Package Budget: ~${state.tokenBudgetMin / 1000}k–${state.tokenBudgetMax / 1000}k tokens. This counts ONLY the AI instruction package (Prompt Plot + Prompt Guidelines + AI Reminders + Character AI prompt descriptions + Player Persona), per USCS §21.1. HTML cards and image/location prompts do NOT count.
  HOW TO HIT THIS BUDGET: The per-block §21 caps (Prompt Plot ≤2500, Guidelines ≤3000, Reminders ≤800, Player Persona ≤500, each character ≤1500 primary / ≤800 supporting) are HARD ceilings — NEVER inflate a block beyond its cap to reach a number. The fixed blocks total ~6,800 tokens at most; the rest of the budget comes from CAST SIZE (USCS guide: ~2 chars ≈ 8–10k, ~4 ≈ 12–15k, ~6 ≈ 16–19k) plus any optional systems. If the chosen budget cannot be met within the caps at the current number of characters, say so and suggest adjusting the cast — do not bloat individual blocks. A higher budget means a larger ensemble, not a bigger Prompt Plot.${state.budgetTierMode ? `
- BUDGET-TIER MODE: ACTIVE (story targets free/budget models such as DeepSeek/Ministral/GLM). Apply the USCS Section 21 budget-tier optimizations throughout: use concrete state-based triggers instead of session-number pacing; require a mandatory status block at the start of every response; add a worked example for any rule that contradicts a model's default training; enforce strict document separation (facts in Plot, behavior in Guidelines, non-negotiables in Reminders — never duplicated); and follow the §21 trim-priority order if over budget.` : ""}${customLimitLines ? `
- CREATOR-SET SECTION LIMITS (override the standard §21 caps for these blocks): ${customLimitLines}. Treat each as that block's target ceiling instead of the default. If a limit is LOWER than the default, produce a leaner block — fewer rules, condensed detail — to fit it. If HIGHER, you MAY add richer, more detailed content. All other blocks keep their §21 defaults. The 20,000-token TOTAL platform ceiling still applies — never exceed it. Reminder: a larger Prompt Plot or Guidelines costs tokens on EVERY turn of the deployed story.` : ""}
${cur.story !== undefined && STEP_MANDATES[cur.story] ? `
================================================================================
MANDATORY OUTPUT CHECKLIST FOR THIS STEP — DO NOT ABBREVIATE OR SKIP
================================================================================
${STEP_MANDATES[cur.story]}
Follow the full injected USCS specification above for exact structure, depth, and word counts. Output the COMPLETE deliverable — if it is long, split into clearly labeled parts ("Part 1/N…") and continue on request rather than omitting any required section.
` : ""}${state.workshopTrack === "story-dm" && cur.story !== undefined ? `
================================================================================
DUNGEON MIND ATTACHED — STORY INTEGRATION (USCS §27.5)
================================================================================
This story has a Dungeon Mind (a separate game-mechanics agent: dice, stats, inventory, rule enforcement) being built alongside it. The DM owns all mechanical resolution, so adapt the STORY deliverables accordingly:
- PROMPT PLOT: do NOT bake game mechanics into the prose. Remove or minimize Genre-Mechanics subsections that the DM now handles (dice maths, stat formulas, combat resolution) — reference that "a Dungeon Mind resolves mechanics" instead of restating rules.
- GUIDELINES: include a "DUNGEON MIND ACTIVE" rule — when the player attempts an action with mechanical uncertainty, pause narrative and let the DM resolve, then continue from its outcome; never override or ignore DM results. If a Status Dashboard (§7B) is also used, do NOT track the same stat in both the dashboard and the DM — decide which owns each variable.
- MODULE TRIGGERS: may reference DM-tracked stats by their schema names (e.g. "when HP < 10"). Use the stat names already defined in the DM Stat Schema step.
- PLAYER PERSONA: note which stats the player assigns and sensible starting values for the intended difficulty.
${cur.story === 10 ? "→ THIS is the Prompt Plot step: apply the Prompt-Plot guidance above now." : cur.story === 11 ? "→ THIS is the Guidelines step: include the DUNGEON MIND ACTIVE rule and the dashboard/DM ownership check now." : cur.story === 15 ? "→ THIS is Compliance & Assembly: verify the above were applied — Genre Mechanics minimized in the Prompt Plot and the DUNGEON MIND ACTIVE rule present in the Guidelines." : ""}
` : ""}
================================================================================
REAL-TIME UI SYNCHRONIZATION COMMANDS
================================================================================
You have direct, two-way control over the workshop UI. Whenever you want to suggest, lock in, or update a setting so the user sees it immediately on their screen, include any of the following tags anywhere in your response. The engine will parse them out and update the React State in real-time, preventing the user from needing to copy-paste:

✦ [SET_MODE: SFW] or [SET_MODE: NSFW]
✦ [SET_HEAT: <1-5>]
✦ [SET_SETTING: <Setting Name>] (e.g., [SET_SETTING: Fantasy / High Fantasy] or [SET_SETTING: Isekai] or [SET_SETTING: Post-Apocalyptic / Survival])
✦ [SET_TITLE: <Title Text>]
✦ [SET_CONCEPT: <Concept Text>]
✦ [SET_SUMMARY: <~20-word user-facing discovery hook — the Title & Summary step's narrative summary, NOT the full premise>]
✦ [SET_TONE: <Tone Text>]
✦ [SET_RULES: <Grounding Rules Text>]
✦ [SET_PALETTE: #HEX1, #HEX2, #HEX3, #HEX4, #HEX5]
✦ [SET_AESTHETIC: Literary] or [SET_AESTHETIC: Structured] or [SET_AESTHETIC: Chaos]
✦ [SET_ART_STYLE: <Style>] (e.g., [SET_ART_STYLE: Classic Oil Painting])

Example use in your reply:
"We've locked in our visual identity! Let me update the palette and system approach:
[SET_PALETTE: #0C0F12, #E2E8F0, #14B8A6, #F43F5E, #E2E8F0]
[SET_AESTHETIC: Structured]
What do you think of this visual approach?"

LARGE PAYLOADS — emit ONCE, inside the tag only: for big values (especially [SET_RULES] and [SET_CONCEPT]), put the full text ONLY inside the tag — do NOT also paste the same content as readable prose in your message. The workshop loads it straight into the on-screen editor where the creator reads and edits it; duplicating it wastes tokens and risks your reply being cut off mid-tag (an unclosed tag fails to load at all). Briefly say what you set or changed, then emit the single tag.

DIAGNOSTIC WORKSHOP RESPONSE MANDATE:
1. Actively guide and collaborate with the user *exclusively* on the deliverables for the CURRENT STEP: "${activeSteps[state.step]}". Use discussion, suggestions, and drafts.
2. DO NOT perform the story, write character dialogue, or introduce simulated turns like "What do you do, Hunter?". You are the co-author, not the player!
3. ADVANCE SIGNAL: The moment the current step's required deliverable(s)/selection(s) are substantively in place, conclude your response with the token [SYNC_PROCEED] — EVEN IF you are also inviting the user to refine, ask questions, or chat further. [SYNC_PROCEED] is a SOFT signal: it only makes the "NEXT" button pulse to show the step is ready; it does NOT auto-advance and never overrides the user, who still chooses when to move on (or to stay and keep refining). Do not withhold it waiting for explicit "yes" — if the step is done enough to proceed, emit it. ⚠️ Stating readiness in prose (e.g. "everything is ready to proceed to the next step") is NOT a substitute — you MUST output the literal token [SYNC_PROCEED] (on its own line) or the interface cannot light up the NEXT button. (Example: on Mode Selection, once Mode is chosen — and Heat too if NSFW — append [SYNC_PROCEED].) If a later message reopens the step, simply omit the token until it's ready again.

================================================================================
DELIVERABLE CAPTURE PROTOCOL (MANDATORY)
================================================================================
Whenever you output a FINALIZED craft deliverable (not a draft you are still discussing), wrap it in capture sentinels so the workshop stores it in the structured story package and tracks its token budget. Use EXACTLY this format, each sentinel alone on its own line:

<<<USCS_BLOCK TYPE>>>
...the finished block, verbatim...
<<<END USCS_BLOCK>>>

TYPE is one of: TITLE_SUMMARY, PLOT_CARD, PROMPT_PLOT, GUIDELINES, REMINDERS, PLAYER_PERSONA, SCENARIOS, IMAGE_PROMPTS.
For per-character blocks use a name suffix: "CHAR_DESC: <Character Name>" for the Part B AI prompt description, and "CHAR_CARD: <Character Name>" for the Part A HTML card. ALWAYS replace <Character Name> with the character's REAL name (e.g. "CHAR_CARD: Aria Vance") — never emit the literal word "Name" or the placeholder text, or the workshop will save a junk character.
DUNGEON MIND (USCS §27) field blocks, when building a DM config: DM_STAT_SCHEMA, DM_GAME_RULES, DM_REMINDER, DM_INSTRUCTION, DM_PLAYER_GUIDE, and DM_NAME_MODEL (format the DM_NAME_MODEL body as "Name: <name> | Model: <model>"). Each loads into the matching field of the DM config in the workshop.

Rules:
- The FIRST line of every block MUST be exactly \`<<<USCS_BLOCK TYPE>>>\` (three '<', the literal word USCS_BLOCK, a space, the TYPE, three '>') and the LAST line exactly \`<<<END USCS_BLOCK>>>\`. Do NOT skip the opening marker, and do NOT replace it with a markdown heading, bold text, or a code fence — without that exact first line the workshop CANNOT save the deliverable.
- Wrap ONLY finished blocks, never drafts under discussion. Keep your conversational explanation OUTSIDE the sentinels.
- When you revise a block, re-emit the FULL block wrapped again — the latest capture replaces the stored one.
- One block per sentinel pair. Never nest.
- The Prompt Plot, Guidelines, Reminders, Character descriptions (CHAR_DESC) and Player Persona count toward the token budget; keep them within the target.

================================================================================
LENGTH MANAGEMENT (AVOID TRUNCATION)
================================================================================
- Responses are capped by a Max_Tokens limit; if you exceed it your message is cut off mid-sentence.
- Keep every captured <<<USCS_BLOCK>>> within the USCS §21 component caps (Prompt Plot ≤2500, Guidelines ≤3000, Reminders ≤800, each character description ≤1500 tokens) so it fits in ONE response. NEVER split a single captured block across two messages.
- If a set is large, break it into multiple SMALLER captured blocks rather than one giant one (e.g. one CHAR_DESC per character, not all characters in one block).
- If your conversational discussion (outside captured blocks) is genuinely long, split it into clearly labeled parts ("Part 1/N…") and continue the next part when the user asks.
- If you are ever cut off, the user can ask you to continue; resume exactly where you stopped without repeating.
`
        })
      });

      // Pre-stream errors are returned as JSON (status != 2xx); check before
      // touching the body as a stream.
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || "Communication link severed");
      }

      // Runs the SAME capture/tag/usage processing as before, on the COMPLETE
      // text — whether it arrived streamed (replaceLast=true, swaps the live
      // placeholder) or as one legacy JSON blob (replaceLast=false, appends).
      const finalize = (fullText: string, truncated: boolean, usage: any, replaceLast: boolean) => {
        if (!fullText || !fullText.trim()) {
          if (replaceLast) {
            setState(s => {
              const h = [...s.assistantHistory];
              if (h.length && h[h.length - 1].role === "assistant" && h[h.length - 1].streaming) h.pop();
              return { ...s, isAssistantLoading: false, assistantHistory: [...h, { role: "assistant", content: "ERROR_SIGNAL: Empty response from matrix" }] };
            });
            return;
          }
          throw new Error("Empty response from matrix");
        }

        const { next: capturedDeliverables, captured, cleaned, warnings } = captureDeliverables(fullText, state.deliverables, state.palette);
        const displayText = (cleaned || fullText).replace(/\[SYNC_PROCEED\]/gi, "").trim();
        const assistantMessage: Message = { role: "assistant", content: displayText, usage };

        const updates: any = {};
        const toastMsgs: string[] = [];
        if (captured.length > 0) updates.deliverables = capturedDeliverables;

        const modeMatch = fullText.match(/\[SET_MODE:\s*(SFW|NSFW)\]/i);
        if (modeMatch) { updates.mode = modeMatch[1].toUpperCase() as Mode; toastMsgs.push(`Mode: ${updates.mode}`); }
        const heatMatch = fullText.match(/\[SET_HEAT:\s*([1-5])\]/i);
        if (heatMatch) { updates.heatLevel = parseInt(heatMatch[1], 10) as HeatLevel; toastMsgs.push(`Heat: ${updates.heatLevel}/5`); }
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
        if (rulesContent !== null && rulesContent.trim()) { updates.groundingRules = rulesContent.trim(); toastMsgs.push("Reality Protocols"); }
        const aestheticMatch = fullText.match(/\[SET_AESTHETIC:\s*(Literary|Structured|Chaos)\]/i);
        if (aestheticMatch) { const modeVal = aestheticMatch[1].trim(); updates.aestheticMode = (modeVal.charAt(0).toUpperCase() + modeVal.slice(1).toLowerCase()) as any; toastMsgs.push(`Aesthetic: ${updates.aestheticMode}`); }
        const artStyleMatch = fullText.match(/\[SET_ART_STYLE:\s*([^\]\n]+)\]/i);
        if (artStyleMatch) { updates.artStyle = artStyleMatch[1].trim(); toastMsgs.push(`Art Style: ${updates.artStyle}`); }
        const paletteMatch = fullText.match(/\[SET_PALETTE:\s*([^\]]+)\]/i);
        if (paletteMatch) {
          const colors = paletteMatch[1].split(",").map((c: string) => c.trim()).filter((c: string) => c.startsWith("#") && (c.length === 7 || c.length === 4));
          if (colors.length >= 3) { updates.palette = colors; toastMsgs.push("Palette Config"); }
        }

        setState(s => {
          const h = [...s.assistantHistory];
          if (replaceLast && h.length && h[h.length - 1].role === "assistant" && h[h.length - 1].streaming) {
            h[h.length - 1] = assistantMessage;
          } else {
            h.push(assistantMessage);
          }
          setLastSyncedState(ls => ({ ...ls, ...updates, step: s.step }));
          return { ...s, ...updates, assistantHistory: h, isAssistantLoading: false };
        });

        if (captured.length > 0) {
          triggerToast(`✓ Captured to package: ${captured.join(", ")}`, "ai-to-ui");
        } else if (toastMsgs.length > 0) {
          triggerToast(`Matrix updated parameters: ${toastMsgs.join(", ")}`, "ai-to-ui");
        }
        if (warnings.length > 0) triggerToast(`⚠️ ${warnings[0]}`, "info");
        // Arm the advance gate (pulses NEXT) on: the explicit [SYNC_PROCEED] token,
        // an ACTUAL deliverable capture this turn, OR a clear completion phrase.
        // It's a SOFT signal (pulse only, never auto-advances).
        // (1) Capturing a block IS the completion signal — the most reliable one.
        //     Models often emit the deliverable but forget [SYNC_PROCEED] on that
        //     very turn (seen on the DM Stat Schema capture), so arm on capture.
        // (2) The prose fallback exists because models announce readiness in prose
        //     and drop the token — but it must NOT fire on a CLARIFICATION turn that
        //     is still soliciting confirmation. A conditional like "ready to advance
        //     ONCE the schema is locked" / "once you confirm I'll emit…" means NOT
        //     done yet, so suppress the prose match when the tail is soliciting.
        const proceedTail = fullText.slice(-400);
        const proceedPhrase = /(everything is ready to proceed|ready to proceed to the next step|ready to (?:advance|move on)|ready for the next step|this step is (?:now )?complete|we (?:can|are ready to) (?:now )?(?:proceed|advance|move on) to the next step|let's (?:proceed|advance|move on) to the next step)/i.test(proceedTail);
        // Keep ONLY phrases that signal a still-pending action or a request for
        // input — NOT generic polite sign-offs ("let me know", "would you like",
        // "do you want"), which routinely co-occur with a genuinely finished step
        // and would otherwise wrongly suppress the pulse.
        const solicitingConfirmation = /(once (?:you|the|it'?s|i|we|that)|after you|before (?:we|i|you) (?:finaliz|proceed|continu|move|lock)|confirm (?:or|and|,)? ?(?:i'?ll|then i|to)|shall i|should i (?:emit|proceed|finaliz)|awaiting your|pending your|proposed adjustments|any (?:tweaks|changes|adjustments)\??$)/i.test(proceedTail);
        const capturedSomething = captured.length > 0;
        if ((fullText.includes("[SYNC_PROCEED]") || capturedSomething || (proceedPhrase && !solicitingConfirmation)) && state.step < activeSteps.length - 1) setReadyToAdvance(true);
        if (truncated) setResponseTruncated(true);
      };

      const contentType = response.headers.get("content-type") || "";
      if (contentType.includes("text/event-stream") && response.body) {
        // Live token streaming via Server-Sent Events.
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        let acc = "";
        let truncated = false;
        let usage: any = undefined;
        let streamErr: string | null = null;
        let placeholderAdded = false;
        let lastPaint = 0;

        const paint = (force?: boolean) => {
          const now = Date.now();
          if (!force && now - lastPaint < 60) return; // throttle re-renders (~16fps)
          lastPaint = now;
          const shown = cleanStreamingText(acc) || "…";
          setState(s => {
            const h = [...s.assistantHistory];
            if (placeholderAdded && h.length && h[h.length - 1].role === "assistant" && h[h.length - 1].streaming) {
              h[h.length - 1] = { ...h[h.length - 1], content: shown };
            } else {
              h.push({ role: "assistant", content: shown, streaming: true });
            }
            return { ...s, assistantHistory: h };
          });
          placeholderAdded = true;
        };

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let sep: number;
          while ((sep = buf.indexOf("\n\n")) >= 0) {
            const chunk = buf.slice(0, sep);
            buf = buf.slice(sep + 2);
            const dataLine = chunk.split("\n").find(l => l.startsWith("data:"));
            if (!dataLine) continue;
            const json = dataLine.slice(5).trim();
            if (!json) continue;
            let evt: any;
            try { evt = JSON.parse(json); } catch { continue; }
            if (typeof evt.delta === "string") { acc += evt.delta; paint(); }
            else if (evt.done) { truncated = !!evt.truncated; usage = evt.usage; }
            else if (evt.error) { streamErr = evt.error; }
          }
        }

        if (streamErr) {
          setState(s => {
            const h = [...s.assistantHistory];
            if (placeholderAdded && h.length && h[h.length - 1].role === "assistant" && h[h.length - 1].streaming) h.pop();
            return { ...s, isAssistantLoading: false, assistantHistory: [...h, { role: "assistant", content: `ERROR_SIGNAL: ${streamErr}` }] };
          });
          return;
        }
        paint(true);
        finalize(acc, truncated, usage, true);
      } else {
        // Legacy non-streamed JSON (graceful fallback) — process exactly as before.
        const data = await response.json();
        finalize(data.text, !!data.truncated, data.usage, false);
      }
    } catch (error: any) {
      console.error(error);
      setState(s => {
        const h = [...s.assistantHistory];
        // Drop a half-streamed placeholder so the error replaces it cleanly.
        if (h.length && h[h.length - 1].role === "assistant" && h[h.length - 1].streaming) h.pop();
        return { ...s, isAssistantLoading: false, assistantHistory: [...h, { role: "assistant", content: `ERROR_SIGNAL: ${error.message || "Unknown anomaly"}` }] };
      });
    }
  };

  // Resume a response that was cut off at the Max_Tokens wall.
  const continueResponse = () => {
    if (state.isAssistantLoading) return;
    askAssistant("[CONTINUE] Your previous message was cut off at the token limit. Resume EXACTLY where you stopped — do not repeat anything already sent, just continue the text from the exact cut-off point. If you were mid-way through a <<<USCS_BLOCK>>>, finish that block and include its closing <<<END USCS_BLOCK>>> sentinel so it captures correctly.");
  };

  // Re-send the last user turn after a failed request (e.g. an OpenRouter free
  // model that hit its rate cap). Strips the failed user message + its error
  // bubble, then replays the same prompt with a clean history — no need to
  // fiddle a UI control to force a re-trigger.
  const retryLast = () => {
    if (state.isAssistantLoading) return;
    const h = state.assistantHistory;
    let lastUserIdx = -1;
    for (let i = h.length - 1; i >= 0; i--) {
      if (h[i].role === "user") { lastUserIdx = i; break; }
    }
    if (lastUserIdx === -1) return;
    const prompt = h[lastUserIdx].content;
    // Everything from the failed user turn onward is discarded (the user msg
    // gets re-added by askAssistant; the error bubble is dropped).
    const trimmed = h.slice(0, lastUserIdx);
    setState(s => ({ ...s, assistantHistory: trimmed }));
    askAssistant(prompt, trimmed);
  };

  // EXPORT: compile the final ISK0 package as a MULTI-PART operation — one model
  // call per deliverable (and one per character), so a 10–20k-token package is
  // never squeezed into a single ~8k response. Each call reads the session as
  // context but does NOT touch assistantHistory, so the chat stays clean.
  const exportFinalPackage = async () => {
    if (isExporting || state.assistantHistory.length === 0) return;
    setIsExporting(true);

    const baseHistory = state.assistantHistory.map(m => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }]
    }));
    const ceiling = getModelTokenCeiling(state.aiProvider, state.modelSettings.model);
    const divider = (h: string) => `${"=".repeat(80)}\n${h}\n${"=".repeat(80)}`;

    // One raw assistant call that returns clean text and never mutates the chat.
    const callRaw = async (prompt: string, step: number): Promise<string> => {
      const response = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          provider: state.aiProvider,
          modelSettings: { ...state.modelSettings, maxTokens: ceiling },
          history: baseHistory,
          step,
          systemInstruction: `You are compiling one block of the final ISK0 deliverable package for direct file export (not shown in chat). Output ONLY the requested finished block, verbatim and in full (include raw HTML where applicable). No greetings, no commentary, no questions, no UI-sync tags.`
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
      return stripSyncTags(data.text || "");
    };

    const sectionInstruction = (what: string) =>
      `[EXPORT — MACHINE OUTPUT] Output ONLY ${what}, exactly as finalized in our session: verbatim, in full, raw HTML included where applicable. No greetings, no commentary, no questions, no [SET_*]/[SYNC_PROCEED] tags. If it was never built this session, output exactly "(not generated)" and nothing else.`;

    const d = state.deliverables;
    const parts: string[] = [];
    const failures: string[] = [];
    let regenerated = 0;

    // Prefer the captured block. Only call the model if that slot is empty.
    const getOrGen = async (heading: string, captured: string, step: number, what: string) => {
      setExportProgress(heading);
      if (captured && captured.trim()) {
        parts.push(`${divider(heading)}\n\n${captured.trim()}`);
        return;
      }
      regenerated++;
      try {
        const body = await callRaw(sectionInstruction(what), step);
        parts.push(`${divider(heading)}\n\n${body || "(not generated)"}`);
      } catch (err: any) {
        failures.push(heading);
        parts.push(`${divider(heading)}\n\n[EXPORT ERROR — this block could not be compiled: ${err.message || err}. Re-run the export to retry.]`);
      }
    };

    try {
      await getOrGen("TITLE & SUMMARY", d.titleSummary, 6, "the Title and the Plot Summary plus the per-character summaries");
      await getOrGen("PLOT CARD", d.plotCard, 7, "the Plot Card as raw HTML, exactly as built");

      // Character Sheets — prefer captured cards/descriptions; otherwise discover + regenerate per character.
      setExportProgress("Character sheets");
      let charBlock = "";
      const capturedChars = d.characters.filter(c => c.card || c.desc);
      if (capturedChars.length > 0) {
        charBlock = capturedChars.map(c =>
          `### ${c.name}\n\nPART A — CARD (HTML):\n${c.card || "(card not generated)"}\n\nPART B — AI DESCRIPTION:\n${c.desc || "(description not generated)"}`
        ).join("\n\n");
      } else {
        regenerated++;
        try {
          const namesRaw = await callRaw(`[EXPORT] List ONLY the names of the characters that have a character sheet in this story — one name per line, nothing else. No numbering, no commentary. If there are none, output exactly "(none)".`, 8);
          const names = namesRaw.split(/\r?\n/).map(s => s.replace(/^[\s\-*\d.)]+/, "").trim()).filter(s => s && !/^\(?none\)?$/i.test(s)).slice(0, 15);
          if (names.length === 0) {
            charBlock = await callRaw(sectionInstruction("ALL character sheets — Part A (HTML card) and Part B (AI prompt description) for every character, each in full"), 8);
          } else {
            const chunks: string[] = [];
            for (let i = 0; i < names.length; i++) {
              setExportProgress(`Character ${i + 1}/${names.length}: ${names[i]}`);
              try {
                const cs = await callRaw(`[EXPORT — MACHINE OUTPUT] Output the COMPLETE finalized character sheet for the character named "${names[i]}": Part A (the raw HTML card, verbatim) followed by Part B (the AI prompt description, in full). No commentary, no questions, no tags. If this character has no finished sheet, output exactly "(not generated)".`, 8);
                chunks.push(`### ${names[i]}\n\n${cs || "(not generated)"}`);
              } catch (err: any) {
                failures.push(`Character: ${names[i]}`);
                chunks.push(`### ${names[i]}\n\n[EXPORT ERROR: ${err.message || err}]`);
              }
            }
            charBlock = chunks.join("\n\n");
          }
        } catch (err: any) {
          failures.push("Character Sheets");
          charBlock = `[EXPORT ERROR — character roster could not be read: ${err.message || err}]`;
        }
      }
      parts.push(`${divider("CHARACTER SHEETS")}\n\n${charBlock}`);

      await getOrGen("SCENARIOS — OPENING / FIRST MESSAGES", d.scenarios, 13, "every scenario's authored opening / first message, each one in full");
      await getOrGen("PROMPT PLOT", d.promptPlot, 10, "the Prompt Plot performer instructions, including the Architect Protocol block verbatim");
      await getOrGen("GUIDELINES", d.guidelines, 11, "the complete Prompt Guidelines rule list, every rule in full");
      await getOrGen("REMINDERS", d.reminders, 12, "the complete AI Reminders list, in priority order");

      const pkg = countingPackageTokens(d);
      const pkgFmt = pkg >= 1000 ? `${(pkg / 1000).toFixed(1)}k` : `${pkg}`;
      const header = `ISK0 STORY PACKAGE — "${state.title || "Untitled"}"\nGenerated: ${new Date().toLocaleString()}\nMode: ${state.mode || "—"} · Heat: ${state.heatLevel}/5 · Setting: ${state.settingType || "—"}\nInstruction-package size (§21.1 est.): ~${pkgFmt} tokens · Target: ${state.tokenBudgetMin / 1000}k–${state.tokenBudgetMax / 1000}k${pkg > state.tokenBudgetMax ? " · OVER BUDGET" : ""}`;
      const fileBody = `${header}\n${"=".repeat(80)}\n\n${parts.join("\n\n\n")}\n`;
      downloadTextFile(`${sanitizeFilename(state.title)}_ISK0_Package.txt`, fileBody);

      if (failures.length > 0) {
        triggerToast(`Exported with ${failures.length} block(s) failed (${failures.join(", ")}). Re-run to retry.`, "info");
      } else if (regenerated === 0) {
        triggerToast("Exported from captured package ✓ (instant, no AI calls)", "ai-to-ui");
      } else {
        triggerToast(`Final package exported ✓ (${regenerated} block(s) regenerated)`, "ai-to-ui");
      }
    } catch (err: any) {
      console.error("Export failed:", err);
      triggerToast(`Export failed: ${err.message || "unknown error"}`, "info");
    } finally {
      setExportProgress("");
      setIsExporting(false);
    }
  };

  // Start fresh: wipe the story, chat and captured deliverables, but KEEP the
  // provider, API keys and favourites so testing/new stories don't re-enter them.
  const startNewProject = () => {
    if (!window.confirm("Start a new project? This clears the current story, chat, and captured deliverables. Your provider, API keys, and favourite models are kept.")) return;
    setState(s => ({
      ...DEFAULT_STATE,
      aiProvider: s.aiProvider,
      modelSettings: s.modelSettings,
    }));
    setLastSyncedState(deskSnapshot(DEFAULT_STATE));
    setResponseTruncated(false);
    setReadyToAdvance(false);
    setShowSettings(false);
    setShowRestoreNotice(false);
    try { window.sessionStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    triggerToast("New project started — your provider, keys & favourites were kept.", "info");
  };

  // SNAPSHOT: instant, no AI call. Saves a full human-readable backup of the
  // session — the deskstate parameters AND the entire collaboration transcript.
  const saveSnapshot = () => {
    const ds = [
      `Title:    ${state.title || "Untitled"}`,
      `Mode:     ${state.mode || "—"} (${TRACK_LABELS[state.workshopTrack]})`,
      `Heat:     ${state.heatLevel}/5`,
      `Setting:  ${state.settingType || "—"}`,
      `Tone:     ${state.tone || "—"}`,
      `Aesthetic:${state.aestheticMode} · Art Style: ${state.artStyle}`,
      `Palette:  ${state.palette.join(", ")}`,
      `Concept:  ${state.concept || "—"}`,
      `Grounding Rules:\n${state.groundingRules || "—"}`,
      `Step:     ${state.step + 1} (${activeSteps[state.step]})`,
    ].join("\n");

    const transcript = state.assistantHistory
      .map(m => `${"-".repeat(80)}\n[${m.role === "assistant" ? "AETHER_CORE" : "USER"}]\n${m.content}`)
      .join("\n\n");

    const content =
      `ISK0 / AETHER_CORE — SESSION SNAPSHOT\nGenerated: ${new Date().toLocaleString()}\n${"=".repeat(80)}\n\n` +
      `DESKSTATE\n${"=".repeat(80)}\n${ds}\n\n` +
      `FULL COLLABORATION TRANSCRIPT\n${"=".repeat(80)}\n\n${transcript || "(no messages yet)"}\n`;

    downloadTextFile(`${sanitizeFilename(state.title)}_snapshot.txt`, content);
    triggerToast("Snapshot saved ✓", "info");
  };

  // EXPORT DM CONFIG: a clean field-by-field .txt of the Dungeon Mind config
  // (USCS §27), copy-paste-ready into ISK0's Dungeon Mind editor.
  const exportDMConfig = () => {
    const dm = state.deliverables.dmConfig;
    const rule = "=".repeat(80);
    const field = (label: string, value: string, note?: string) =>
      `${rule}\n${label}${note ? `   (${note})` : ""}\n${rule}\n${value.trim() || "(not yet written)"}\n`;
    const content =
      `ISK0 / AETHER_CORE — DUNGEON MIND CONFIG\nGenerated: ${new Date().toLocaleString()} · USCS v${USCS_VERSION} §27\n${rule}\n\n` +
      `Paste each field into the matching slot in ISK0's Dungeon Mind editor\n(Creation tab → Dungeon Minds). Attach to a storyline as Required or Optional.\n\n` +
      field("FIELD 1 — NAME", dm.name) + "\n" +
      field("FIELD 2 — RECOMMENDED MODEL", dm.model) + "\n" +
      field("FIELD 7 — STAT SCHEMA", dm.statSchema) + "\n" +
      field("FIELD 3 — GAME RULES", dm.gameRules, "max 10,000 tokens") + "\n" +
      field("FIELD 4 — GAME RULE REMINDER", dm.gameRuleReminder, "~500 tokens") + "\n" +
      field("FIELD 5 — INSTRUCTION (story-AI bridge)", dm.instruction) + "\n" +
      field("FIELD 6 — PLAYER GUIDE", dm.playerGuide, "max 1,000 characters") + "\n";
    downloadTextFile(`${sanitizeFilename(dm.name || state.title || "Dungeon_Mind")}_DM_config.txt`, content);
    triggerToast("DM config exported ✓", "ai-to-ui");
  };

  // SAVE WORKSPACE: a portable JSON backup of the ENTIRE workshop state — every
  // deskstate field, captured deliverables AND the chat — so the project can be
  // restored later, moved to another machine, or shared. API keys are stripped
  // (a shared file must never carry secrets); the recipient supplies their own.
  const saveWorkspace = () => {
    const { isAssistantLoading: _drop, modelSettings, ...rest } = state;
    const backup = {
      _aether_backup: true,
      appVersion: APP_VERSION,
      uscsVersion: USCS_VERSION,
      savedAt: new Date().toISOString(),
      // Keep non-secret model prefs (provider/model/temp), drop the keys.
      state: {
        ...rest,
        modelSettings: { ...modelSettings, geminiApiKey: "", anthropicApiKey: "", openRouterApiKey: "", mistralApiKey: "" },
      },
    };
    downloadTextFile(`${sanitizeFilename(state.title)}_workspace.aether.json`, JSON.stringify(backup, null, 2));
    triggerToast("Workspace backup saved ✓ — API keys are NOT included.", "info");
  };

  // LOAD WORKSPACE: restore a .aether.json backup. Rehydrates like a fresh page
  // load (spread over DEFAULT_STATE, drop transient flags, merge nested maps) but
  // KEEPS the keys currently typed into this browser, since the file carries none.
  const loadWorkspace = async (file: File) => {
    let parsed: any;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      triggerToast("Couldn't read that file — it isn't valid JSON.", "info");
      return;
    }
    if (!parsed || parsed._aether_backup !== true || !parsed.state) {
      triggerToast("That doesn't look like an Aether_Core workspace backup.", "info");
      return;
    }
    const hasWork = !!(state.assistantHistory.length || state.concept || state.mode || state.title);
    if (hasWork && !window.confirm("Load this workspace backup? It REPLACES your current story, chat and deliverables. Your typed API keys are kept.")) return;

    const loaded = parsed.state as Partial<StoryState>;
    const restored: StoryState = {
      ...DEFAULT_STATE,
      ...loaded,
      isAssistantLoading: false,
      // The backup has no keys — preserve whatever the user already typed here.
      modelSettings: {
        ...DEFAULT_STATE.modelSettings,
        ...(loaded.modelSettings || {}),
        geminiApiKey: state.modelSettings.geminiApiKey,
        anthropicApiKey: state.modelSettings.anthropicApiKey,
        openRouterApiKey: state.modelSettings.openRouterApiKey,
        mistralApiKey: state.modelSettings.mistralApiKey,
      },
      workshopTrack: migrateTrack(loaded),
      deliverables: { ...EMPTY_DELIVERABLES, ...(loaded.deliverables || {}), dmConfig: { ...EMPTY_DM_CONFIG, ...(loaded.deliverables?.dmConfig || {}) } },
      customLimits: { ...DEFAULT_STATE.customLimits, ...(loaded.customLimits || {}) },
    };
    setState(restored);
    // Realign the sync baseline so a freshly loaded project doesn't show a
    // spurious "sync needed" banner (the deskstate IS the loaded state).
    setLastSyncedState(deskSnapshot(restored));
    setResponseTruncated(false);
    setReadyToAdvance(false);
    setShowRestoreNotice(false);
    triggerToast("Workspace restored ✓", "ai-to-ui");
  };

  return (
    <div className="h-screen max-h-screen flex flex-col bg-bg technical-grid overflow-hidden">
      {/* Header */}
      <header className="border-b border-border bg-header/80 backdrop-blur-md px-4 py-3 lg:px-6 lg:py-4 flex justify-between items-center z-50">
        <div className="flex items-center gap-4 lg:gap-6">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-accent rounded flex items-center justify-center text-black font-black shrink-0 shadow-[0_0_15px_rgba(20,184,166,0.2)]">A</div>
            <div className="hidden sm:block">
              <h1 className="text-base lg:text-lg font-bold tracking-tight uppercase leading-none">Aether_Core</h1>
              <span className="text-[8px] lg:text-[10px] font-mono opacity-50 uppercase tracking-[0.2em]">USCS v{USCS_VERSION}</span>
            </div>
          </div>
          <div className="h-4 w-[1px] bg-border hidden md:block"></div>
          <div className="hidden md:flex flex-col">
            <span className="text-[10px] uppercase tracking-widest text-label">Workshop</span>
            <span className="text-sm font-mono tracking-tighter">Story Architect</span>
          </div>
        </div>
        <div className="flex gap-1.5 sm:gap-4 items-center">
          <button 
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            className={`p-2 lg:hidden hover:bg-white/5 rounded-md transition-all ${isSidebarOpen ? 'bg-accent/10 text-accent' : 'text-label'}`}
          >
            <BookOpen className="w-5 h-5" />
          </button>
          <button
            onClick={() => setIsChatOpen(!isChatOpen)}
            className={`p-2 xl:hidden hover:bg-white/5 rounded-md transition-all ${isChatOpen ? 'bg-accent/10 text-accent' : 'text-label'}`}
          >
            <MessageSquare className="w-5 h-5" />
          </button>
          <button
            onClick={startNewProject}
            title="Start a new project — clears the current story & chat (keeps your provider, keys & favourites)"
            className="flex px-2 sm:px-3 py-2 border border-[#f43f5e]/40 text-[#f43f5e] rounded-md items-center gap-1.5 text-[10px] font-black uppercase tracking-widest hover:bg-[#f43f5e]/10 hover:border-[#f43f5e]/60 transition-all"
          >
            <RefreshCw className="w-4 h-4 sm:w-3.5 sm:h-3.5" /> <span className="hidden sm:inline">New</span>
          </button>
          <button
            onClick={() => setShowHelp(true)}
            title="How this works · getting API keys · local models"
            className={`p-2 hover:bg-white/5 rounded-md transition-all ${showHelp ? 'bg-accent/10 border border-accent/30' : ''}`}
          >
            <HelpCircle className={`w-5 h-5 ${showHelp ? 'text-accent' : 'text-label'}`} />
          </button>
          <button
            onClick={() => setShowSettings(true)}
            className={`p-2 hover:bg-white/5 rounded-md transition-all ${showSettings ? 'bg-accent/10 border border-accent/30' : ''}`}
          >
            <Settings className={`w-5 h-5 ${showSettings ? 'text-accent' : 'text-label'}`} />
          </button>
          
          <div className="h-4 w-[1px] bg-border hidden sm:block mx-1"></div>

          <button
            onClick={nextStep}
            disabled={state.step === activeSteps.length - 1 || (state.step === 0 && state.workshopTrack !== "dm-only" && !state.mode)}
            className={`flex px-4 lg:px-6 py-2 bg-accent text-black rounded-lg items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] hover:bg-white active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed transition-all z-50 border border-accent/50 ${
              readyToAdvance
                ? "ring-2 ring-accent ring-offset-2 ring-offset-header animate-pulse shadow-[0_0_28px_rgba(20,184,166,0.7)]"
                : "shadow-[0_0_20px_rgba(20,184,166,0.3)]"
            }`}
            title={readyToAdvance ? "Step marked complete — click to lock in and continue" : undefined}
          >
            {readyToAdvance && <CheckCircle2 className="w-3.5 h-3.5" />}
            <span>{readyToAdvance ? "LOCK IN" : "NEXT"}</span>
            <ChevronRight className="w-3 h-3 font-black" />
          </button>
        </div>
      </header>

      {/* Resumed-session notice — prevents unknowingly continuing an old story */}
      <AnimatePresence>
        {showRestoreNotice && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="bg-[#fbbf24]/10 border-b border-[#fbbf24]/30 overflow-hidden z-40"
          >
            <div className="px-4 lg:px-6 py-2.5 flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2 min-w-0">
                <AlertTriangle className="w-4 h-4 text-[#fbbf24] shrink-0" />
                <p className="text-[11px] sm:text-xs text-[#fbbf24] font-medium leading-snug">
                  <span className="font-black uppercase tracking-wide">Resuming a saved session.</span> You're continuing a previous story{state.title ? ` ("${state.title}")` : ""} — the AI still has its earlier chat as context. Starting something new? Click <span className="font-black">New Project</span>.
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={startNewProject}
                  className="px-3 py-1.5 bg-[#fbbf24] text-black rounded-md text-[10px] font-black uppercase tracking-widest hover:bg-[#fbbf24]/80 transition-all flex items-center gap-1.5"
                >
                  <RefreshCw className="w-3 h-3" /> New Project
                </button>
                <button
                  onClick={() => setShowRestoreNotice(false)}
                  className="px-3 py-1.5 border border-[#fbbf24]/40 text-[#fbbf24] rounded-md text-[10px] font-black uppercase tracking-widest hover:bg-[#fbbf24]/10 transition-all"
                >
                  Keep working
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <main className="flex-1 flex overflow-hidden relative">
        {/* Sidebar Navigation */}
        <AnimatePresence>
          {(isSidebarOpen || !isMobile) && (
            <motion.nav 
              initial={isMobile ? { x: -300 } : false}
              animate={{ x: 0 }}
              exit={{ x: -300 }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className={`fixed inset-y-0 left-0 w-72 border-r border-border bg-header/95 backdrop-blur-xl lg:backdrop-blur-none lg:bg-header/40 lg:relative lg:flex flex-col p-6 overflow-hidden z-[60] lg:z-40 ${isSidebarOpen ? 'flex' : 'hidden lg:flex'}`}
            >
              <div className="flex items-center justify-between lg:hidden mb-8 shrink-0">
                <div className="flex items-center gap-2">
                  <BookOpen className="w-4 h-4 text-accent" />
                  <h2 className="text-[10px] font-black uppercase tracking-[0.3em] text-accent">Navigation</h2>
                </div>
                <button 
                  onClick={() => setIsSidebarOpen(false)} 
                  className="p-3 bg-white/5 hover:bg-white/10 rounded-xl text-label flex items-center gap-2 transition-all active:scale-95"
                >
                  <span className="text-[10px] font-bold uppercase tracking-widest">Close</span>
                  <X className="w-5 h-5" />
                </button>
              </div>
              
              <h2 className="text-[10px] font-bold text-label uppercase tracking-[0.3em] mb-4 hidden lg:block shrink-0">Pipeline Workflow</h2>

              <div className="flex-1 overflow-y-auto space-y-1.5 custom-scrollbar pr-1 mb-4">
                {activeSteps.map((step, idx) => (
                  <button
                    key={step}
                    onClick={() => {
                      setState(prev => ({ ...prev, step: idx }));
                      if (window.innerWidth < 1024) setIsSidebarOpen(false);
                    }}
                    className={`w-full text-left px-4 py-3 rounded-lg text-xs transition-all flex items-center gap-3 group border ${
                      idx === state.step 
                        ? "bg-accent/10 text-accent border-accent/40 shadow-[0_0_15px_rgba(20,184,166,0.1)]" 
                        : idx < state.step 
                        ? "text-accent/60 border-transparent hover:bg-white/5" 
                        : "text-text-dim border-transparent hover:text-text-muted hover:bg-white/5"
                    }`}
                  >
                    <div className={`w-1.5 h-1.5 rounded-full transition-colors ${
                      idx === state.step ? "bg-accent" : idx < state.step ? "bg-accent/40" : "bg-text-dim/20 group-hover:bg-text-dim/40"
                    }`} />
                    <span className="font-medium tracking-tight whitespace-nowrap overflow-hidden text-ellipsis">{step}</span>
                    {idx < state.step && <CheckCircle2 className="w-3 h-3 ml-auto text-accent shrink-0" />}
                  </button>
                ))}
              </div>

              {state.step >= 1 && (
                <div className="border-t-2 border-accent/30 pt-4 mt-auto shrink-0">
                  <StatusMonitor state={state} onTighten={askAssistant} />
                </div>
              )}
            </motion.nav>
          )}
        </AnimatePresence>

        {/* Mobile Sidebar Overlay */}
        <AnimatePresence>
          {isSidebarOpen && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsSidebarOpen(false)}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[55] lg:hidden"
            />
          )}
        </AnimatePresence>

        {/* Content Area */}
        <section className="flex-1 overflow-y-auto custom-scrollbar p-4 lg:p-8 flex flex-col items-center">
          <div className="w-full max-w-4xl space-y-8 pb-32">
            <AnimatePresence mode="wait">
              <motion.div
                key={state.step}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
              >
                {cur.combined
                  ? renderCombinedReview(state, setState, askAssistant, exportDMConfig, exportFinalPackage)
                  : cur.dm !== undefined
                  ? renderDMStep(cur.dm, state, setState, askAssistant, exportDMConfig)
                  : renderStep(cur.story ?? 0, state, setState, nextStep, askAssistant, setHoverHeatLevel, hoverHeatLevel, isSyncNeeded, syncDeskstateToAI, exportDMConfig, triggerToast)}
              </motion.div>
            </AnimatePresence>
          </div>
        </section>

        {/* Action Panel (Right) */}
        <AnimatePresence mode="wait">
          {(isChatOpen || isXL) && (
            <motion.aside 
              drag={isChatDetached}
              dragMomentum={false}
              onDragEnd={(_, info) => {
                setChatPosition(prev => ({ x: prev.x + info.offset.x, y: prev.y + info.offset.y }));
              }}
              initial={isXL && !isChatDetached ? false : { x: "100%" }}
              animate={isChatDetached ? {
                // Floating window. Geometry only — cosmetics (radius/border/shadow/
                // bg) live in className so Framer doesn't leave them as stale inline
                // styles when we re-dock.
                x: chatPosition.x,
                y: chatPosition.y,
                width: chatSize.width,
                height: chatSize.height,
                position: 'fixed',
                top: 100,
                right: 40,
                zIndex: 1000,
              } : {
                // Docked. Must reset EVERY geometry key the detached state set,
                // otherwise Framer keeps the floating position/size as inline
                // styles and the panel never re-docks (which also hid the resize
                // handle). Values track the responsive className for the breakpoint.
                x: 0,
                y: 0,
                width: dockedChatWidth,
                height: '100%',
                position: isXL ? 'relative' : 'fixed',
                top: isXL ? 'auto' : 0,
                right: isXL ? 'auto' : 0,
                zIndex: isXL ? 40 : 70,
              }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className={`overflow-hidden flex flex-col min-w-0 max-h-full ${isChatDetached ? 'rounded-[24px] border border-white/10 shadow-2xl bg-[#18181b]' : 'fixed inset-y-0 right-0 border-l border-border bg-[#18181b] z-[70] xl:z-40 h-full xl:relative xl:inset-auto xl:bg-header/40 xl:border-l-0 xl:h-full'} ${isChatOpen ? 'flex' : 'hidden xl:flex'} ${isXL && !isChatDetached ? '' : 'w-full sm:w-auto'}`}
              style={!isChatDetached ? { width: dockedChatWidth } : {}}
            >
              {/* Resize Handle for Docked View */}
              {!isChatDetached && isXL && (
                <div 
                  className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize bg-border/30 hover:bg-accent/50 transition-colors z-[80]"
                  title="Drag to resize chat"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    const startX = e.clientX;
                    const startWidth = dockedChatWidth;
                    const onMouseMove = (moveEvent: MouseEvent) => {
                      setDockedChatWidth(Math.max(300, Math.min(800, startWidth + (startX - moveEvent.clientX))));
                    };
                    const onMouseUp = () => {
                      document.removeEventListener('mousemove', onMouseMove);
                      document.removeEventListener('mouseup', onMouseUp);
                    };
                    document.addEventListener('mousemove', onMouseMove);
                    document.addEventListener('mouseup', onMouseUp);
                  }}
                />
              )}

              <CollaboratorChat
                state={state}
                compact={isMobile || isShort}
                setState={setState}
                askAssistant={askAssistant} 
                setIsChatOpen={setIsChatOpen}
                isDetached={isChatDetached}
                setIsDetached={setIsChatDetached}
                isSyncNeeded={isSyncNeeded}
                syncDeskstateToAI={syncDeskstateToAI}
                onExport={exportFinalPackage}
                onExportDM={exportDMConfig}
                onSnapshot={saveSnapshot}
                onSaveWorkspace={saveWorkspace}
                onLoadWorkspace={loadWorkspace}
                isExporting={isExporting}
                exportProgress={exportProgress}
                readyToAdvance={readyToAdvance}
                onAdvance={nextStep}
                responseTruncated={responseTruncated}
                onContinue={continueResponse}
                onRetry={retryLast}
              />
              {isChatDetached && (
                <div 
                  className="absolute bottom-0 right-0 w-6 h-6 cursor-nwse-resize group flex items-center justify-center"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    const startX = e.clientX;
                    const startY = e.clientY;
                    const startWidth = chatSize.width;
                    const startHeight = chatSize.height;

                    const onMouseMove = (moveEvent: MouseEvent) => {
                      setChatSize({
                        width: Math.max(300, startWidth + (moveEvent.clientX - startX)),
                        height: Math.max(400, startHeight + (moveEvent.clientY - startY))
                      });
                    };

                    const onMouseUp = () => {
                      document.removeEventListener('mousemove', onMouseMove);
                      document.removeEventListener('mouseup', onMouseUp);
                    };

                    document.addEventListener('mousemove', onMouseMove);
                    document.addEventListener('mouseup', onMouseUp);
                  }}
                >
                   <div className="w-1.5 h-1.5 bg-accent/40 rounded-full group-hover:bg-accent transition-colors" />
                </div>
              )}
            </motion.aside>
          )}
        </AnimatePresence>

        {/* Mobile Chat Overlay */}
        <AnimatePresence>
          {isChatOpen && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsChatOpen(false)}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[55] xl:hidden"
            />
          )}
        </AnimatePresence>
      </main>

      {/* Footer Controls */}
      <footer className="border-t border-border bg-header/60 backdrop-blur-sm px-4 py-4 lg:p-6 flex justify-between items-center z-50">
        <div className="flex items-center gap-4 lg:gap-6">
          <button 
            onClick={prevStep}
            disabled={state.step === 0}
            className="px-4 lg:px-6 py-2 border border-border rounded-md flex items-center gap-2 text-[10px] lg:text-xs font-bold uppercase tracking-widest hover:bg-white/5 disabled:opacity-10 transition-all font-mono"
          >
            <ChevronLeft className="w-3 h-3 lg:w-4 h-4" /> REVERT
          </button>
          <div className="hidden md:flex gap-6 uppercase tracking-widest font-bold text-[9px] text-text-dim">
            <span>VERSION {APP_VERSION}</span>
            <button onClick={() => setShowVersionHistory(true)} className="text-accent hover:text-white uppercase tracking-widest transition-colors">History</button>
          </div>
        </div>
        
        <div className="hidden sm:flex gap-1 items-center">
          <div className="flex gap-1 mr-4">
            {activeSteps.map((_, idx) => (
              <div
                key={idx}
                className={`h-1 rounded-full transition-all duration-500 ${
                  idx === state.step 
                    ? "w-4 bg-accent shadow-[0_0_10px_rgba(20,184,166,0.5)]" 
                    : idx < state.step 
                    ? "w-2 bg-accent/30" 
                    : "w-1 bg-text-dim/20"
                }`}
              />
            ))}
          </div>
          <button
            onClick={() => {
              navigator.clipboard?.writeText("HK08YR5L");
              triggerToast("Referral code HK08YR5L copied — new users get free tokens!", "info");
            }}
            title="Copy referral code — new users get free tokens"
            className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest text-text-dim hover:text-accent transition-colors active:scale-95"
          >
            <span className="opacity-50">Referral</span>
            <span className="text-accent font-bold tracking-wider">HK08YR5L</span>
            <span className="hidden lg:inline opacity-50 normal-case">· free tokens</span>
          </button>
        </div>

        <a
          href="https://discord.com/servers/isekai-zero-1415040517594550282"
          target="_blank"
          rel="noopener noreferrer"
          title="@Shegs — find me in the ISK0 Discord for feedback & ideas"
          className="hidden sm:flex items-center gap-1.5 text-[9px] font-mono uppercase tracking-widest text-text-dim hover:text-accent transition-colors"
        >
          <span className="text-accent">@Shegs</span>
          <span className="hidden lg:inline opacity-60">· ISK0 Discord — feedback &amp; ideas</span>
        </a>
      </footer>

      {/* Model Settings Modal */}
      <AnimatePresence>
        {showSettings && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowSettings(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-xl max-h-[90dvh] overflow-y-auto overscroll-contain bg-header border border-border rounded-3xl px-5 pb-6 sm:px-8 sm:pb-8 shadow-2xl custom-scrollbar"
            >
              <div className="absolute top-0 left-0 w-full h-1 bg-accent" />
              {/* Sticky header keeps the close button reachable on tall/mobile screens */}
              <div className="flex justify-between items-start gap-3 mb-8 sticky top-0 z-20 bg-header/95 backdrop-blur-sm pt-5 sm:pt-8 -mx-5 px-5 sm:-mx-8 sm:px-8 pb-3 border-b border-border/60">
                <div className="space-y-1 text-left">
                  <h2 className="text-xl font-black uppercase tracking-tighter">Model_Configuration</h2>
                  <p className="text-[10px] text-label font-bold uppercase tracking-widest">Aether_Core System Settings</p>
                </div>
                <button
                  onClick={() => setShowSettings(false)}
                  aria-label="Close settings"
                  className="shrink-0 p-2 -mr-1 hover:bg-white/5 rounded-lg text-label hover:text-white transition-all"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-8 text-left">
                {/* Provider Selection */}
                <div className="space-y-4">
                  <label className="text-[10px] uppercase tracking-[0.3em] font-black text-label block">AI_Provider</label>
                  <div className="grid grid-cols-2 gap-3">
                    {(Object.keys(PROVIDERS) as Array<keyof typeof PROVIDERS>).map((p) => (
                      <button
                        key={p}
                        onClick={() => {
                          setModelFilter("");
                          setState(s => ({
                          ...s,
                          aiProvider: p,
                          modelSettings: {
                            ...s.modelSettings,
                            model: PROVIDERS[p].models[0],
                            ollamaBaseUrl: s.modelSettings.ollamaBaseUrl || "http://localhost:11434"
                          }
                        }));
                        }}
                        className={`p-3 rounded-xl border text-xs font-bold tracking-tight transition-all text-center ${
                          state.aiProvider === p 
                            ? "border-accent bg-accent/10 text-accent font-black shadow-[0_0_12px_rgba(20,184,166,0.1)]" 
                            : "border-border bg-bg text-text-dim hover:text-text-muted hover:border-text-dim"
                        }`}
                      >
                        {PROVIDERS[p].name}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Ollama Advanced Settings block */}
                {state.aiProvider === "ollama" && (
                  <div className="p-5 border border-accent/20 bg-accent/5 rounded-2xl space-y-4 font-sans">
                    <div className="space-y-1.5">
                      <div className="flex justify-between items-center">
                        <label className="text-[10px] uppercase tracking-[0.2em] font-black text-accent">Ollama Base URL</label>
                        <span className="text-[8px] font-mono text-text-dim">Required</span>
                      </div>
                      <input 
                        type="text"
                        value={state.modelSettings.ollamaBaseUrl || "http://localhost:11434"}
                        onChange={(e) => setState(s => ({
                          ...s,
                          modelSettings: { ...s.modelSettings, ollamaBaseUrl: e.target.value }
                        }))}
                        className="w-full bg-header/60 border border-border rounded-lg p-2 font-mono text-xs text-text-main focus:border-accent focus:outline-none"
                        placeholder="e.g. http://localhost:11434"
                      />
                      <p className="text-[9px] text-[#fbbf24]/90 font-medium">
                        💡 Set to <code className="bg-black/30 px-1 py-0.5 rounded text-[8px] font-mono">http://host.docker.internal:11434</code> if running within Docker so the server can bridge back to your machine.
                      </p>
                    </div>
                    
                    <div className="space-y-1.5">
                      <label className="text-[10px] uppercase tracking-[0.2em] font-black text-accent">Custom Model Override</label>
                      <input 
                        type="text"
                        value={state.modelSettings.model}
                        onChange={(e) => setState(s => ({
                          ...s,
                          modelSettings: { ...s.modelSettings, model: e.target.value }
                        }))}
                        className="w-full bg-header/60 border border-border rounded-lg p-2 font-mono text-xs text-text-main focus:border-accent focus:outline-none"
                        placeholder="e.g. llama3, deepseek-coder..."
                      />
                      <p className="text-[11px] text-text-dim leading-normal">
                        Type any model currently downloaded on your machine (e.g., <code className="font-mono text-white/50 text-[8px]">ollama run llama3</code>).
                      </p>
                    </div>
                  </div>
                )}

                {/* Gemini API Key Override */}
                {state.aiProvider === "gemini" && (
                  <div className="p-5 border border-accent/20 bg-accent/5 rounded-2xl space-y-4 font-sans">
                    <div className="space-y-1.5">
                      <div className="flex justify-between items-center">
                        <label className="text-[10px] uppercase tracking-[0.2em] font-black text-accent">Gemini API Key (Local Override)</label>
                        <span className="text-[8px] font-mono text-text-dim">Optional</span>
                      </div>
                      <div className="relative flex items-center">
                        <input 
                          type={showGeminiKey ? "text" : "password"}
                          value={state.modelSettings.geminiApiKey || ""}
                          onChange={(e) => setState(s => ({
                            ...s,
                            modelSettings: { ...s.modelSettings, geminiApiKey: e.target.value }
                          }))}
                          className="w-full bg-header/60 border border-border rounded-lg p-2 pr-9 font-mono text-xs text-text-main focus:border-accent focus:outline-none"
                          placeholder="AI Studio API Key (e.g. AIzaSy...)"
                        />
                        <button
                          type="button"
                          onClick={() => setShowGeminiKey(v => !v)}
                          className="absolute right-2.5 p-1 text-text-dim hover:text-text-main transition-colors"
                        >
                          {showGeminiKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                      <p className="text-[11px] text-text-dim leading-normal">
                        💡 Key is processed server-side so it is never exposed in the browser's developer console. Leave empty to use server environment variable default.
                      </p>
                    </div>
                  </div>
                )}

                {/* Anthropic API Key Override */}
                {state.aiProvider === "anthropic" && (
                  <div className="p-5 border border-accent/20 bg-accent/5 rounded-2xl space-y-4 font-sans">
                    <div className="space-y-1.5">
                      <div className="flex justify-between items-center">
                        <label className="text-[10px] uppercase tracking-[0.2em] font-black text-accent">Anthropic API Key (Local Override)</label>
                        <span className="text-[8px] font-mono text-text-dim">Optional</span>
                      </div>
                      <div className="relative flex items-center">
                        <input 
                          type={showAnthropicKey ? "text" : "password"}
                          value={state.modelSettings.anthropicApiKey || ""}
                          onChange={(e) => setState(s => ({
                            ...s,
                            modelSettings: { ...s.modelSettings, anthropicApiKey: e.target.value }
                          }))}
                          className="w-full bg-header/60 border border-border rounded-lg p-2 pr-9 font-mono text-xs text-text-main focus:border-accent focus:outline-none"
                          placeholder="Claude API Key (e.g. sk-ant-sid...)"
                        />
                        <button
                          type="button"
                          onClick={() => setShowAnthropicKey(v => !v)}
                          className="absolute right-2.5 p-1 text-text-dim hover:text-text-main transition-colors"
                        >
                          {showAnthropicKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                      <p className="text-[11px] text-text-dim leading-normal">
                        💡 Key is processed server-side so it is never exposed in the browser's developer console. Leave empty to use server environment variable default.
                      </p>
                    </div>
                  </div>
                )}

                {/* OpenRouter API Key Override */}
                {state.aiProvider === "openrouter" && (
                  <div className="p-5 border border-accent/20 bg-accent/5 rounded-2xl space-y-4 font-sans">
                    <div className="space-y-1.5">
                      <div className="flex justify-between items-center">
                        <label className="text-[10px] uppercase tracking-[0.2em] font-black text-accent">OpenRouter API Key</label>
                        <span className="text-[8px] font-mono text-text-dim">Required to chat</span>
                      </div>
                      <div className="relative flex items-center">
                        <input
                          type={showOpenRouterKey ? "text" : "password"}
                          value={state.modelSettings.openRouterApiKey || ""}
                          onChange={(e) => setState(s => ({
                            ...s,
                            modelSettings: { ...s.modelSettings, openRouterApiKey: e.target.value }
                          }))}
                          className="w-full bg-header/60 border border-border rounded-lg p-2 pr-9 font-mono text-xs text-text-main focus:border-accent focus:outline-none"
                          placeholder="OpenRouter key (e.g. sk-or-v1-...)"
                        />
                        <button
                          type="button"
                          onClick={() => setShowOpenRouterKey(v => !v)}
                          className="absolute right-2.5 p-1 text-text-dim hover:text-text-main transition-colors"
                        >
                          {showOpenRouterKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                      <p className="text-[9px] text-[#fbbf24]/90 font-medium leading-normal">
                        💡 One free key at <code className="bg-black/30 px-1 py-0.5 rounded text-[8px] font-mono">openrouter.ai/keys</code> unlocks GPT, Claude, Gemini, Grok &amp; Llama through a single provider. Models tagged <span className="text-[#10b981] font-bold">:free</span> cost nothing (but are rate-limited).
                      </p>
                    </div>
                  </div>
                )}

                {/* Mistral API Key */}
                {state.aiProvider === "mistral" && (
                  <div className="p-5 border border-accent/20 bg-accent/5 rounded-2xl space-y-4 font-sans">
                    <div className="space-y-1.5">
                      <div className="flex justify-between items-center">
                        <label className="text-[10px] uppercase tracking-[0.2em] font-black text-accent">Mistral API Key</label>
                        <span className="text-[8px] font-mono text-text-dim">Required to chat</span>
                      </div>
                      <div className="relative flex items-center">
                        <input
                          type={showMistralKey ? "text" : "password"}
                          value={state.modelSettings.mistralApiKey || ""}
                          onChange={(e) => setState(s => ({
                            ...s,
                            modelSettings: { ...s.modelSettings, mistralApiKey: e.target.value }
                          }))}
                          className="w-full bg-header/60 border border-border rounded-lg p-2 pr-9 font-mono text-xs text-text-main focus:border-accent focus:outline-none"
                          placeholder="Mistral key (e.g. ...)"
                        />
                        <button
                          type="button"
                          onClick={() => setShowMistralKey(v => !v)}
                          className="absolute right-2.5 p-1 text-text-dim hover:text-text-main transition-colors"
                        >
                          {showMistralKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                      <p className="text-[9px] text-[#fbbf24]/90 font-medium leading-normal">
                        💡 A free key at <code className="bg-black/30 px-1 py-0.5 rounded text-[8px] font-mono">console.mistral.ai</code> includes a no-cost tier (rate-limited). Key is processed server-side, never exposed in the browser console.
                      </p>
                    </div>
                  </div>
                )}

                {/* Model Selection */}
                <div className="space-y-4">
                  <label className="text-[10px] uppercase tracking-[0.3em] font-black text-label block">Target_Model</label>

                  {providerFavourites.length > 0 && (
                    <div className="space-y-2 p-3 rounded-xl border border-[#fbbf24]/20 bg-[#fbbf24]/5">
                      <p className="text-[9px] uppercase tracking-[0.2em] font-black text-[#fbbf24] flex items-center gap-1.5">
                        <Star className="w-3 h-3 fill-[#fbbf24]" /> Favourites
                      </p>
                      <div className="grid grid-cols-1 gap-2">
                        {providerFavourites.map((m) => renderModelRow(m, m.endsWith(":free") ? freeBadge : undefined))}
                      </div>
                    </div>
                  )}

                  {state.aiProvider === "ollama" ? (
                    <div className="space-y-3">
                      {isFetchingModels && (
                        <div className="text-xs font-mono text-accent flex items-center gap-2 py-2 animate-pulse">
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          Scanning local Ollama daemon...
                        </div>
                      )}
                      
                      {ollamaError && (
                        <div className="p-3 border border-red-500/10 bg-red-500/5 text-red-500 rounded-lg text-[10px] leading-relaxed space-y-1 font-sans">
                          <p className="font-bold flex items-center gap-1.5 text-red-400">
                            ⚠️ Connection Issue
                          </p>
                          <p className="font-mono text-[9px] bg-black/30 p-1.5 rounded">{ollamaError}</p>
                          <p className="font-sans text-[9px] text-text-dim">
                            Verify Ollama is running and CORS is allowed (<code className="bg-black/20 px-1 rounded">OLLAMA_ORIGINS="*"</code>). Below is a dynamic list if connected, or default options.
                          </p>
                        </div>
                      )}
                      
                      {localOllamaModels.length > 0 ? (
                        <div className="grid grid-cols-1 gap-2 max-h-[180px] overflow-y-auto custom-scrollbar pr-1">
                          {localOllamaModels.map((m) => renderModelRow(m, installedBadge))}
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 gap-2">
                          {PROVIDERS[state.aiProvider].models.map((m) => renderModelRow(m))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {isFetchingRemoteModels && (
                        <div className="text-xs font-mono text-accent flex items-center gap-2 py-1 animate-pulse">
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          Fetching available models...
                        </div>
                      )}
                      {remoteModelError && (
                        <p className="text-[9px] font-sans text-[#fbbf24]/90 leading-normal">
                          ⚠️ Couldn't fetch live models ({remoteModelError}). Showing known defaults — add a valid API key to load the current list.
                        </p>
                      )}
                      {hostedModels.length > 12 && (
                        <input
                          type="text"
                          value={modelFilter}
                          onChange={(e) => setModelFilter(e.target.value)}
                          className="w-full bg-header/60 border border-border rounded-lg p-2 font-mono text-xs text-text-main focus:border-accent focus:outline-none"
                          placeholder={`Filter ${hostedModels.length} models... (try "free", "claude", "gpt", "grok")`}
                        />
                      )}
                      <div className="grid grid-cols-1 gap-2 max-h-[220px] overflow-y-auto custom-scrollbar pr-1">
                        {visibleHostedModels.length === 0 && (
                          <p className="text-[10px] font-mono text-text-dim py-2">No models match "{modelFilter}".</p>
                        )}
                        {visibleHostedModels.map((m) => renderModelRow(m, hostedBadge(m)))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Parameters */}
                <div className="grid grid-cols-2 gap-8 pt-4">
                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <label className="text-[10px] uppercase tracking-[0.2em] font-black text-label">Temperature</label>
                      <span className="text-[10px] font-mono text-accent">{state.modelSettings.temperature}</span>
                    </div>
                    <input 
                      type="range"
                      min="0"
                      max="2"
                      step="0.1"
                      value={state.modelSettings.temperature}
                      onChange={(e) => setState(s => ({
                        ...s,
                        modelSettings: { ...s.modelSettings, temperature: parseFloat(e.target.value) }
                      }))}
                      className="w-full h-1 bg-border rounded-full appearance-none accent-accent cursor-pointer"
                    />
                    {state.aiProvider === "ollama" && state.modelSettings.temperature > 0.8 && (
                      <p className="text-[9px] text-[#fbbf24] leading-snug">Smaller local models can ramble or break the capture formatting at high temperature — try <span className="font-bold">~0.6</span> for cleaner, capture-ready output.</p>
                    )}
                  </div>
                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <label className="text-[10px] uppercase tracking-[0.2em] font-black text-label">Max_Tokens</label>
                      <span className="text-[10px] font-mono text-accent">{state.modelSettings.maxTokens} <span className="text-text-dim">/ {tokenCeiling}</span></span>
                    </div>
                    <input
                      type="range"
                      min="1024"
                      max={tokenCeiling}
                      step="256"
                      value={Math.min(state.modelSettings.maxTokens, tokenCeiling)}
                      onChange={(e) => setState(s => ({
                        ...s,
                        modelSettings: { ...s.modelSettings, maxTokens: Math.min(parseInt(e.target.value), tokenCeiling), maxTokensTouched: true }
                      }))}
                      className="w-full h-1 bg-border rounded-full appearance-none accent-accent cursor-pointer"
                    />
                    <p className="text-[11px] text-text-dim leading-normal">Capped to the selected model's output limit. Higher values prevent long HTML cards / guideline sets from being truncated.</p>
                  </div>
                </div>
              </div>

              <div className="mt-10 pt-8 border-t border-border flex justify-end">
                <button
                  onClick={() => setShowSettings(false)}
                  className="px-8 py-2.5 bg-accent text-black rounded-lg text-xs font-black uppercase tracking-[0.2em] hover:bg-white transition-all shadow-xl shadow-accent/20"
                >
                  SAVE_PARAMETERS
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Help / How-To */}
      <AnimatePresence>
        {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
        {showVersionHistory && <VersionHistoryModal onClose={() => setShowVersionHistory(false)} />}
      </AnimatePresence>

      {/* Real-time sync notifications */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 50, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 30, scale: 0.95 }}
            onClick={() => setToast(null)}
            className={`fixed bottom-6 right-6 z-[120] max-w-sm p-4 rounded-xl border shadow-2xl backdrop-blur-md flex items-start gap-3 cursor-pointer transition-all hover:scale-[1.02] ${
              toast.type === "ai-to-ui"
                ? "bg-accent/10 border-accent/30 text-accent shadow-accent/10"
                : toast.type === "ui-to-ai"
                ? "bg-[#10b981]/10 border-[#10b981]/30 text-[#10b981] shadow-[#10b981]/10"
                : "bg-card border-border text-text-main"
            }`}
          >
            <div className={`p-2 rounded-lg ${
              toast.type === "ai-to-ui" ? "bg-accent/10" : toast.type === "ui-to-ai" ? "bg-[#10b981]/10" : "bg-white/5"
            }`}>
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest opacity-60">
                {toast.type === "ai-to-ui" ? "AI COLLABORATOR SYNC" : toast.type === "ui-to-ai" ? "DESKSTATE SYNCHRONIZED" : "SYSTEM MESSAGE"}
              </p>
              <p className="text-xs font-medium mt-1 leading-relaxed text-white">
                {toast.message}
              </p>
              <span className="text-[8px] font-mono opacity-30 uppercase tracking-[0.2em] mt-2 block">Click to close</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function CollaboratorChat({ state, setState, compact, askAssistant, setIsChatOpen, isDetached, setIsDetached, isSyncNeeded, syncDeskstateToAI, onExport, onExportDM, onSnapshot, onSaveWorkspace, onLoadWorkspace, isExporting, exportProgress, readyToAdvance, onAdvance, responseTruncated, onContinue, onRetry }: {
  state: StoryState,
  setState: React.Dispatch<React.SetStateAction<StoryState>>,
  compact?: boolean,
  askAssistant: (p: string) => Promise<void>,
  setIsChatOpen: (o: boolean) => void,
  isDetached?: boolean,
  setIsDetached?: (d: boolean) => void,
  isSyncNeeded?: boolean,
  syncDeskstateToAI?: () => void,
  onExport?: () => void,
  onExportDM?: () => void,
  onSnapshot?: () => void,
  onSaveWorkspace?: () => void,
  onLoadWorkspace?: (file: File) => void,
  isExporting?: boolean,
  exportProgress?: string,
  readyToAdvance?: boolean,
  onAdvance?: () => void,
  responseTruncated?: boolean,
  onContinue?: () => void,
  onRetry?: () => void
}) {
  const workspaceFileRef = useRef<HTMLInputElement>(null);
  const activeSteps = getActiveSteps(state.workshopTrack);
  // On short/mobile viewports the composer + workspace buttons are collapsed by
  // default so the message area keeps maximum reading height; a toggle reveals
  // them. On normal screens this gate is inert — everything renders as before.
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const showWorkspace = !compact || workspaceOpen;
  return (
    <>
      <div className={`p-4 border-b border-border bg-header/60 flex items-center justify-between shrink-0 ${isDetached ? 'cursor-grab active:cursor-grabbing h-10 py-0' : (compact ? 'p-3' : 'p-6')}`}>
        {!isDetached && (
          <div className="flex items-center gap-3">
            <div className="p-2 bg-accent/10 rounded-lg">
              <MessageSquare className="w-4 h-4 text-accent" />
            </div>
            <div>
              <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-accent">Collaborator_Chat</h2>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className={`inline-block w-1.5 h-1.5 rounded-full ${isSyncNeeded ? "bg-[#fbbf24] animate-pulse" : "bg-[#10b981]"}`} />
                <span className="text-[8px] font-mono text-text-dim uppercase tracking-tighter">
                  {isSyncNeeded ? "Settings Changed" : "Synced"}
                </span>
              </div>
            </div>
          </div>
        )}
        {isDetached && (
          <div className="flex items-center gap-2 opacity-40">
            <Terminal className="w-3 h-3 text-accent" />
            <span className="text-[8px] font-black uppercase tracking-[0.3em] text-accent">Detached_Link</span>
          </div>
        )}
        <div className="flex items-center gap-2">
          {setIsDetached && (
             <button 
             onClick={() => setIsDetached(!isDetached)} 
             className={`flex items-center gap-2 p-2 hover:bg-white/5 rounded-lg text-label transition-all active:scale-95 ${isDetached ? 'text-accent bg-accent/10' : ''}`}
             title={isDetached ? "Dock Chat" : "Detach Chat"}
           >
             <Layout className="w-4 h-4" />
           </button>
          )}
          <button 
            onClick={() => setIsChatOpen(false)} 
            className={`xl:hidden flex items-center gap-2 p-2.5 bg-white/5 hover:bg-white/10 rounded-xl text-label transition-all active:scale-95 border border-white/5`}
          >
            <X className="w-5 h-5 text-accent" />
          </button>
          <button 
            onClick={() => setState(s => ({ ...s, assistantHistory: [] }))}
            className="p-2 hover:bg-red-500/10 rounded-md text-text-dim hover:text-red-400 transition-all group hidden sm:block"
            title="Clear History"
          >
            <Terminal className="w-3 h-3 transition-transform group-hover:rotate-90" />
          </button>
        </div>
      </div>

      <div className={`flex-1 overflow-y-auto custom-scrollbar bg-bg/30 ${compact ? 'p-3 space-y-3' : 'p-6 space-y-6'}`}>
        {state.assistantHistory.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center space-y-4 opacity-40">
            <Sparkles className="w-8 h-8 text-accent animate-pulse" />
            <p className="text-[10px] uppercase font-black tracking-[0.3em]">Awaiting directive...</p>
            <p className="text-xs text-text-muted max-w-[200px] leading-relaxed italic">
              "Discussion initialized for {getActiveSteps(state.workshopTrack)[state.step]}."
            </p>
          </div>
        ) : (
          state.assistantHistory.map((m, i) => {
            const isError = m.content.startsWith("ERROR_SIGNAL");
            const isLast = i === state.assistantHistory.length - 1;
            const rawErr = isError ? m.content.replace(/^ERROR_SIGNAL:\s*/, "") : "";
            // Free OpenRouter models commonly fail with a rate/quota error — give a
            // tailored hint so the user knows to retry or pick another model.
            const isRateLimited = /rate|quota|429|free|exhaust|capacity|limit|busy|temporarily/i.test(rawErr);
            return (
            <div key={i} className={`flex flex-col ${m.role === "assistant" ? "items-start" : "items-end"} gap-2 w-full min-w-0`}>
              <div className={`px-4 py-3 rounded-2xl text-[13px] leading-relaxed max-w-[90%] shadow-lg transition-all break-words ${
                isError
                  ? "bg-red-500/10 border border-red-500/30 text-red-200 rounded-tl-sm"
                  : m.role === "assistant"
                  ? "bg-card border border-border text-text-main rounded-tl-sm"
                  : "bg-accent/10 border border-accent/20 text-accent font-medium rounded-tr-sm"
              }`}>
                <div className="flex items-center gap-2 mb-2 opacity-50">
                  <div className={`w-1.5 h-1.5 rounded-full ${isError ? "bg-red-400" : m.role === "assistant" ? "bg-accent" : "bg-white"}`} />
                  <span className="text-[9px] uppercase font-bold tracking-widest">{isError ? "Link_Error" : m.role === "assistant" ? "Aether_Core" : "User_Node"}</span>
                </div>
                {isError ? (
                  <div className="space-y-1.5">
                    <p className="font-semibold text-red-300">
                      {isRateLimited
                        ? "This model is rate-limited or out of free allocation right now."
                        : "The request didn't go through."}
                    </p>
                    <p className="whitespace-pre-wrap break-words text-red-200/80 text-[11px]">{rawErr}</p>
                    {isRateLimited && (
                      <p className="text-red-200/60 text-[11px] leading-relaxed">Free OpenRouter models share a daily cap and can be busy. Hit <span className="font-bold">Retry</span> to try the same model again, or switch to another model in Settings.</p>
                    )}
                  </div>
                ) : (
                  <p className="whitespace-pre-wrap break-words">{m.content}{m.streaming && <span className="inline-block w-[2px] h-[1.05em] ml-0.5 bg-accent align-text-bottom animate-pulse" />}</p>
                )}
              </div>
              {m.role === "assistant" && !isError && m.usage && (m.usage.input + m.usage.output + m.usage.cacheRead + m.usage.cacheWrite) > 0 && (() => {
                const u = m.usage;
                const totalIn = u.input + u.cacheRead + u.cacheWrite;
                const cachePct = totalIn > 0 ? Math.round((u.cacheRead / totalIn) * 100) : 0;
                const fmt = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`;
                return (
                  <div
                    title={`Input ${u.input} full-price + ${u.cacheRead} from cache + ${u.cacheWrite} written to cache · Output ${u.output}. Cached input costs ~10% of full price.`}
                    className="flex items-center gap-2 text-[11px] font-mono text-text-muted px-1"
                  >
                    <span>{fmt(totalIn)} in · {fmt(u.output)} out</span>
                    {u.cacheRead > 0 ? (
                      <span className="text-accent font-bold">⚡ {cachePct}% cached</span>
                    ) : u.cacheWrite > 0 ? (
                      <span className="text-text-muted/80">⚡ cache primed</span>
                    ) : null}
                  </div>
                );
              })()}
              {isError && isLast && onRetry && (
                <button
                  onClick={onRetry}
                  disabled={state.isAssistantLoading}
                  title="Re-send your last message (keeps the conversation; just retries the request)"
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/15 hover:bg-red-500/25 border border-red-500/30 rounded-lg text-[10px] font-black uppercase tracking-wider text-red-200 transition-all active:scale-95 disabled:opacity-50"
                >
                  <RefreshCw className="w-3 h-3" /> Retry
                </button>
              )}
            </div>
            );
          })
        )}
        {state.isAssistantLoading && !(state.assistantHistory.length > 0 && state.assistantHistory[state.assistantHistory.length - 1].streaming) && (
          <div className="flex items-center gap-3 text-accent animate-pulse pb-4">
            <div className="flex gap-1">
              <div className="w-1 h-1 bg-accent rounded-full animate-bounce" />
              <div className="w-1 h-1 bg-accent rounded-full animate-bounce [animation-delay:0.2s]" />
              <div className="w-1 h-1 bg-accent rounded-full animate-bounce [animation-delay:0.4s]" />
            </div>
            <span className="text-[9px] uppercase font-black tracking-widest">Processing</span>
          </div>
        )}
        <ChatScrollAnchor history={state.assistantHistory} isLoading={state.isAssistantLoading} />
      </div>
      
      <div className={`border-t border-border bg-[#18181b]/80 shrink-0 ${compact ? 'p-3' : 'p-6'}`}>
        {responseTruncated && onContinue && (
          <button
            onClick={onContinue}
            disabled={state.isAssistantLoading}
            title="The last response hit the Max_Tokens limit. Continue it, or raise Max_Tokens in Settings."
            className="mb-3 w-full py-2.5 px-3 bg-[#fbbf24]/10 hover:bg-[#fbbf24]/20 border border-[#fbbf24]/30 rounded-lg flex items-center justify-between text-left transition-all active:scale-[0.98] disabled:opacity-50"
          >
            <div className="flex items-center gap-1.5 min-w-0">
              <AlertTriangle className="w-3.5 h-3.5 text-[#fbbf24] shrink-0" />
              <span className="text-[10px] font-black uppercase tracking-wider text-[#fbbf24] truncate">
                Cut off at token limit
              </span>
            </div>
            <span className="text-[8px] font-bold text-black uppercase bg-[#fbbf24] px-2 py-1 rounded font-mono shrink-0">Continue →</span>
          </button>
        )}
        {readyToAdvance && onAdvance && state.step < activeSteps.length - 1 && (
          <button
            onClick={onAdvance}
            className="mb-3 w-full py-2.5 px-3 bg-accent/15 hover:bg-accent/25 border border-accent/40 rounded-lg flex items-center justify-between text-left transition-all active:scale-[0.98] group shadow-[0_0_18px_rgba(20,184,166,0.2)]"
          >
            <div className="flex items-center gap-1.5 min-w-0">
              <CheckCircle2 className="w-3.5 h-3.5 text-accent shrink-0" />
              <span className="text-[10px] font-black uppercase tracking-wider text-accent truncate">
                Step complete — lock in &amp; continue
              </span>
            </div>
            <span className="text-[8px] font-bold text-black uppercase bg-accent px-2 py-1 rounded font-mono shrink-0 flex items-center gap-1">
              {activeSteps[state.step + 1]} <ChevronRight className="w-2.5 h-2.5" />
            </span>
          </button>
        )}
        {isSyncNeeded && syncDeskstateToAI && (
          <button
            onClick={syncDeskstateToAI}
            className="mb-3 w-full py-2 px-3 bg-[#fbbf24]/10 hover:bg-[#fbbf24]/20 border border-[#fbbf24]/20 hover:border-[#fbbf24]/40 rounded-lg flex items-center justify-between text-left transition-all active:scale-[0.98] group"
          >
            <div className="flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-[#fbbf24] animate-pulse shrink-0" />
              <span className="text-[10px] font-black uppercase tracking-wider text-[#fbbf24] truncate">
                ✦ UI settings out of sync
              </span>
            </div>
            <span className="text-[8px] font-bold text-white uppercase bg-[#fbbf24]/30 px-1.5 py-0.5 rounded font-mono group-hover:bg-[#fbbf24]/50 transition-colors shrink-0">
              Sync ↺
            </span>
          </button>
        )}
        {compact && (
          <button
            type="button"
            onClick={() => setWorkspaceOpen(o => !o)}
            title={workspaceOpen ? "Hide the composer & workspace tools" : "Show the composer & workspace tools"}
            className="w-full flex items-center gap-2 py-1.5 text-label hover:text-accent transition-colors text-[9px] font-black uppercase tracking-widest"
          >
            <ChevronRight className={`w-3 h-3 transition-transform ${workspaceOpen ? 'rotate-90' : ''}`} />
            {workspaceOpen ? "Hide composer & tools" : "Compose & tools"}
          </button>
        )}
        {showWorkspace && (
          <>
        <ChatInput onSend={askAssistant} isLoading={state.isAssistantLoading} compact={compact} />

        {isExporting && exportProgress && (
          <div className="mt-4 flex items-center gap-2 text-[9px] font-mono text-accent uppercase tracking-widest animate-pulse">
            <RefreshCw className="w-3 h-3 animate-spin shrink-0" />
            <span className="truncate">Compiling · {exportProgress}</span>
          </div>
        )}
        <div className={`grid grid-cols-2 gap-3 ${compact ? 'mt-2' : 'mt-4'}`}>
          <button
            onClick={onSnapshot}
            disabled={state.assistantHistory.length === 0}
            title="Download a full backup of this session (deskstate + entire chat) as a .txt"
            className={`${compact ? 'py-1.5' : 'py-2'} bg-border/40 hover:bg-border/60 border border-border rounded-lg flex items-center justify-center gap-2 text-[9px] font-black uppercase tracking-widest transition-all disabled:opacity-30 disabled:cursor-not-allowed`}
          >
            <Save className="w-3 h-3" /> Snapshot
          </button>
          {state.workshopTrack === "dm-only" ? (
            <button
              onClick={onExportDM}
              title="Download the Dungeon Mind config (Name, Model, Stat Schema, Game Rules, Reminder, Instruction, Player Guide) as a clean .txt — copy-paste-ready for ISK0's DM editor"
              className={`${compact ? 'py-1.5' : 'py-2'} bg-accent/10 hover:bg-accent/20 border border-accent/20 text-accent rounded-lg flex items-center justify-center gap-2 text-[9px] font-black uppercase tracking-widest transition-all`}
            >
              <Download className="w-3 h-3" /> Export DM
            </button>
          ) : (
            <button
              onClick={onExport}
              disabled={isExporting || state.assistantHistory.length === 0}
              title="Compile the final ISK0 package (Title, Plot Card, Characters, Scenarios, Prompt Plot, Guidelines, Reminders) and download it as a clean .txt — no chat"
              className={`${compact ? 'py-1.5' : 'py-2'} bg-accent/10 hover:bg-accent/20 border border-accent/20 text-accent rounded-lg flex items-center justify-center gap-2 text-[9px] font-black uppercase tracking-widest transition-all disabled:opacity-40 disabled:cursor-not-allowed`}
            >
              {isExporting ? (
                <><RefreshCw className="w-3 h-3 animate-spin" /> Compiling…</>
              ) : (
                <><Download className="w-3 h-3" /> Export_Core</>
              )}
            </button>
          )}
        </div>
        {/* Portable workspace backup — full state + chat as re-loadable JSON */}
        <div className={`grid grid-cols-2 gap-3 ${compact ? 'mt-2' : 'mt-3'}`}>
          <button
            onClick={onSaveWorkspace}
            title="Save a portable .json backup of the whole workspace (deskstate + deliverables + chat) — re-loadable later or on another machine. API keys are NOT included."
            className={`${compact ? 'py-1.5' : 'py-2'} bg-border/40 hover:bg-border/60 border border-border rounded-lg flex items-center justify-center gap-2 text-[9px] font-black uppercase tracking-widest transition-all`}
          >
            <Download className="w-3 h-3" /> Save Workspace
          </button>
          <button
            onClick={() => workspaceFileRef.current?.click()}
            title="Load a previously saved .aether.json workspace backup — replaces the current story, chat & deliverables (your typed API keys are kept)"
            className={`${compact ? 'py-1.5' : 'py-2'} bg-border/40 hover:bg-border/60 border border-border rounded-lg flex items-center justify-center gap-2 text-[9px] font-black uppercase tracking-widest transition-all`}
          >
            <Save className="w-3 h-3" /> Load Workspace
          </button>
          <input
            ref={workspaceFileRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f && onLoadWorkspace) onLoadWorkspace(f);
              e.target.value = "";   // allow re-selecting the same file
            }}
          />
        </div>
          </>
        )}
      </div>
    </>
  );
}

function VersionHistoryModal({ onClose }: { onClose: () => void }) {
  const releases: { v: string; title: string; items: string[] }[] = [
    {
      v: "0.11.0", title: "Curated palettes · sturdier capture · smarter token limits",
      items: [
        "Added 12 curated colour palettes to the Visual Registry — one-click presets (Eldritch Void, Crimson Noir, Emerald Grove, Royal Amethyst, two light themes, and more), each contrast-checked so your main text always stays readable on its background. Picking one fills all five swatches; you can still fine-tune any colour by hand.",
        "Deliverable capture is far more forgiving of how different AI models format their output. Some models (notably Mistral on longer chats) drop a bracket, omit the closing marker, or wrap a block in a code fence — which used to make a finished character sheet, scenario, or plot card silently fail to save. The workshop now recovers these automatically, while still ignoring genuinely cut-off (truncated) responses.",
        "Max Tokens now defaults to each model's real output ceiling instead of a flat 4,096 — so long HTML cards and full character sheets no longer get truncated mid-block. If you set the slider yourself, your choice is kept and only ever clamped down to a model's limit.",
        "The card preview now warns when a card uses styling ISK0 silently strips (single-side borders, box-shadows) so you can fix it before export.",
        "Under the hood: capture logic moved into its own unit-tested module, server error logs now redact API keys, and assorted build/doc cleanup.",
      ],
    },
    {
      v: "0.10.5", title: "Collaborator chat fits small & short screens",
      items: [
        "The Collaborator Chat no longer auto-scrolls to the bottom on every streamed token — it only follows the response if you're already near the bottom, so you can scroll up and read earlier messages while a reply is still generating.",
        "On small or short viewports the chat now switches to a compact density (tighter padding, slimmer Snapshot/Export/Save/Load buttons) and the composer + workspace buttons collapse behind a one-tap \"Compose & tools\" toggle, giving the message area far more reading height. Normal-sized screens are unchanged.",
        "Your docked chat width and floating-window size now persist across reloads.",
        "Themed the main workshop scrollbar to match the rest of the app (accent teal instead of the default grey), and removed an unused legacy chat component.",
      ],
    },
    {
      v: "0.10.4", title: "Card accent borders that survive ISK0",
      items: [
        "Fixed section accent strips silently disappearing on the ISK0 platform. Single-side accent bars (border-left) — and every fallback for them (inset shadow, gradient strip, narrow table/flex cell) — are stripped by ISK0's renderer; confirmed across three rounds of live testing. The card spec and the plot/character card prompts now use a FULL accent border (border:2px solid #hex) to differentiate sections, which renders reliably on the platform. Cards generated from here on will keep their section accents on ISK0.",
      ],
    },
    {
      v: "0.10.3", title: "Instant palette recolor",
      items: [
        "Recolor cards to your palette instantly, with no AI call: the Plot Card and each Character Card now have a ⚡ Recolor button that swaps your palette colours — both the solid hex used for text AND the rgba() borders/tints derived from them — directly in the card HTML. Off-palette shades (neutral darks the model invented) are left untouched. The AI 're-skin' is still there for structural changes or off-palette reshades.",
        "Fixed card previews not refreshing after a recolor or AI re-skin — the live preview iframe now reliably re-renders the updated HTML.",
      ],
    },
    {
      v: "0.10.2", title: "Device-width card previews",
      items: [
        "Plot Card and Character Card previews now have a device-width toggle (Phone 390 · Tablet 768 · Full): clamp the live preview to a phone or tablet width to see exactly how the card's columns and pills reflow on each device — catching cramped or wrapping layouts before you publish, without copy-pasting the HTML into a playroom.",
      ],
    },
    {
      v: "0.10.1", title: "Story + DM polish",
      items: [
        "The Story + DM coherence review now reads your ACTUAL captured artifacts (Guidelines, Prompt Plot, Player Persona, and the DM stat schema / game rules / instruction) instead of reviewing them blind — so it cross-checks real text rather than assuming.",
        "Fixed the \"step complete\" pulse on collaborate-then-capture steps (e.g. the DM Stat Schema): it no longer fires on the clarifying-questions turn, and now fires on the turn that actually captures the deliverable.",
      ],
    },
    {
      v: "0.10.0", title: "Mistral provider · sturdier cards & capture",
      items: [
        "Added Mistral AI as a model provider — it has a free tier (console.mistral.ai). Tested & recommended model: Mistral Medium 3.5 (mistral-medium-latest), strong at creative writing and tidy formatting.",
        "Rebuilt the HTML card rules to render well on BOTH desktop and mobile: cards stay fluid (width:100%, max-width 600/720px) with percentage-width responsive columns, sit on the locked palette background, and use solid hex for accent text — fixing cards that looked different in the preview vs. on the ISK0 platform.",
        "Hardened character capture: a literal placeholder name (\"NAME\") no longer spawns a ghost/duplicate character — the card or description routes to the character in progress instead, with a heads-up if it can't.",
      ],
    },
    {
      v: "0.9.2", title: "Dungeon Mind rules: executable math",
      items: [
        "Hardened the Dungeon Mind framework (USCS §27) so Game Rules must be mechanically runnable: every value the DM computes — stat→modifier, defense/AC, skill DCs, damage, death-save DC, progression numbers, condition magnitudes, encumbrance — needs an explicit formula, not a dangling reference.",
        "Stat Schema now requires paired Max stats (Max HP/MP) for capped resources, and Concept & Scope locks the core resolution math up front.",
      ],
    },
    {
      v: "0.9.1", title: "Local-model fixes & sturdier capture",
      items: [
        "Local Ollama: reasoning models (qwen3, deepseek-r1, gpt-oss…) now answer directly instead of returning a blank response, and large step prompts are no longer silently truncated — the context window is sized to fit the prompt.",
        "Capture is more forgiving of smaller models: the closing marker may repeat its type, and the exact opening-sentinel format is now reinforced hard in every build step so deliverables actually save.",
      ],
    },
    {
      v: "0.9.0", title: "Story + Dungeon Mind integration",
      items: [
        "New \"Story + Dungeon Mind\" track — build a full story package with a Dungeon Mind attached. DM Concept & Scope and Stat Schema come early (right after Concept Intake) so the story can reference real stat names.",
        "Story steps adapt when a DM is attached (USCS §27.5): the Prompt Plot drops mechanics the DM owns, the Guidelines gain a DUNGEON MIND ACTIVE rule, and stat tracking isn't duplicated.",
        "A final Story + DM Review step cross-checks both artifacts for coherence before you export them separately.",
      ],
    },
    {
      v: "0.8.0", title: "Dungeon Mind — standalone build",
      items: [
        "New \"Dungeon Mind only\" track on Mode Selection — build a game-mechanics config (stat schema, game rules, reminder, story-AI instruction, player guide, name & model) per USCS §27, with no story package.",
        "Each DM field has its own step, AI draft button, capture, and platform caps (Game Rules ≤10k tok, Reminder ≤500 tok, Player Guide ≤1000 chars); the Token Summary shows a dedicated DM panel.",
        "Export DM Config (.txt) — copy-paste-ready into ISK0's Dungeon Mind editor. Corrected the old, inaccurate \"world-as-stage\" DM description.",
      ],
    },
    {
      v: "0.7.0", title: "Portable workspace backups",
      items: [
        "Save Workspace / Load Workspace — export your entire project (settings, deliverables and chat) as a portable .aether.json file and re-load it later or on another machine.",
        "API keys are deliberately excluded from the backup file, so it's safe to share or store; you supply your own key wherever you load it.",
      ],
    },
    {
      v: "0.6.2", title: "One-click copy for deliverables",
      items: [
        "Every row in the Token Summary now has a small copy icon — grab a single block (Prompt Plot, Guidelines, a character, etc.) to clipboard without a full export.",
        "Preview panels gained \"Copy HTML\" / copy buttons: Plot Card, character cards, Guidelines and Reminders — handy for testing a piece in a playroom or sharing on Discord mid-session.",
      ],
    },
    {
      v: "0.6.1", title: "Custom-limit fix & chat cleanup",
      items: [
        "Custom section-limit fields now accept typed numbers freely (the floor only applies when you leave the field) — previously a keystroke snapped the value to the minimum.",
        "Removed the per-message \"Capture as…\" dropdown from chat; automatic capture handles this reliably and the control only caused confusion.",
      ],
    },
    {
      v: "0.6.0", title: "Workflow restructuring & ISK0 alignment",
      items: [
        "World Grounding redesigned — expandable template pills + one live editor; robust rule parser.",
        "Character Sheets rebuilt around the narration guidance first, HTML card last; shows the real captured cast.",
        "\"Scenarios\" step renamed \"Scenario & System Planning\" with a clear ISK0 field-destination map.",
        "Guidelines & Reminders gained one-click \"assemble\" triggers.",
        "First Messages are now tracked and counted toward the token budget.",
        "Telemetry rebuilt as an ISK0-style Token Summary with §21 cap warnings + one-click \"tighten to cap\".",
        "Advance button now also flashes on plain-language completion; UI polish across scrollbars, resize handle, responsive cards.",
      ],
    },
    {
      v: "0.5.0", title: "Streaming, caching & live previews",
      items: [
        "AI responses stream in live across all four providers.",
        "Anthropic prompt caching + a per-message cache chip.",
        "Live sandboxed HTML preview of the Plot Card with palette iteration.",
        "Many prompt fixes to stop weaker models jumping ahead.",
      ],
    },
    {
      v: "0.3.0", title: "Public launch & security",
      items: [
        "Deployed live on Render (bring-your-own-key).",
        "Security hardening pass; in-chat Retry for failed / rate-limited sends.",
      ],
    },
    {
      v: "0.2.0", title: "Core workshop",
      items: [
        "Per-step USCS v6.1 loader; four AI providers; structured deliverable capture.",
        "Token-budget tracking and multi-part export.",
      ],
    },
  ];

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
      <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }} className="relative w-full max-w-lg max-h-[88vh] flex flex-col bg-header border border-border rounded-3xl shadow-2xl overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-1 bg-accent" />
        <div className="flex justify-between items-start p-8 pb-4 shrink-0">
          <div className="space-y-1 text-left">
            <h2 className="text-xl font-black uppercase tracking-tighter flex items-center gap-2"><Zap className="w-5 h-5 text-accent" /> Version History</h2>
            <p className="text-[10px] text-label font-bold uppercase tracking-widest">Aether_Core · currently v{APP_VERSION}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-lg text-label hover:text-white transition-all">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="px-8 pb-8 overflow-y-auto custom-scrollbar space-y-6 text-left">
          {releases.map((r) => (
            <section key={r.v} className="space-y-2">
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-black text-accent font-mono">v{r.v}</span>
                <span className="text-xs font-bold text-text-main uppercase tracking-wide">{r.title}</span>
              </div>
              <ul className="space-y-1.5 text-[13px] text-text-muted leading-relaxed">
                {r.items.map((it, i) => <li key={i} className="flex gap-2"><span className="text-accent shrink-0">•</span><span>{it}</span></li>)}
              </ul>
            </section>
          ))}
        </div>
        <div className="px-8 py-4 border-t border-border shrink-0 flex justify-end">
          <button onClick={onClose} className="px-8 py-2.5 bg-accent text-black rounded-lg text-xs font-black uppercase tracking-[0.2em] hover:bg-white transition-all">Got it</button>
        </div>
      </motion.div>
    </div>
  );
}

function HelpModal({ onClose }: { onClose: () => void }) {
  const Link = ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-accent underline decoration-accent/40 hover:decoration-accent break-all">{children}</a>
  );
  const H = ({ children }: { children: React.ReactNode }) => (
    <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-accent flex items-center gap-2 pt-2">
      <div className="w-2 h-[1px] bg-accent" />{children}
    </h3>
  );

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="relative w-full max-w-2xl max-h-[88vh] flex flex-col bg-header border border-border rounded-3xl shadow-2xl overflow-hidden"
      >
        <div className="absolute top-0 left-0 w-full h-1 bg-accent" />
        <div className="flex justify-between items-start p-8 pb-4 shrink-0">
          <div className="space-y-1 text-left">
            <h2 className="text-xl font-black uppercase tracking-tighter flex items-center gap-2"><HelpCircle className="w-5 h-5 text-accent" /> How It Works</h2>
            <p className="text-[10px] text-label font-bold uppercase tracking-widest">Aether_Core · Quick Guide</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-lg text-label hover:text-white transition-all">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-8 pb-8 overflow-y-auto custom-scrollbar space-y-5 text-left text-[13px] leading-relaxed text-text-muted">
          <section className="space-y-2">
            <H>What this is</H>
            <p>Aether_Core is a <span className="text-text-main">workshop</span>, not a chatbot. You collaborate step-by-step with an AI to build a complete, copy-paste-ready <span className="text-text-main">story package</span> for the ISK0 platform — using the USCS v6.1 framework under the hood. The AI is a co-author and architect; it never plays the story itself.</p>
            <p>As you finish each piece (plot card, character sheets, guidelines, etc.), the app captures it into a structured package and tracks its token budget. When you're done, <span className="text-text-main">Export_Core</span> assembles everything into one clean <code className="bg-black/30 px-1 rounded text-[11px]">.txt</code> file.</p>
          </section>

          <section className="space-y-2">
            <H>Three tracks (Mode Selection)</H>
            <p>On the first screen you choose what to build:</p>
            <ul className="space-y-1.5 pl-1">
              <li>• <span className="text-text-main">Full Story Package</span> — the standard 16-step narrative pipeline.</li>
              <li>• <span className="text-text-main">Story + Dungeon Mind</span> — a full story, then a Dungeon Mind attached to it.</li>
              <li>• <span className="text-text-main">Dungeon Mind only</span> — just a Dungeon Mind config, no story.</li>
            </ul>
            <p className="p-2.5 rounded-lg bg-accent/5 border border-accent/20"><span className="text-text-main font-bold">What's a Dungeon Mind?</span> It's a separate game-mechanics agent on ISK0 — it handles dice rolls, stat tracking, inventory, skills and rule enforcement so the story AI can focus on telling the story. You build its rules here (stat schema, game rules, a player guide, etc.), <span className="text-text-main">Export DM Config</span>, then paste each field into ISK0's <span className="text-text-main">Dungeon Minds</span> editor and attach it to a storyline.</p>
          </section>

          <section className="space-y-2">
            <H>The rhythm: set, then Sync</H>
            <p>Each step has its own <span className="text-text-main">on-screen controls</span> — pickers, sliders, toggles, text fields (mode, setting, palette, art style, grounding rules, and so on). The collaborator chat on the right doesn't see those changes <span className="italic">as you make them</span>. That's deliberate: it lets you tinker freely without the AI reacting to every half-made choice.</p>
            <p>So the rhythm for every step is simple:</p>
            <ol className="space-y-1.5 pl-1 list-decimal list-inside marker:text-accent">
              <li>Make <span className="text-text-main">all</span> your choices on the current step — pick the palette, the setting, whatever that step offers.</li>
              <li>Hit <span className="text-text-main">Sync ↺</span> (above the chat) to hand those choices to the collaborator in one go.</li>
              <li>Now chat, refine, or advance — the AI is working from exactly what you set.</li>
            </ol>
            <p className="mt-1.5 p-2.5 rounded-lg bg-[#fbbf24]/10 border border-[#fbbf24]/25 text-[#fde68a]">💡 Watch the little status dot above the chat: it glows <span className="font-bold text-[#fbbf24]">amber — "Settings Changed"</span> when you have edits the AI hasn't seen yet, and <span className="font-bold text-[#10b981]">green — "Synced"</span> once it's caught up. <span className="font-bold">Amber = hit Sync.</span> Syncing after you've finished a page (not mid-way) keeps the collaborator from guessing or asking about things you've already decided.</p>
          </section>

          <section className="space-y-2">
            <H>Choosing a model (the engine)</H>
            <p>The AI work is done by a language model. You pick which one in <span className="text-text-main">Settings</span> (the ⚙ icon, top-right). There are five options:</p>
            <ul className="space-y-1.5 pl-1">
              <li>• <span className="text-text-main">Google Gemini</span> — has a genuinely free tier. Good starting point.</li>
              <li>• <span className="text-text-main">Anthropic Claude</span> — high quality, but paid only.</li>
              <li>• <span className="text-text-main">Mistral AI</span> — has a free tier, and <span className="text-text-main">Mistral Medium 3.5</span> is a strong all-rounder for this kind of work (good creative writing + tidy formatting). A great pick alongside Gemini.</li>
              <li>• <span className="text-text-main">OpenRouter</span> — one key unlocks GPT, Claude, Gemini, Grok, Llama and more, including free models.</li>
              <li>• <span className="text-text-main">Local Ollama</span> — runs models on your own machine, fully free and offline.</li>
            </ul>
            <p>For the four cloud options you need an <span className="text-text-main">API key</span> — a password-like string that lets this app use your account. You paste it into Settings; it stays on your machine and is sent only to your chosen provider.</p>
            <p className="text-[11px] text-text-dim"><span className="text-text-main">Which model?</span> If a provider offers several, the app pre-selects a sensible default and you can switch in Settings → Target_Model. For most stories a mid-tier model (e.g. <span className="text-text-main">Mistral Medium 3.5</span>, <span className="text-text-main">Gemini 2.5 Flash</span>) hits the sweet spot of quality, speed and cost; reach for a flagship (Claude, Mistral Large, GPT-4o) only if you want the richest prose and don't mind paying.</p>
          </section>

          <section className="space-y-2">
            <H>Getting an API key</H>
            <div className="p-3 rounded-xl border border-border bg-bg/50 space-y-1">
              <p className="text-text-main font-bold">Google Gemini (free tier)</p>
              <p>Go to <Link href="https://aistudio.google.com/apikey">aistudio.google.com/apikey</Link>, sign in with a Google account, click <span className="text-text-main">Create API key</span>. Copy the key (starts with <code className="bg-black/30 px-1 rounded text-[11px]">AIza…</code>) into Settings → Gemini.</p>
            </div>
            <div className="p-3 rounded-xl border border-border bg-bg/50 space-y-1">
              <p className="text-text-main font-bold">Anthropic Claude (paid)</p>
              <p>Go to <Link href="https://console.anthropic.com/settings/keys">console.anthropic.com</Link>, create an account, add a little credit (about $5 minimum), then create a key (starts with <code className="bg-black/30 px-1 rounded text-[11px]">sk-ant-…</code>). Without credit, Claude returns errors.</p>
            </div>
            <div className="p-3 rounded-xl border border-border bg-bg/50 space-y-1">
              <p className="text-text-main font-bold">Mistral AI (free tier)</p>
              <p>Go to <Link href="https://console.mistral.ai/api-keys">console.mistral.ai/api-keys</Link>, create an account, and on the free <span className="text-text-main">Experiment</span> plan (you may need to verify a phone number) click <span className="text-text-main">Create new key</span>. Copy it (a plain random string, no special prefix) into Settings → Mistral. The default <code className="bg-black/30 px-1 rounded text-[11px]">mistral-medium-latest</code> works well here; the free tier is rate-limited but costs nothing.</p>
            </div>
            <div className="p-3 rounded-xl border border-border bg-bg/50 space-y-1">
              <p className="text-text-main font-bold">OpenRouter (one key, many models)</p>
              <p>Go to <Link href="https://openrouter.ai/keys">openrouter.ai/keys</Link>, sign in, create a key (starts with <code className="bg-black/30 px-1 rounded text-[11px]">sk-or-v1-…</code>). Models tagged <span className="text-[#10b981] font-bold">:free</span> cost nothing (they're rate-limited); paid models work too if you add credit. Tip: use the ⭐ to favourite the models you like so you don't scroll the 300+ list.</p>
              <p className="mt-1.5 p-2 rounded-lg bg-[#10b981]/10 border border-[#10b981]/25 text-[#a7f3d0]">💡 <span className="font-bold">Hidden perk:</span> a <span className="font-bold">one-time</span> $10 of credit raises your <span className="font-bold">free</span> daily allowance from ~50 to ~1,000 requests/day — and it stays raised <span className="italic">permanently</span>, even if your balance later runs down to $0. You still pay nothing for <span className="text-[#10b981] font-bold">:free</span> models; the credit just unlocks the bigger free quota and makes them far less likely to bounce you with a rate-limit. Great if you keep hitting "out of free allocation."</p>
            </div>
            <p className="text-[11px] text-text-dim">A key is like a password to your own account — don't share it. If one leaks, delete it on the provider's site and make a new one.</p>
          </section>

          <section className="space-y-2">
            <H>Running local models (Ollama)</H>
            <p className="p-2.5 rounded-lg bg-[#f87171]/10 border border-[#f87171]/30 text-[#fecaca]">⚠️ <span className="font-bold">Important — this does NOT work on the website.</span> If you're reading this on the hosted site (a public web address), the <span className="text-text-main">Local Ollama</span> option can't reach a model on your computer — the website's server lives somewhere else entirely. Local models only work when you <span className="font-bold">run Aether_Core on your own machine</span> (self-hosting). If you just want to start now with no setup, pick <span className="text-text-main">Google Gemini</span> or a <span className="text-[#10b981] font-bold">:free</span> OpenRouter model instead — those work right here in the browser.</p>
            <p>To use local models you self-host the app, then run Ollama next to it. It's free, private, and offline — but it's a developer-ish setup. Roughly:</p>
            <ol className="space-y-1.5 pl-1 list-decimal list-inside marker:text-accent">
              <li>Get the code: download or clone it from <Link href="https://github.com/wlkosonen/ISK02">GitHub</Link> (the green <span className="text-text-main">Code</span> button → <span className="text-text-main">Download ZIP</span>, or <code className="bg-black/30 px-1 rounded text-[11px]">git clone</code>).</li>
              <li>Install <Link href="https://www.docker.com/products/docker-desktop/">Docker Desktop</Link>, then in the project folder run <code className="bg-black/30 px-1 rounded text-[11px]">docker compose up --build</code>. Open <code className="bg-black/30 px-1 rounded text-[11px]">http://localhost:3010</code> — that's your own copy.</li>
              <li>Install <Link href="https://ollama.com">Ollama</Link> and pull a model: <code className="bg-black/30 px-1 rounded text-[11px]">ollama pull llama3</code>. Start it so the container can reach it: <code className="bg-black/30 px-1 rounded text-[11px]">OLLAMA_HOST=0.0.0.0 ollama serve</code>.</li>
              <li>In <span className="text-text-main">your local copy's</span> Settings, choose <span className="text-text-main">Local Ollama</span> (base URL preset to <code className="bg-black/30 px-1 rounded text-[11px]">http://host.docker.internal:11434</code>) — it auto-detects installed models.</li>
            </ol>
            <p className="text-[11px] text-text-dim">Full self-host notes are in the GitHub <Link href="https://github.com/wlkosonen/ISK02#run-with-docker-recommended-for-self-hosting--local-models">README</Link>. Local models are smaller than the big cloud ones, so output quality varies — but it's free and stays on your machine.</p>
            <p className="p-2.5 rounded-lg bg-[#fbbf24]/10 border border-[#fbbf24]/25 text-[#fde68a] text-[11px]">💡 <span className="font-bold">Tip for local models:</span> lower the <span className="text-text-main">Temperature</span> to around <span className="font-bold">0.6</span> (in Settings). Smaller models can ramble or break the <span className="text-text-main">capture formatting</span> at the default 1.0, which stops finished blocks from saving. Reasoning models (qwen3, deepseek-r1…) are handled automatically — the app tells them to answer directly.</p>
          </section>

          <section className="space-y-2">
            <H>Handy to know</H>
            <ul className="space-y-1.5 pl-1">
              <li>• <span className="text-text-main">⭐ Favourites</span> — star models in Settings to pin them at the top.</li>
              <li>• <span className="text-text-main">Token Budget</span> (Concept step) — tell the AI how big the final package should be; the gauge in the left panel tracks it.</li>
              <li>• <span className="text-text-main">LOCK IN</span> — when the AI marks a step complete, the top-right button pulses; click it (or the chat banner) to advance when you're ready.</li>
              <li>• <span className="text-text-main">Snapshot</span> saves a readable .txt backup (chat included); <span className="text-text-main">Export_Core</span> saves just the clean deliverables.</li>
              <li>• <span className="text-text-main">Save / Load Workspace</span> — a portable <code className="bg-black/30 px-1 rounded text-[11px]">.aether.json</code> file of your <em>entire</em> project (settings, deliverables &amp; chat). Reload it later or on another machine to pick up exactly where you left off. Your API keys are never written into the file — you supply them wherever you load it.</li>
            </ul>
          </section>

          <section className="space-y-2">
            <H>Credits &amp; feedback</H>
            <p>This workshop runs on <span className="text-text-main">USCS v6.1</span> — a community effort from the Isekai Zero community, released into the public domain (CC0). Huge thanks to everyone who built it.</p>
            <p>App put together by <span className="text-accent font-bold">@Shegs</span> — find me in the <Link href="https://discord.com/servers/isekai-zero-1415040517594550282">ISK0 Discord</Link> for feedback and ideas. 💬</p>
            <p>Source code is open on <Link href="https://github.com/wlkosonen/ISK02">GitHub</Link> — fork it, self-host it, or open an issue. 🛠️</p>
          </section>
        </div>

        <div className="px-8 py-4 border-t border-border shrink-0 flex justify-end">
          <button onClick={onClose} className="px-8 py-2.5 bg-accent text-black rounded-lg text-xs font-black uppercase tracking-[0.2em] hover:bg-white transition-all">Got it</button>
        </div>
      </motion.div>
    </div>
  );
}

// Tiny copy-to-clipboard control with a brief "copied" confirmation. Used to
// grab an individual deliverable (raw text or HTML) mid-session without running
// a full package export. `variant="icon"` is the compact Token-Summary form;
// `variant="button"` is the labelled form used in preview panels.
function CopyButton({ text, label = "Copy", title, variant = "icon" }: { text: string; label?: string; title?: string; variant?: "icon" | "button" }) {
  const [copied, setCopied] = useState(false);
  const doCopy = async () => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Fallback for non-secure contexts / older browsers
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); } catch { /* give up silently */ }
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };
  if (variant === "button") {
    return (
      <button
        onClick={doCopy}
        title={title || "Copy to clipboard"}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-border bg-bg hover:border-accent text-[10px] font-black uppercase tracking-widest text-text-muted hover:text-accent transition-all active:scale-95"
      >
        {copied ? <Check className="w-3 h-3 text-[#10b981]" /> : <Copy className="w-3 h-3" />}
        {copied ? "Copied" : label}
      </button>
    );
  }
  return (
    <button
      onClick={doCopy}
      title={title || "Copy this block to clipboard"}
      className="shrink-0 p-0.5 rounded text-text-dim hover:text-accent transition-colors"
    >
      {copied ? <Check className="w-3 h-3 text-[#10b981]" /> : <Copy className="w-3 h-3" />}
    </button>
  );
}

function StatusMonitor({ state, onTighten }: { state: StoryState; onTighten?: (p: string) => void }) {
  // Counts ONLY the captured §21.1 package blocks (Prompt Plot + Guidelines +
  // Reminders + Player Persona + each character's AI description) — not workshop
  // chatter or non-counting HTML/image blocks. ~4 chars/token estimate.
  const estTokens = countingPackageTokens(state.deliverables);
  const fmtK = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k` : `${n}`);
  const overBudget = estTokens > state.tokenBudgetMax;
  const inRange = estTokens >= state.tokenBudgetMin && estTokens <= state.tokenBudgetMax;
  const pctOfMax = Math.min(100, state.tokenBudgetMax > 0 ? (estTokens / state.tokenBudgetMax) * 100 : 0);
  const barColor = overBudget ? "#f43f5e" : inRange ? "#14b8a6" : "#64748b";

  // Which sections to show for the current track: the story package, the DM config,
  // or both. The DM config has its own caps and is NOT part of the 20k story ceiling.
  const showStory = state.workshopTrack !== "dm-only";
  const showDM = state.workshopTrack !== "story";

  const fmtN = (n: number) => n.toLocaleString();
  // One token row. cap=null → no cap shown/flagged. opts.type enables a
  // "Tighten to cap" action (re-emits that block compressed) when over.
  // One token row. `cap` = the EFFECTIVE limit for this block (the creator's
  // custom limit if set, else the §21 default; null = uncapped, e.g. first
  // messages). Over the limit → red "over cap" + a Tighten action.
  const tokRow = (key: string, label: string, content: string, cap: number | null, opts?: { sub?: string; type?: string; name?: string }) => {
    const t = content ? estimateTokens(content) : 0;
    const over = !!(cap && t > cap);
    return (
      <div key={key}>
        <div className="flex items-center justify-between py-1">
          <span className="flex items-center gap-2 min-w-0">
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${content ? "bg-[#10b981]" : "bg-text-dim/40"}`} />
            <span className={`truncate ${content ? "text-text-main" : "text-text-muted"}`}>{label}</span>
            {opts?.sub && <span className="text-[8px] text-text-dim uppercase tracking-wide shrink-0">{opts.sub}</span>}
            {over && <span className="text-[8px] text-[#f43f5e] font-black uppercase shrink-0">over cap</span>}
          </span>
          <span className="flex items-center gap-1.5 shrink-0">
            <span className={`font-mono ${over ? "text-[#f43f5e] font-bold" : content ? "text-text-main" : "text-text-dim"}`}>
              {content ? `${fmtN(t)}${cap ? ` / ${fmtN(cap)}` : ""}` : "—"}
            </span>
            {content && <CopyButton text={content} title={`Copy ${label} to clipboard`} />}
          </span>
        </div>
        {over && onTighten && opts?.type && (
          <button
            onClick={() => onTighten(`[WORKSHOP ACTION — TIGHTEN TO CAP] "${label}" is over its §21 cap (~${fmtN(t)} tokens vs the ${fmtN(cap!)} limit). Compress it to AT OR UNDER ${fmtN(cap!)} tokens without losing essential meaning — cut redundancy and filler, tighten the prose, drop the lowest-value detail, but keep every required section. Re-emit the FULL tightened block wrapped in <<<USCS_BLOCK ${opts.name ? `${opts.type}: ${opts.name}` : opts.type}>>> … <<<END USCS_BLOCK>>>; keep only a one-line note in chat.`)}
            className="w-full mb-1.5 py-1 rounded bg-[#fbbf24]/10 border border-[#fbbf24]/30 text-[#fbbf24] text-[9px] font-black uppercase tracking-widest hover:bg-[#fbbf24]/20 transition-colors animate-pulse"
          >
            ⚠ Tighten to {fmtN(cap!)} →
          </button>
        )}
      </div>
    );
  };

  // A Dungeon Mind config row. cap = { max, unit } where unit is "tok" or "chars";
  // null = no cap shown. No tighten action (DM fields aren't story-package blocks).
  const dmRow = (key: string, label: string, content: string, cap: { max: number; unit: "tok" | "chars" } | null) => {
    const used = !content ? 0 : (cap?.unit === "chars" ? content.length : estimateTokens(content));
    const over = !!(cap && used > cap.max);
    return (
      <div key={key} className="flex items-center justify-between py-1">
        <span className="flex items-center gap-2 min-w-0">
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${content ? "bg-[#10b981]" : "bg-text-dim/40"}`} />
          <span className={`truncate ${content ? "text-text-main" : "text-text-muted"}`}>{label}</span>
          {over && <span className="text-[8px] text-[#f43f5e] font-black uppercase shrink-0">over cap</span>}
        </span>
        <span className="flex items-center gap-1.5 shrink-0">
          <span className={`font-mono ${over ? "text-[#f43f5e] font-bold" : content ? "text-text-main" : "text-text-dim"}`}>
            {content ? `${fmtN(used)}${cap ? ` / ${fmtN(cap.max)}${cap.unit === "chars" ? " ch" : ""}` : ""}` : "—"}
          </span>
          {content && <CopyButton text={content} title={`Copy ${label} to clipboard`} />}
        </span>
      </div>
    );
  };

  const dm = state.deliverables.dmConfig;

  return (
    <div className="space-y-3 text-[11px]">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Zap className="w-3.5 h-3.5 text-accent" />
        <span className="text-[11px] font-black uppercase tracking-wider text-accent">{showStory ? "Token Summary" : "Dungeon Mind Config"}</span>
      </div>

      {/* Budget gauge — story package only (the DM config isn't part of the 20k ceiling) */}
      {showStory && (
        <div className="h-1.5 w-full bg-border rounded-full overflow-hidden" title="Counts toward the 20k platform ceiling. ~4 chars/token estimate.">
          <div className="h-full transition-all duration-700 ease-out" style={{ width: `${pctOfMax}%`, backgroundColor: barColor }} />
        </div>
      )}

      <div className="max-h-[400px] overflow-y-auto custom-scrollbar pr-1 space-y-3">
       {showStory && <>
        {/* AI instruction blocks */}
        <div className="space-y-0.5">
          {tokRow("pp", "Prompt Plot", state.deliverables.promptPlot, state.customLimits.promptPlot ?? SECTION_CAPS.promptPlot, { type: "PROMPT_PLOT" })}
          {tokRow("gl", "Guidelines", state.deliverables.guidelines, state.customLimits.guidelines ?? SECTION_CAPS.guidelines, { type: "GUIDELINES" })}
          {tokRow("rm", "Reminders", state.deliverables.reminders, state.customLimits.reminders ?? SECTION_CAPS.reminders, { type: "REMINDERS" })}
        </div>

        {/* Characters — player persona + cast, the way ISK0 counts them */}
        <div className="space-y-0.5">
          <p className="text-[9px] font-black uppercase tracking-widest text-accent/70 mb-0.5">Characters</p>
          {tokRow("persona", "Player Persona", state.deliverables.playerPersona, 500, { type: "PLAYER_PERSONA" })}
          {state.deliverables.characters.map((c) => tokRow(`c-${c.name}`, c.name, c.desc, state.customLimits.characters ?? SECTION_CAPS.characters, { sub: c.card ? "+card" : undefined, type: "CHAR_DESC", name: c.name }))}
          {state.deliverables.characters.length === 0 && <p className="text-[10px] text-text-dim italic py-0.5">No cast yet</p>}
        </div>

        {/* First Messages — count toward the cap on ISK0 */}
        <div className="space-y-0.5">
          <p className="text-[9px] font-black uppercase tracking-widest text-accent/70 mb-0.5">First Messages <span className="text-text-dim font-medium normal-case tracking-normal">(Scenarios)</span></p>
          {state.deliverables.firstMessages.length === 0
            ? <p className="text-[10px] text-text-dim italic py-0.5">None drafted yet</p>
            : state.deliverables.firstMessages.map((f) => tokRow(`fm-${f.label}`, `First Message ${f.label}`, f.content, null))}
        </div>

        {/* Estimated total */}
        <div className="flex items-center justify-between pt-2 border-t border-border/60">
          <span className="text-xs font-black uppercase tracking-wide text-text-main">Estimated Total</span>
          <span className="font-mono text-xs font-black" style={{ color: barColor }}>{fmtN(estTokens)} <span className="text-text-muted font-normal text-[10px]">/ {fmtK(state.tokenBudgetMax)}</span></span>
        </div>
        {overBudget && (
          <div className="text-[10px] text-[#fbbf24] bg-[#fbbf24]/10 border border-[#fbbf24]/25 rounded-lg px-2.5 py-1.5 leading-snug">
            Over your {fmtK(state.tokenBudgetMax)} target. Hard platform ceiling is 20k — trim over-cap blocks.
          </div>
        )}

        {/* Captured but excluded from the budget (HTML / visual blocks) */}
        <p className="text-[9px] text-text-dim leading-relaxed">
          <span className="uppercase tracking-widest font-bold text-text-muted">Not counted:</span>{" "}
          {([["Title & Summary", state.deliverables.titleSummary], ["Plot Card", state.deliverables.plotCard], ["Scenarios", state.deliverables.scenarios], ["Image Prompts", state.deliverables.imagePrompts]] as [string, string][]).map(([l, v]) => `${v ? "✓" : "○"} ${l}`).join("  ·  ")}
        </p>
       </>}

       {showDM && (
        <div className={`space-y-0.5 ${showStory ? "pt-2 mt-1 border-t-2 border-accent/30" : ""}`}>
          <p className="text-[9px] font-black uppercase tracking-widest text-accent/70 mb-0.5">Dungeon Mind <span className="text-text-dim font-medium normal-case tracking-normal">(§27 — separate config)</span></p>
          {dmRow("dm-schema", "Stat Schema", dm.statSchema, null)}
          {dmRow("dm-rules", "Game Rules", dm.gameRules, { max: DM_CAPS.gameRules, unit: "tok" })}
          {dmRow("dm-reminder", "Rule Reminder", dm.gameRuleReminder, { max: DM_CAPS.gameRuleReminder, unit: "tok" })}
          {dmRow("dm-instruction", "Story-AI Instruction", dm.instruction, null)}
          {dmRow("dm-guide", "Player Guide", dm.playerGuide, { max: DM_CAPS.playerGuideChars, unit: "chars" })}
          <div className="flex items-center justify-between py-1">
            <span className="flex items-center gap-2 min-w-0">
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dm.name ? "bg-[#10b981]" : "bg-text-dim/40"}`} />
              <span className={`truncate ${dm.name ? "text-text-main" : "text-text-muted"}`}>Name &amp; Model</span>
            </span>
            <span className="font-mono shrink-0 text-text-dim text-[10px] truncate max-w-[55%] text-right">{dm.name ? `${dm.name}${dm.model ? ` · ${dm.model}` : ""}` : "—"}</span>
          </div>
        </div>
       )}
      </div>
    </div>
  );
}

function ChatInput({ onSend, isLoading, compact = false }: { onSend: (p: string) => void, isLoading: boolean, compact?: boolean }) {
  const [text, setText] = useState("");
  const handleSend = () => {
    if (text.trim() && !isLoading) {
      onSend(text);
      setText("");
    }
  };

  return (
    <div className="relative group">
      <textarea 
        placeholder="Discuss architecture..."
        rows={compact ? 2 : 3}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSend();
          }
        }}
        className="w-full bg-bg border border-border rounded-xl px-4 py-4 focus:border-accent focus:outline-none transition-all placeholder:text-text-dim resize-none shadow-inner leading-relaxed text-xs"
      />
      <div className="absolute right-3 bottom-3 flex items-center gap-2">
        <span className="text-[8px] font-mono text-text-dim opacity-50 hidden sm:inline">ENT_SEND</span>
        <button 
          onClick={handleSend}
          disabled={isLoading || !text.trim()}
          className={`p-2 rounded-lg transition-all ${
            isLoading || !text.trim() 
              ? "bg-border/20 text-text-dim cursor-not-allowed" 
              : "bg-accent/20 hover:bg-accent text-accent hover:text-black"
          }`}
        >
          <Zap className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}

function ChatScrollAnchor({ history, isLoading }: { history: any[], isLoading?: boolean }) {
  const anchorRef = useRef<HTMLDivElement>(null);
  // Sticky auto-scroll: only follow new content when the user is already parked
  // near the bottom. If they've scrolled up to read history, leave them there
  // instead of yanking them back down on every streamed token. During streaming
  // use "auto" (instant) so the follow doesn't fight a smooth animation each tick.
  useEffect(() => {
    const anchor = anchorRef.current;
    const scroller = anchor?.parentElement; // the flex-1 overflow-y-auto messages pane
    if (!anchor || !scroller) return;
    const distanceFromBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    if (distanceFromBottom < 120) {
      anchor.scrollIntoView({ behavior: isLoading ? "auto" : "smooth" });
    }
  }, [history, isLoading]);
  return <div ref={anchorRef} className="h-px w-full shrink-0" />;
}

// Live, sandboxed HTML card preview with a device-width toggle. Cards are FLUID
// (width:100%; max-width:600/720px) with percentage-column reflow, so the SAME
// HTML stacks differently on a phone vs desktop — pills wrap, columns collapse.
// That responsive drift is exactly what the USCS card rules guard against, and
// what previously could only be checked by pasting the HTML into a playroom.
// The toggle clamps the iframe width so a creator can sanity-check the reflow
// in-app at phone / tablet / full width. `sandbox=""` keeps scripts off.
function CardPreview({
  html, bg, title, height = 520, rounded = "rounded-3xl", shadow = true,
}: {
  html: string; bg: string; title: string; height?: number; rounded?: string; shadow?: boolean;
}) {
  const DEVICES = [
    { id: "phone" as const, label: "Phone", w: 390 as number | null },
    { id: "tablet" as const, label: "Tablet", w: 768 as number | null },
    { id: "full" as const, label: "Full", w: null as number | null },
  ];
  const [device, setDevice] = useState<"phone" | "tablet" | "full">("full");
  const w = DEVICES.find(d => d.id === device)!.w;
  // A content-derived key forces the iframe to REMOUNT when the HTML changes:
  // patching an already-rendered iframe's srcDoc attribute does not reliably
  // re-parse it, so a recolor / AI re-skin would otherwise leave the preview stale.
  const htmlKey = React.useMemo(() => {
    let h = 0;
    for (let i = 0; i < html.length; i++) h = (h * 31 + html.charCodeAt(i)) | 0;
    return h;
  }, [html]);
  // ISK0's renderer silently STRIPS single-side borders and box-shadows (the v0.10.4
  // accent-bar finding), so a weak model that ignored the prompt and used them will
  // look fine here but lose its section accents on the platform. Flag it so the
  // creator can ask for a re-skin using a full `border:2px solid` instead.
  const complianceWarnings = React.useMemo(() => {
    const w: string[] = [];
    if (/border-(?:left|right|top|bottom)\s*:/i.test(html)) w.push("a single-side border (border-left / -right / -top / -bottom)");
    if (/box-shadow\s*:/i.test(html)) w.push("a box-shadow");
    return w;
  }, [html]);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1">
        {DEVICES.map(d => (
          <button
            key={d.id}
            onClick={() => setDevice(d.id)}
            title={d.w ? `Preview at ${d.w}px wide` : "Fill the available width"}
            className={`px-2 py-1 rounded-md text-[8px] font-black uppercase tracking-widest border transition-all ${
              device === d.id
                ? "border-accent/50 bg-accent/15 text-accent"
                : "border-border text-text-dim hover:text-accent hover:border-accent/30"
            }`}
          >
            {d.label}{d.w ? ` · ${d.w}` : ""}
          </button>
        ))}
      </div>
      {complianceWarnings.length > 0 && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-[#fbbf24]/10 border border-[#fbbf24]/30 text-[#fbbf24]">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <p className="text-[10px] leading-relaxed">
            <span className="font-black uppercase tracking-wider">Won't render on ISK0:</span>{" "}
            this card uses {complianceWarnings.join(" and ")} — ISK0 strips these, so the section accents will vanish on the platform. Ask the collaborator to re-skin it using a full <span className="font-mono">border:2px solid #hex</span> instead.
          </p>
        </div>
      )}
      <div
        className={`w-full overflow-x-auto border border-border ${rounded} ${shadow ? "shadow-2xl" : ""}`}
        style={{ backgroundColor: bg }}
      >
        <iframe
          key={htmlKey}
          title={title}
          sandbox=""
          className="block mx-auto"
          style={{ width: w ? `${w}px` : "100%", height, backgroundColor: bg, border: "none" }}
          srcDoc={html}
        />
      </div>
    </div>
  );
}

function LockedStepsSummary({ state }: { state: StoryState }) {
  const rules = state.groundingRules || "";
  const lines = rules.split('\n').filter(l => l.trim().length > 0);
  const parsedRules: { protocol?: string; type: "DO_NOT" | "INSTEAD" | "OTHER"; text: string }[] = [];
  
  lines.forEach(line => {
    const protocolMatch = line.match(/^\[?(PROTOCOL_\d+|RULE_\d+|LAW_\d+)?\]?\s*(.*)$/i);
    const protocol = protocolMatch ? protocolMatch[1] : undefined;
    const bodyField = protocolMatch ? protocolMatch[2] : line;
    
    if (bodyField.toUpperCase().includes("DO NOT")) {
      parsedRules.push({
        protocol,
        type: "DO_NOT",
        text: bodyField.replace(/DO NOT/i, "").trim().replace(/^:\s*/, "")
      });
    } else if (bodyField.toUpperCase().includes("INSTEAD")) {
      parsedRules.push({
        protocol,
        type: "INSTEAD",
        text: bodyField.replace(/INSTEAD/i, "").trim().replace(/^:\s*/, "")
      });
    } else {
      parsedRules.push({
        protocol,
        type: "OTHER",
        text: bodyField.trim()
      });
    }
  });

  return (
    <div className="space-y-6">
      <div className="bg-header/40 border border-border/60 p-6 rounded-3xl space-y-4 shadow-xl">
        <div className="flex items-center justify-between border-b border-border/40 pb-4">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-accent animate-pulse" />
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-accent">Aether_Integration_Matrix</span>
          </div>
          <span className="inline-flex items-center gap-1 text-[8px] font-mono font-bold uppercase text-[#10b981] bg-[#10b981]/10 px-2.5 py-1 rounded-full border border-[#10b981]/20">
            <span className="w-1.5 h-1.5 rounded-full bg-[#10b981] animate-pulse" />
            Integrity_Calibrated
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Bento Cell 1: Project Identity */}
          <div className="p-4 rounded-2xl bg-white/[0.01] border border-border/40 flex flex-col justify-between hover:border-accent/10 transition-colors">
            <div className="space-y-1">
              <span className="text-[8px] font-mono font-black text-text-dim uppercase tracking-widest block">Primary_Stamp</span>
              <h4 className="text-sm font-black uppercase tracking-tight text-text-main truncate" title={state.title || "Untitled Project"}>
                {state.title || "Untitled Project"}
              </h4>
            </div>
            <div className="flex gap-1.5 mt-3 flex-wrap">
              <span className="text-[7px] font-bold bg-accent/10 border border-accent/20 text-accent px-1.5 py-0.5 rounded uppercase font-mono">
                {state.settingType || "No Setting"}
              </span>
              <span className="text-[7px] font-bold bg-white/5 border border-white/5 text-text-muted px-1.5 py-0.5 rounded uppercase font-mono truncate max-w-[120px]">
                {state.tone || "Neutral"}
              </span>
            </div>
          </div>

          {/* Bento Cell 2: Compliance Calibration */}
          <div className="p-4 rounded-2xl bg-white/[0.01] border border-border/40 flex flex-col justify-between hover:border-accent/10 transition-colors">
            <div className="space-y-1">
              <span className="text-[8px] font-mono font-black text-text-dim uppercase tracking-widest block">Compliance_Mode</span>
              <div className="flex items-center gap-1.5 mt-1">
                <span className={`text-[8px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded ${
                  state.mode === 'NSFW' 
                    ? 'bg-red-500/10 text-red-400 border border-red-500/20' 
                    : 'bg-accent/10 text-accent border border-accent/20'
                }`}>
                  {state.mode || "PENDING"}
                </span>
                {state.mode === 'NSFW' && (
                  <span className="text-[8px] font-mono font-bold text-red-400">
                    HL::{state.heatLevel}/5
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1 h-3 mt-3">
              {state.palette && state.palette.map((c, i) => (
                <div key={i} className="flex-1 h-full rounded border border-white/5" style={{ backgroundColor: c }} title={c} />
              ))}
            </div>
          </div>

          {/* Bento Cell 3: Persona Roster */}
          <div className="p-4 rounded-2xl bg-white/[0.01] border border-border/40 flex flex-col justify-between hover:border-accent/10 transition-colors">
            <div className="space-y-1">
              <span className="text-[8px] font-mono font-black text-text-dim uppercase tracking-widest block">Persona_Registry</span>
              <div className="text-xs text-text-main font-bold mt-1 max-h-[48px] overflow-hidden">
                {state.deliverables.characters.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {state.deliverables.characters.slice(0, 3).map((char, idx) => (
                      <span key={idx} className="text-[7px] font-mono bg-white/5 px-1 py-0.5 rounded border border-white/5 uppercase truncate max-w-[70px]">
                        {char.name}
                      </span>
                    ))}
                    {state.deliverables.characters.length > 3 && (
                      <span className="text-[7px] font-mono bg-white/5 px-1 py-0.5 rounded text-accent">+{state.deliverables.characters.length - 3}</span>
                    )}
                  </div>
                ) : (
                  <span className="text-[8px] font-mono text-text-dim uppercase tracking-widest pt-0.5 block">No cast registered yet</span>
                )}
              </div>
            </div>
            <span className="text-[7px] font-mono font-semibold text-text-muted mt-2 tracking-tight block">
              Total index Cast: {state.deliverables.characters.length} registered
            </span>
          </div>
        </div>

        {/* Premise & Grounding Cell */}
        {(state.concept || parsedRules.length > 0) && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
            {state.concept && (
              <div className="p-4 rounded-xl bg-bg/20 border border-border/40 space-y-2">
                <span className="text-[8px] font-mono font-black text-text-dim uppercase tracking-widest block">Ingested_Concept_Matrix</span>
                <p className="text-[10px] leading-relaxed text-text-muted line-clamp-2 italic">
                  "{state.concept}"
                </p>
              </div>
            )}
            {parsedRules.length > 0 && (
              <div className="p-4 rounded-xl bg-bg/20 border border-border/40 space-y-2">
                <span className="text-[8px] font-mono font-black text-text-dim uppercase tracking-widest block">Active_Grounding_Rulesets</span>
                <div className="space-y-1">
                  {parsedRules.slice(0, 2).map((rule, idx) => (
                    <div key={idx} className="flex gap-1.5 items-center text-[10px]">
                      <span className={`text-[6px] font-black px-1 rounded uppercase shrink-0 ${
                        rule.type === 'DO_NOT' ? 'bg-red-400/10 text-red-400' : 'bg-emerald-400/10 text-emerald-400'
                      }`}>
                        {rule.type}
                      </span>
                      <span className="text-text-muted font-mono truncate text-[9px]">{rule.text}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Renders one Dungeon Mind build step (USCS §27.4). Each "field step" pairs a
// short explainer with an Ask-to-draft button and a captured-output panel; the
// AI emits the field wrapped in a DM_* sentinel which the capture protocol stores
// into deliverables.dmConfig. Steps 0 (scope discussion) and 7 (final review) are
// special. onExportDM downloads the assembled config (Final Review).
function renderDMStep(
  dmStep: number,
  state: StoryState,
  setState: React.Dispatch<React.SetStateAction<StoryState>>,
  askAssistant: (p: string) => Promise<void>,
  onExportDM?: () => void,
) {
  const dm = state.deliverables.dmConfig;
  const loading = state.isAssistantLoading;

  // Shared shell: title, blurb, then children.
  const Shell = ({ icon, title, blurb, children }: { icon: React.ReactNode; title: string; blurb: React.ReactNode; children: React.ReactNode }) => (
    <div className="space-y-8 py-12 max-w-3xl mx-auto">
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-accent">
          <span className="text-[10px] font-black uppercase tracking-[0.3em]">Dungeon Mind · §27</span>
        </div>
        <h2 className="text-4xl font-black tracking-tighter uppercase flex items-center gap-3">{icon} {title}</h2>
        <p className="text-text-muted leading-relaxed text-sm">{blurb}</p>
      </div>
      {children}
    </div>
  );

  // A captured-field panel: shows the stored block (or an empty prompt), a copy
  // button, and an optional live cap meter.
  const FieldPanel = ({ value, empty, cap }: { value: string; empty: string; cap?: { used: number; max: number; unit: string } }) => (
    value ? (
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] font-black uppercase tracking-widest text-accent flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5" /> Captured</span>
          <div className="flex items-center gap-2.5">
            {cap && <span className={`text-[9px] font-mono uppercase tracking-widest ${cap.used > cap.max ? "text-[#f43f5e] font-bold" : "text-text-dim"}`}>{cap.used.toLocaleString()} / {cap.max.toLocaleString()} {cap.unit}{cap.used > cap.max ? " · over" : ""}</span>}
            <CopyButton variant="button" text={value} title="Copy this field to clipboard" />
          </div>
        </div>
        <pre className="text-[11px] font-mono leading-relaxed text-text-muted bg-header/20 border border-border rounded-2xl p-5 whitespace-pre-wrap max-h-[420px] overflow-y-auto custom-scrollbar">{value}</pre>
      </div>
    ) : (
      <div className="rounded-2xl border border-dashed border-border p-6 text-center text-[11px] font-mono uppercase tracking-widest text-text-dim">{empty}</div>
    )
  );

  const ActionButton = ({ label, prompt }: { label: string; prompt: string }) => (
    <button
      onClick={() => askAssistant(prompt)}
      disabled={loading}
      className="w-full py-3 rounded-xl bg-accent/10 hover:bg-accent/20 border border-accent/30 text-accent text-[11px] font-black uppercase tracking-widest transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
    >
      <Sparkles className="w-3.5 h-3.5" /> {label}
    </button>
  );

  switch (dmStep) {
    case 0: // Concept & Scope
      return (
        <Shell icon={<Cpu className="w-9 h-9 text-accent" />} title="DM Concept & Scope" blurb={<>A Dungeon Mind is a game-mechanics agent — it handles dice, stats, inventory, skills and rule enforcement so the story AI can focus on narrative. First we lock the scope: genre, which mechanics matter, how death works, the dice system, and the complexity level.</>}>
          <div className="rounded-2xl border border-border bg-card/40 p-5 space-y-2 text-[12px] text-text-muted leading-relaxed">
            <p className="text-[10px] font-black uppercase tracking-widest text-text-dim mb-1">We'll decide together:</p>
            <ul className="space-y-1.5 list-disc pl-5">
              <li>Genre of the story (drives the recommended stat schema)</li>
              <li>Essential mechanics — combat? skills? inventory? survival?</li>
              <li>Is death permanent or recoverable?</li>
              <li>Dice system — standard d20, or custom?</li>
              <li>Complexity — light (few stats), medium (standard RPG), or heavy (many systems)</li>
            </ul>
          </div>
          <ActionButton label="Plan the DM scope with AETHER" prompt="[WORKSHOP ACTION — DM CONCEPT & SCOPE] Let's scope the Dungeon Mind. Ask me concisely about: (1) the story's genre, (2) which mechanics are essential (combat? skills? inventory? survival?), (3) whether death is permanent or recoverable, (4) the dice system (standard d20 or custom), and (5) the complexity level (light/medium/heavy). Recommend a starting stat schema for my genre per USCS §27. Do NOT write the full rules yet — just help me lock the scope." />
        </Shell>
      );

    case 1: // Stat Schema
      return (
        <Shell icon={<Layout className="w-9 h-9 text-accent" />} title="Stat Schema" blurb={<>The stats every character will have. The DM's tools are generated from this list. Each stat is Numeric, Text, or Enum; the <code className="bg-black/30 px-1 rounded">Alive</code> enum is always present. Aim for 5–15 stats.</>}>
          <ActionButton label={dm.statSchema ? "Revise the stat schema" : "Draft the stat schema"} prompt="[WORKSHOP ACTION — DM STAT SCHEMA] Based on our scoped genre and mechanics, propose the full stat schema per USCS §27 Field 7. For each stat give: name, mode (Numeric / Text / Enum), and a one-line description of how it functions in rule resolution. The 'Alive' enum [alive] [dead] is mandatory and cannot be removed. Target 5–15 stats. Once I confirm, emit the finished schema wrapped in <<<USCS_BLOCK DM_STAT_SCHEMA>>> … <<<END USCS_BLOCK>>>." />
          <FieldPanel value={dm.statSchema} empty="No stat schema captured yet — draft it above." />
        </Shell>
      );

    case 2: // Game Rules
      return (
        <Shell icon={<BookOpen className="w-9 h-9 text-accent" />} title="Game Rules" blurb={<>The full ruleset the DM follows — resolution, combat, damage, healing, death, progression, inventory, skills. Written as direct instructions to the DM AI. Hard cap 10,000 tokens; target 3,000–6,000.</>}>
          <ActionButton label={dm.gameRules ? "Revise the Game Rules" : "Draft the Game Rules"} prompt="[WORKSHOP ACTION — DM GAME RULES] Write the complete Game Rules document per USCS §27 Field 3, in direct imperative voice addressed to the DM AI (precision over prose). Include every applicable required section: 1) Resolution System (d20 + modifier vs DC/AC, define DCs), 2) Combat (initiative, attack resolution, damage, crits, status interaction), 3) Character Stats & Their Roles (reference our schema stat names EXACTLY), 4) Damage & Healing, 5) Death Condition (exactly when Alive flips to false; permanence), 6) Progression (if applicable), 7) Inventory (if applicable), 8) Skill Checks (if applicable). Stay within 10,000 tokens (target 3,000–6,000). Emit wrapped in <<<USCS_BLOCK DM_GAME_RULES>>> … <<<END USCS_BLOCK>>>." />
          <FieldPanel value={dm.gameRules} empty="No Game Rules captured yet — draft them above." cap={{ used: estimateTokens(dm.gameRules), max: DM_CAPS.gameRules, unit: "tok" }} />
        </Shell>
      );

    case 3: // Game Rule Reminder
      return (
        <Shell icon={<ShieldAlert className="w-9 h-9 text-accent" />} title="Game Rule Reminder" blurb={<>The 3–5 most critical rules, appended to <em>every</em> DM call — the highest-priority layer that overrides Game Rules on conflict. Be ruthless; every word is a recurring cost. ~500 tokens.</>}>
          <ActionButton label={dm.gameRuleReminder ? "Revise the Reminder" : "Draft the Reminder"} prompt="[WORKSHOP ACTION — DM GAME RULE REMINDER] Extract the 3–5 most critical, easily-forgotten rules from the Game Rules — e.g. death permanence, HP can never exceed max, always show the full roll (Rolled 14 + 3 = 17 vs DC 15 — Success), any rule the DM is likely to soften under narrative pressure, plus required output format. Write them as compressed imperative bullets per USCS §27 Field 4. Keep under ~500 tokens. Emit wrapped in <<<USCS_BLOCK DM_REMINDER>>> … <<<END USCS_BLOCK>>>." />
          <FieldPanel value={dm.gameRuleReminder} empty="No Reminder captured yet — draft it above." cap={{ used: estimateTokens(dm.gameRuleReminder), max: DM_CAPS.gameRuleReminder, unit: "tok" }} />
        </Shell>
      );

    case 4: // Story-AI Instruction
      return (
        <Shell icon={<MessageSquare className="w-9 h-9 text-accent" />} title="Story-AI Instruction" blurb={<>The bridge that tells the <em>story</em> AI what the DM handles and exactly when to pause the narrative and let the DM resolve the outcome. Appears in the story agent's system prompt.</>}>
          <ActionButton label={dm.instruction ? "Revise the Instruction" : "Draft the Instruction"} prompt="[WORKSHOP ACTION — DM INSTRUCTION] Write the bridge Instruction per USCS §27 Field 5: tell the STORY AI that this story has a Dungeon Mind managing all game mechanics, what system it uses, and exactly when to pause the narrative and let the DM resolve (any action with a chance of failure, combat, or anything governed by the game rules), then continue from the DM's outcome. Emit wrapped in <<<USCS_BLOCK DM_INSTRUCTION>>> … <<<END USCS_BLOCK>>>." />
          <FieldPanel value={dm.instruction} empty="No Instruction captured yet — draft it above." />
        </Shell>
      );

    case 5: // Player Guide
      return (
        <Shell icon={<HelpCircle className="w-9 h-9 text-accent" />} title="Player Guide" blurb={<>A short, friendly guide shown to players in chat settings when the DM is enabled. The player's first intro to the mechanics. Markdown supported. Hard limit 1,000 characters.</>}>
          <ActionButton label={dm.playerGuide ? "Revise the Player Guide" : "Draft the Player Guide"} prompt="[WORKSHOP ACTION — DM PLAYER GUIDE] Write the friendly player-facing guide per USCS §27 Field 6: what system this DM uses (d20/custom), what the key stats govern, how rolls and combat work at a glance, and any must-know rules before starting. Keep it warm and brief. Markdown is supported. HARD LIMIT 1,000 characters. Emit wrapped in <<<USCS_BLOCK DM_PLAYER_GUIDE>>> … <<<END USCS_BLOCK>>>." />
          <FieldPanel value={dm.playerGuide} empty="No Player Guide captured yet — draft it above." cap={{ used: dm.playerGuide.length, max: DM_CAPS.playerGuideChars, unit: "chars" }} />
        </Shell>
      );

    case 6: // Name & Model
      return (
        <Shell icon={<Cpu className="w-9 h-9 text-accent" />} title="Name & Model" blurb={<>A descriptive config name (it appears in the DM picker), and the recommended ISK0 model players use by default. Complex rulesets need stronger models for accurate stat tracking.</>}>
          <ActionButton label={dm.name ? "Revise name & model" : "Propose name & model"} prompt="[WORKSHOP ACTION — DM NAME & MODEL] Propose a descriptive DM config name that references the story or ruleset, and recommend the appropriate ISK0 DM model for our ruleset's complexity per USCS §27 (Gemini 3 Flash Preview for simple/standard rulesets; Claude Sonnet 4.6 if budget allows for heavy rulesets; avoid DeepSeek v4 Flash for anything complex). Emit EXACTLY this single block: <<<USCS_BLOCK DM_NAME_MODEL>>>\nName: <the name> | Model: <the recommended model>\n<<<END USCS_BLOCK>>>" />
          {(dm.name || dm.model) ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="rounded-2xl border border-border bg-header/20 p-4 space-y-1">
                <span className="text-[9px] font-black uppercase tracking-widest text-text-dim">Config Name</span>
                <p className="text-sm font-mono text-text-main">{dm.name || "—"}</p>
              </div>
              <div className="rounded-2xl border border-border bg-header/20 p-4 space-y-1">
                <span className="text-[9px] font-black uppercase tracking-widest text-text-dim">Recommended Model</span>
                <p className="text-sm font-mono text-text-main">{dm.model || "—"}</p>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-border p-6 text-center text-[11px] font-mono uppercase tracking-widest text-text-dim">No name/model captured yet — propose them above.</div>
          )}
        </Shell>
      );

    case 7: { // Final Review
      const fields: { label: string; value: string }[] = [
        { label: "Name", value: dm.name },
        { label: "Recommended Model", value: dm.model },
        { label: "Stat Schema", value: dm.statSchema },
        { label: "Game Rules", value: dm.gameRules },
        { label: "Game Rule Reminder", value: dm.gameRuleReminder },
        { label: "Story-AI Instruction", value: dm.instruction },
        { label: "Player Guide", value: dm.playerGuide },
      ];
      const done = fields.filter(f => f.value.trim()).length;
      return (
        <Shell icon={<CheckCircle2 className="w-9 h-9 text-accent" />} title="DM Final Review" blurb={<>The complete Dungeon Mind config, ready to copy into ISK0's DM editor. {done} of {fields.length} fields filled.</>}>
          <div className="space-y-2">
            {fields.map(f => (
              <div key={f.label} className="flex items-center justify-between gap-2 rounded-xl border border-border bg-header/20 px-4 py-2.5">
                <span className="flex items-center gap-2 min-w-0">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${f.value.trim() ? "bg-[#10b981]" : "bg-text-dim/40"}`} />
                  <span className={`text-xs font-bold uppercase tracking-wide truncate ${f.value.trim() ? "text-text-main" : "text-text-dim"}`}>{f.label}</span>
                </span>
                {f.value.trim() ? <CopyButton text={f.value} title={`Copy ${f.label}`} /> : <span className="text-[9px] font-mono uppercase tracking-widest text-text-dim shrink-0">empty</span>}
              </div>
            ))}
          </div>
          <button
            onClick={onExportDM}
            disabled={done === 0}
            className="w-full py-3.5 rounded-xl bg-accent/15 hover:bg-accent/25 border border-accent/30 text-accent text-[11px] font-black uppercase tracking-widest transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            <Download className="w-4 h-4" /> Export DM Config (.txt)
          </button>
          <p className="text-[10px] text-text-dim leading-relaxed text-center">Paste each field into the matching slot in ISK0's Dungeon Mind editor (Creation tab → Dungeon Minds). The DM attaches to a storyline as Required or Optional.</p>
        </Shell>
      );
    }

    default:
      return <div className="py-12 text-center text-text-dim">Unknown DM step.</div>;
  }
}

// The story-dm final step: a coherence pass that checks the story package and the
// Dungeon Mind config line up (USCS §27.5), with an AI review trigger and both
// exports (they paste into two different ISK0 editors).
function renderCombinedReview(
  state: StoryState,
  _setState: React.Dispatch<React.SetStateAction<StoryState>>,
  askAssistant: (p: string) => Promise<void>,
  onExportDM?: () => void,
  onExportStory?: () => void,
) {
  const d = state.deliverables;
  const dm = d.dmConfig;
  const loading = state.isAssistantLoading;
  // Lightweight heuristics — the AI review does the real cross-check.
  const checks: { label: string; ok: boolean }[] = [
    { label: "Story package built (Prompt Plot + Guidelines)", ok: !!(d.promptPlot && d.guidelines) },
    { label: "DM config built (Stat Schema + Game Rules)", ok: !!(dm.statSchema && dm.gameRules) },
    { label: "Guidelines reference the Dungeon Mind", ok: /dungeon mind/i.test(d.guidelines) },
    { label: "Player Persona present", ok: !!d.playerPersona },
  ];
  return (
    <div className="space-y-8 py-12 max-w-3xl mx-auto">
      <div className="space-y-3">
        <span className="text-[10px] font-black uppercase tracking-[0.3em] text-accent">Final · Story + Dungeon Mind</span>
        <h2 className="text-4xl font-black tracking-tighter uppercase flex items-center gap-3"><CheckCircle2 className="w-9 h-9 text-accent" /> Story + DM Review</h2>
        <p className="text-text-muted leading-relaxed text-sm">A last coherence pass: confirm the story and the Dungeon Mind config line up (USCS §27.5) before you export them. They paste into two different ISK0 editors — the story into a storyline, the DM into the Dungeon Minds tab.</p>
      </div>

      <div className="space-y-2">
        {checks.map(c => (
          <div key={c.label} className="flex items-center gap-2.5 rounded-xl border border-border bg-header/20 px-4 py-2.5">
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${c.ok ? "bg-[#10b981]" : "bg-[#fbbf24]"}`} />
            <span className={`text-xs ${c.ok ? "text-text-main" : "text-text-muted"}`}>{c.label}</span>
            {c.ok && <CheckCircle2 className="w-3.5 h-3.5 text-[#10b981] ml-auto shrink-0" />}
          </div>
        ))}
      </div>

      <button
        onClick={() => {
          const d = state.deliverables;
          const dm = d.dmConfig;
          const section = (label: string, body?: string) => `--- ${label} ---\n${(body || "").trim() || "(none captured)"}`;
          const artifacts = [
            section("PROMPT PLOT (story)", d.promptPlot),
            section("GUIDELINES (story)", d.guidelines),
            section("REMINDERS (story)", d.reminders),
            section("PLAYER PERSONA (story)", d.playerPersona),
            section("SCENARIOS / MODULE TRIGGERS (story)", d.scenarios),
            section("DM STAT SCHEMA", dm.statSchema),
            section("DM GAME RULES", dm.gameRules),
            section("DM STORY-AI INSTRUCTION", dm.instruction),
          ].join("\n\n");
          askAssistant(`[WORKSHOP ACTION — STORY + DM COHERENCE REVIEW] We've built both the story package and the Dungeon Mind config. The ACTUAL captured artifacts are below — review the real text, do NOT assume content or ask me to paste anything.\n\n${artifacts}\n\nDo a final coherence pass per USCS §27.5 AGAINST THE ARTIFACTS ABOVE: (1) confirm the Guidelines contain a DUNGEON MIND ACTIVE rule and don't duplicate stat-tracking the DM owns; (2) confirm the Prompt Plot doesn't restate game mechanics the DM handles; (3) confirm any module/scenario triggers reference stat names that ACTUALLY EXIST in the DM Stat Schema above; (4) confirm the Player Persona notes which stats the player assigns. Quote the specific lines you are judging. List anything misaligned, and for each fix re-emit the affected block in its capture sentinel (story blocks use their normal sentinels; DM fields use DM_* sentinels). If everything lines up, say so clearly.`);
        }}
        disabled={loading}
        className="w-full py-3 rounded-xl bg-accent/10 hover:bg-accent/20 border border-accent/30 text-accent text-[11px] font-black uppercase tracking-widest transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
      >
        <Sparkles className="w-3.5 h-3.5" /> Run the coherence review
      </button>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <button
          onClick={onExportStory}
          className="py-3 rounded-xl bg-border/40 hover:bg-border/60 border border-border text-[11px] font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2"
        >
          <Download className="w-4 h-4" /> Export Story (.txt)
        </button>
        <button
          onClick={onExportDM}
          className="py-3 rounded-xl bg-accent/15 hover:bg-accent/25 border border-accent/30 text-accent text-[11px] font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2"
        >
          <Download className="w-4 h-4" /> Export DM Config (.txt)
        </button>
      </div>
    </div>
  );
}

// Renders a STORY step. `storyStep` is the index into STEPS (NOT state.step — on
// the story-dm track the two diverge because DM steps are interleaved), so the
// switch and all story-index logic key off storyStep.
function renderStep(storyStep: number, state: StoryState, setState: React.Dispatch<React.SetStateAction<StoryState>>, next: () => void, askAssistant: (p: string) => Promise<void>, setHoverHeatLevel?: (lvl: HeatLevel | null) => void, hoverHeatLevel?: HeatLevel | null, isSyncNeeded?: boolean, syncDeskstateToAI?: () => void, onExportDM?: () => void, triggerToast?: (m: string, t: "ai-to-ui" | "ui-to-ai" | "info") => void) {
  const HEAT_DESCRIPTIONS = {
    1: "Slow Burn / Tension Only",
    2: "Mild Intimacy / Suggestive",
    3: "Explicit Permitted",
    4: "Fully Explicit",
    5: "Maximum Intensity"
  };

  switch (storyStep) {
    case 0: // Mode Selection
      return (
        <div className="space-y-12 py-12">
          <div className="text-center space-y-4">
            <h2 className="text-4xl font-black tracking-tighter uppercase sm:text-5xl drop-shadow-2xl">Select Narrative Mode</h2>
            <p className="text-text-muted max-w-xl mx-auto text-sm font-medium">This decision governs the entire creative pipeline and platform compliance requirements.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <button
              onClick={() => setState(s => ({ ...s, mode: "SFW" }))}
              className={`group relative p-8 border rounded-2xl text-left transition-all hover:scale-[1.02] active:scale-[0.98] cursor-pointer ${
                state.mode === "SFW" ? "border-accent bg-accent/5 shadow-[0_0_30px_rgba(20,184,166,0.1)]" : "border-border bg-card hover:border-text-dim"
              }`}
            >
              <div className="flex justify-between items-start mb-10">
                <div className="p-4 bg-accent/10 rounded-xl group-hover:bg-accent/20 transition-colors">
                  <Shield className="w-8 h-8 text-accent" />
                </div>
                <div className="text-[10px] font-bold text-accent bg-accent/10 px-3 py-1 rounded border border-accent/20 uppercase tracking-[0.2em]">Safe for Work</div>
              </div>
              <h3 className="text-2xl font-bold mb-3 tracking-tight">MODE A — SFW</h3>
              <p className="text-text-muted text-sm leading-relaxed font-medium">No sexual content authored. Intimacy remains narrative. The story is a grounded human narrative suitable for general audiences.</p>
            </button>

            <button
              onClick={() => setState(s => ({ ...s, mode: "NSFW" }))}
              className={`group relative p-8 border rounded-2xl text-left transition-all hover:scale-[1.02] active:scale-[0.98] cursor-pointer ${
                state.mode === "NSFW" ? "border-red-500/50 bg-red-500/5 shadow-[0_0_30px_rgba(239,68,68,0.1)]" : "border-border bg-card hover:border-text-dim"
              }`}
            >
              <div className="flex justify-between items-start mb-10">
                <div className="p-4 bg-red-500/10 rounded-xl group-hover:bg-red-500/20 transition-colors">
                  <Heart className="w-8 h-8 text-red-400" />
                </div>
                <div className="text-[10px] font-bold text-red-400 bg-red-400/10 px-3 py-1 rounded border border-red-400/20 uppercase tracking-[0.2em]">18+ Creator Content</div>
              </div>
              <h3 className="text-2xl font-bold mb-3 tracking-tight">MODE B — NSFW</h3>
              <p className="text-text-muted text-sm leading-relaxed font-medium">Designed to accommodate explicit content at player direction. Requires assignment of a Heat Level and strict adherence to guidelines.</p>
            </button>
          </div>

          {state.mode === "NSFW" && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="mt-8 p-10 border border-red-500/20 bg-red-500/5 rounded-2xl space-y-8"
            >
              <div className="flex items-center gap-4 border-b border-red-500/10 pb-4">
                <AlertTriangle className="w-5 h-5 text-red-400" />
                <h4 className="text-sm font-bold uppercase tracking-[0.3em]">Thermal Calibration</h4>
              </div>
              
              <div className="grid grid-cols-5 gap-3">
                {[1, 2, 3, 4, 5].map((lvl) => (
                  <button
                    key={lvl}
                    onClick={() => setState(s => ({ ...s, heatLevel: lvl as HeatLevel }))}
                    onMouseEnter={() => setHoverHeatLevel?.(lvl as HeatLevel)}
                    onMouseLeave={() => setHoverHeatLevel?.(null)}
                    className={`h-16 rounded-lg font-black transition-all border font-mono flex items-center justify-center relative overflow-hidden ${
                      state.heatLevel === lvl 
                        ? "bg-red-600 border-red-400 text-white shadow-[0_0_20px_rgba(239,68,68,0.3)] scale-105" 
                        : "bg-bg border-border text-text-dim hover:bg-red-500/10 hover:border-red-500/30 hover:text-red-400"
                    }`}
                  >
                    {lvl}
                  </button>
                ))}
              </div>

              <div className="h-10 flex items-center justify-center">
                <AnimatePresence mode="wait">
                  <motion.p 
                    key={hoverHeatLevel || state.heatLevel}
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -5 }}
                    className={`text-xs font-black text-center uppercase tracking-[0.4em] ${hoverHeatLevel ? 'text-white' : 'text-red-400/80'}`}
                  >
                    {HEAT_DESCRIPTIONS[(hoverHeatLevel || state.heatLevel) as HeatLevel]}
                  </motion.p>
                </AnimatePresence>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2 opacity-40">
                {(Object.entries(HEAT_DESCRIPTIONS) as [string, string][]).map(([lvl, desc]) => (
                  <div key={lvl} className={`p-2 border rounded text-[8px] text-center font-bold tracking-widest ${state.heatLevel === parseInt(lvl) ? 'border-red-500/50 bg-red-500/10 text-red-400' : 'border-border'}`}>
                    {desc}
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          <div className="pt-12">
            <p className="text-center text-[10px] uppercase tracking-[0.3em] font-black text-label mb-1">Output Track</p>
            <p className="text-center text-xs text-text-muted mb-4">What is this workshop producing? (This is communicated to the collaborator.)</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 max-w-3xl mx-auto">
              {([
                ["story", "Full Story Package", "The standard pipeline — a complete deliverable set (plot card, character sheets, scenarios, prompt plot, guidelines, reminders) around a continuous protagonist."],
                ["story-dm", "Story + Dungeon Mind", "A full story package, then a Dungeon Mind config attached to it — a game-mechanics agent (dice, stats, inventory, rules) that runs alongside the narrative."],
                ["dm-only", "Dungeon Mind only", "Just a Dungeon Mind config — the game-mechanics engine (dice rolls, stat schema, game rules) you attach to an existing story. No plot or characters built here."],
              ] as [WorkshopTrack, string, string][]).map(([track, title, desc]) => (
                <button
                  key={track}
                  onClick={() => setState(s => ({ ...s, workshopTrack: track, step: 0 }))}
                  className={`text-left p-4 rounded-xl border transition-all ${
                    state.workshopTrack === track
                      ? "bg-accent/10 border-accent text-text-main shadow-[0_0_20px_rgba(20,184,166,0.2)]"
                      : "bg-card border-border text-text-muted hover:border-text-muted"
                  }`}
                >
                  <div className="font-mono text-[11px] font-bold tracking-[0.15em] uppercase mb-1.5">{title}</div>
                  <div className="text-[11px] leading-relaxed text-text-muted">{desc}</div>
                </button>
              ))}
            </div>
            <p className="text-center text-[10px] text-text-dim mt-3 max-w-xl mx-auto leading-relaxed">A Dungeon Mind is a separate game-mechanics agent on ISK0 — it handles dice, stat tracking, inventory and rule enforcement so the story AI focuses on narrative.</p>
          </div>
        </div>
      );

    case 1: // Concept Intake
      return (
        <div className="space-y-10 py-12">
          <div className="space-y-4">
            <h2 className="text-4xl font-black uppercase tracking-tighter">Concept_Ingest</h2>
            <p className="text-text-muted font-medium">Describe your scenario premise, emotional hooks, and core cast.</p>
          </div>

          <div className="space-y-6">
            <div className="relative group">
              <div className="absolute -top-3 left-6 px-3 bg-bg border-x border-border">
                <label className="text-[10px] uppercase tracking-[0.3em] font-black text-accent flex items-center gap-2">
                  <Terminal className="w-3 h-3" /> NARRATIVE_SEED
                </label>
              </div>
              <textarea 
                value={state.concept}
                onChange={(e) => setState(s => ({ ...s, concept: e.target.value }))}
                className="w-full h-80 bg-card border border-border rounded-2xl p-8 focus:border-accent focus:ring-1 focus:ring-accent transition-all resize-none font-serif text-xl leading-relaxed placeholder:text-text-dim/30 shadow-inner"
                placeholder="What is the story? Who are the players? What is the feeling of being in this world?"
              />
              <div className="absolute bottom-4 right-6 text-[9px] font-mono text-text-dim opacity-40 uppercase tracking-widest">
                BUFFER_STATUS: ACTIVE
              </div>
            </div>

            <div className="p-8 border border-accent/20 bg-accent/5 rounded-2xl flex gap-6 shadow-[0_4px_20px_rgba(0,0,0,0.2)]">
              <div className="w-12 h-12 rounded-full bg-accent/20 flex items-center justify-center shrink-0">
                <Sparkles className="w-6 h-6 text-accent" />
              </div>
              <div className="space-y-4 text-left flex-1">
                <div>
                  <p className="text-[10px] font-black text-accent uppercase tracking-[0.3em]">Architectural Note</p>
                  <p className="text-sm text-text-muted italic leading-relaxed">
                    "Focus on what the player feels when they set the phone down. Is it a quiet ache? Primal power? A sense of dread? This becomes the emotional mandate."
                  </p>
                </div>
                <div className="flex gap-2">
                  <button 
                    onClick={() => askAssistant("Can you help me refine this concept and suggest some emotional hooks?")}
                    className="px-4 py-2 bg-accent/10 border border-accent/20 text-accent rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-accent/20 transition-all"
                  >
                    Help me Refine
                  </button>
                  <button
                    onClick={() => askAssistant("Suggest 3 distinctive isekai twists for this concept.")}
                    className="px-4 py-2 bg-header border border-border text-text-muted rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-white/5 transition-all"
                  >
                    Suggest Twists
                  </button>
                </div>
              </div>
            </div>

            {/* Token Budget target (USCS §21) */}
            <div className="p-6 border border-border bg-card rounded-2xl space-y-5">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <p className="text-[10px] font-black text-accent uppercase tracking-[0.3em] flex items-center gap-2">
                    <Cpu className="w-3.5 h-3.5" /> Token Budget — Target Package Size
                  </p>
                  <p className="text-[11px] text-text-dim mt-1 leading-relaxed">
                    Aim for the finished <span className="text-text-muted">AI instruction package</span> (Prompt Plot + Guidelines + Reminders + Character AI descriptions). HTML cards & image prompts don't count toward this. Platform ceiling: 20k.
                  </p>
                </div>
                <span className="text-sm font-mono text-accent shrink-0 bg-accent/10 px-3 py-1.5 rounded-lg border border-accent/20">
                  {state.tokenBudgetMin / 1000}k–{state.tokenBudgetMax / 1000}k
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {BUDGET_PRESETS.map((p) => {
                  const active = state.tokenBudgetMin === p.min && state.tokenBudgetMax === p.max;
                  return (
                    <button
                      key={p.label}
                      onClick={() => setState(s => ({
                        ...s,
                        tokenBudgetMin: p.min,
                        tokenBudgetMax: p.max,
                        // The lowest tier auto-suggests Budget-Tier Mode ON (overridable below).
                        budgetTierMode: p.tier ? true : s.budgetTierMode
                      }))}
                      title={p.hint}
                      className={`p-3 rounded-xl border text-left transition-all ${
                        active
                          ? "border-accent bg-accent/10 text-accent shadow-[0_0_12px_rgba(20,184,166,0.1)]"
                          : "border-border bg-bg text-text-dim hover:text-text-muted hover:border-text-dim"
                      }`}
                    >
                      <span className="block text-xs font-black uppercase tracking-tight">{p.label}</span>
                      <span className="block text-[9px] font-mono opacity-70 mt-0.5">{p.min / 1000}–{p.max / 1000}k</span>
                    </button>
                  );
                })}
              </div>

              {/* Custom fine-tune sliders */}
              <div className="space-y-3 pt-1">
                <div className="flex items-center justify-between">
                  <label className="text-[9px] uppercase tracking-[0.2em] font-black text-label">Fine-tune (min)</label>
                  <span className="text-[10px] font-mono text-text-muted">{state.tokenBudgetMin / 1000}k</span>
                </div>
                <input
                  type="range" min={2000} max={19500} step={500}
                  value={state.tokenBudgetMin}
                  onChange={(e) => {
                    const v = parseInt(e.target.value);
                    setState(s => ({ ...s, tokenBudgetMin: Math.min(v, s.tokenBudgetMax - 500) }));
                  }}
                  className="w-full h-1 bg-border rounded-full appearance-none accent-accent cursor-pointer"
                />
                <div className="flex items-center justify-between">
                  <label className="text-[9px] uppercase tracking-[0.2em] font-black text-label">Fine-tune (max)</label>
                  <span className="text-[10px] font-mono text-text-muted">{state.tokenBudgetMax / 1000}k</span>
                </div>
                <input
                  type="range" min={2500} max={20000} step={500}
                  value={state.tokenBudgetMax}
                  onChange={(e) => {
                    const v = parseInt(e.target.value);
                    setState(s => ({ ...s, tokenBudgetMax: Math.max(v, s.tokenBudgetMin + 500) }));
                  }}
                  className="w-full h-1 bg-border rounded-full appearance-none accent-accent cursor-pointer"
                />
              </div>

              {/* Budget-Tier Mode toggle */}
              <button
                onClick={() => setState(s => ({ ...s, budgetTierMode: !s.budgetTierMode }))}
                className={`w-full p-3 rounded-xl border flex items-center justify-between gap-3 transition-all text-left ${
                  state.budgetTierMode
                    ? "border-[#fbbf24]/40 bg-[#fbbf24]/10"
                    : "border-border bg-bg hover:border-text-dim"
                }`}
              >
                <div className="min-w-0">
                  <span className={`block text-[11px] font-black uppercase tracking-wider ${state.budgetTierMode ? "text-[#fbbf24]" : "text-text-muted"}`}>
                    Budget-Tier Mode {state.budgetTierMode ? "· ON" : "· OFF"}
                  </span>
                  <span className="block text-[11px] text-text-dim mt-0.5 leading-snug">
                    USCS §21 optimizations for free models (DeepSeek/Ministral/GLM): state-based triggers, mandatory status block, worked examples, strict document separation.
                  </span>
                </div>
                <div className={`w-9 h-5 rounded-full shrink-0 relative transition-colors ${state.budgetTierMode ? "bg-[#fbbf24]" : "bg-border"}`}>
                  <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${state.budgetTierMode ? "left-[18px]" : "left-0.5"}`} />
                </div>
              </button>

              {/* Advanced — per-section custom limits (collapsed by default) */}
              <details className="pt-3 border-t border-border/40 group/cl">
                <summary className="cursor-pointer list-none flex items-center gap-1.5 text-[9px] uppercase tracking-[0.2em] font-black text-label hover:text-text-muted transition-colors">
                  <ChevronRight className="w-3 h-3 shrink-0 transition-transform group-open/cl:rotate-90" /> Advanced · custom section limits
                </summary>
                <div className="space-y-2 pt-2.5">
                  <p className="text-[11px] text-text-dim leading-snug">
                    Set your own token target per block (blank = the §21 default). The <span className="text-text-muted">Token Summary</span> tracks &amp; warns against these, and <span className="text-text-muted">Tighten</span> compresses to them. The 20k platform total still applies. For leaner guidelines, also flip <span className="text-text-muted">Compact mode</span> on the Guidelines step — that tells the AI <span className="italic">how</span> to trim, not just the target.
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {([
                      ["promptPlot", "Prompt Plot", 2500],
                      ["guidelines", "Guidelines", 3000],
                      ["reminders", "Reminders", 800],
                      ["characters", "Per character", 1500],
                    ] as [keyof StoryState["customLimits"], string, number][]).map(([key, label, dflt]) => (
                      <div key={key} className="p-2 rounded-lg border border-border bg-bg space-y-1">
                        <label className="block text-[9px] font-black uppercase tracking-tight text-text-muted">{label}</label>
                        <input
                          type="number" min={200} max={20000} step={100}
                          value={state.customLimits[key] ?? ""}
                          onChange={(e) => {
                            const raw = e.target.value;
                            if (raw === "") { setState(s => ({ ...s, customLimits: { ...s.customLimits, [key]: null } })); return; }
                            const n = parseInt(raw, 10);
                            if (Number.isNaN(n)) return;
                            // Only clamp the ceiling while typing — applying the 200 floor here
                            // would snap partial entries (e.g. "5") up to 200 and block free typing.
                            setState(s => ({ ...s, customLimits: { ...s.customLimits, [key]: Math.min(20000, n) } }));
                          }}
                          onBlur={(e) => {
                            const raw = e.target.value;
                            if (raw === "") return;
                            const n = parseInt(raw, 10);
                            const v = Number.isNaN(n) ? null : Math.min(20000, Math.max(200, n));
                            setState(s => ({ ...s, customLimits: { ...s.customLimits, [key]: v } }));
                          }}
                          placeholder={`${dflt}`}
                          className="w-full bg-card border border-border rounded px-2 py-1 text-[11px] font-mono text-text-main focus:border-accent focus:outline-none"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              </details>
            </div>
          </div>
        </div>
      );

    case 2: // Setting & Tone
      const isCustomSetting = !!state.settingType && !SETTING_TYPES.includes(state.settingType);
      return (
        <div className="space-y-10 py-12">
          <div className="text-center space-y-4">
            <h2 className="text-4xl font-black tracking-tighter uppercase drop-shadow-xl font-sans">World_Matrix</h2>
            <p className="text-text-muted max-w-xl mx-auto font-medium">Define the world rules and atmospheric register.</p>
          </div>

          {/* Custom setting — creativity first, top & centre */}
          <div className="max-w-2xl mx-auto w-full p-6 rounded-2xl border border-accent bg-accent/5 space-y-3 shadow-[0_0_24px_rgba(20,184,166,0.12)]">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-accent" />
              <h3 className="text-sm font-black uppercase tracking-[0.15em] text-accent">Describe your own setting</h3>
            </div>
            <p className="text-xs text-text-muted leading-relaxed">Something specific in mind? Write it here and shape it with the collaborator — the presets below are just starting points.</p>
            <input
              type="text"
              value={isCustomSetting ? state.settingType : ""}
              onChange={(e) => setState(s => ({ ...s, settingType: e.target.value }))}
              placeholder="e.g. A derelict generation ship whose crew worships the engine as a god…"
              className="w-full bg-card border border-border rounded-xl p-4 focus:border-accent focus:outline-none transition-all text-sm"
            />
            <button
              onClick={() => askAssistant(`[WORKSHOP ACTION — CUSTOM SETTING] I want a custom setting, not one of the presets: "${state.settingType}". Let's develop it together — help me sharpen it into a coherent, evocative setting (genre feel, what exists and what doesn't, the atmosphere); ask whatever you need, and when it's solid emit [SET_SETTING: <short setting name/phrase>] so it locks into my UI.`)}
              disabled={state.isAssistantLoading || !(isCustomSetting && state.settingType.trim())}
              className="w-full py-2.5 rounded-lg bg-accent text-black text-[10px] font-black uppercase tracking-widest hover:bg-white transition-all disabled:opacity-40"
            >
              Develop with collaborator →
            </button>
          </div>

          <h3 className="text-[10px] uppercase tracking-[0.3em] font-black text-label text-center">Or pick a setting type</h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {SETTING_TYPES.map((type) => (
              <button
                key={type}
                onClick={() => setState(s => ({ ...s, settingType: type }))}
                className={`p-5 rounded-xl border text-left transition-all group ${
                  state.settingType === type 
                    ? "border-accent bg-accent/10 text-white shadow-[0_0_20px_rgba(20,184,166,0.1)]" 
                    : "border-border bg-card text-text-dim hover:bg-header hover:border-accent/30 hover:text-text-muted"
                }`}
              >
                <div className={`text-[9px] uppercase font-bold tracking-[0.2em] mb-1 transition-colors ${state.settingType === type ? "text-accent" : "text-label"}`}>Classification</div>
                <div className="font-bold tracking-tight">{type}</div>
              </button>
            ))}
          </div>

          <div className="space-y-4 pt-10 border-t border-border/50">
            <div className="flex items-center gap-3">
              <Palette className="w-4 h-4 text-accent" />
              <label className="text-[10px] uppercase tracking-[0.3em] font-black text-label block">Emotional_Archetype</label>
            </div>
            <input 
              type="text"
              value={state.tone}
              onChange={(e) => setState(s => ({ ...s, tone: e.target.value }))}
              placeholder="e.g. Melancholy / Resonance, Dark Romance, Chaos / Expressive..."
              className="w-full bg-card border border-border rounded-xl p-5 focus:border-accent focus:outline-none transition-all font-mono text-sm tracking-tighter"
            />
          </div>
        </div>
      );

    case 3: // Art Style Profile
      const isCustomStyle = !!state.artStyle && !ART_STYLE_TEMPLATES.includes(state.artStyle) && state.artStyle !== DEFAULT_STATE.artStyle;
      return (
        <div className="space-y-10 py-12">
          <div className="space-y-4">
            <h2 className="text-4xl font-black uppercase tracking-tighter">Art_Style_Schema</h2>
            <p className="text-text-muted font-medium">Establish the visual identity for images and HTML cards.</p>
          </div>

          {/* Custom art style — describe your own, top & centre */}
          <div className="max-w-2xl mx-auto w-full p-6 rounded-2xl border border-accent bg-accent/5 space-y-3 shadow-[0_0_24px_rgba(20,184,166,0.12)]">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-accent" />
              <h3 className="text-sm font-black uppercase tracking-[0.15em] text-accent">Describe your own art style</h3>
            </div>
            <p className="text-xs text-text-muted leading-relaxed">Picture a specific look? Write it and refine it with the collaborator — the templates below are just examples.</p>
            <input
              type="text"
              value={isCustomStyle ? state.artStyle : ""}
              onChange={(e) => setState(s => ({ ...s, artStyle: e.target.value }))}
              placeholder="e.g. Muted watercolour with heavy ink outlines; weathered, painterly, melancholic…"
              className="w-full bg-card border border-border rounded-xl p-4 focus:border-accent focus:outline-none transition-all text-sm"
            />
            <button
              onClick={() => askAssistant(`[WORKSHOP ACTION — CUSTOM ART STYLE] I want a custom art style, not a template: "${state.artStyle}". Let's refine it into a precise Art Style Statement (medium, rendering quality, line/colour/lighting approach, mood, any influences); ask what you need, and when it's solid emit [SET_ART_STYLE: <short style name/phrase>] so it locks into my UI.`)}
              disabled={state.isAssistantLoading || !(isCustomStyle && state.artStyle.trim())}
              className="w-full py-2.5 rounded-lg bg-accent text-black text-[10px] font-black uppercase tracking-widest hover:bg-white transition-all disabled:opacity-40"
            >
              Develop with collaborator →
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
            <div className="space-y-6">
              <h3 className="text-[10px] uppercase tracking-[0.3em] font-black text-label flex items-center gap-2">
                <div className="w-2 h-[1px] bg-accent" /> Visual_Templates
              </h3>
              <div className="grid grid-cols-1 gap-3">
                {ART_STYLE_TEMPLATES.map((style) => (
                  <button
                    key={style}
                    onClick={() => setState(s => ({ ...s, artStyle: style }))}
                    className={`p-4 rounded-xl border text-sm text-left transition-all font-bold tracking-tight ${
                      state.artStyle === style 
                        ? "border-accent bg-accent/10 text-accent shadow-[0_0_15px_rgba(20,184,166,0.1)]" 
                        : "border-border bg-card text-text-dim hover:bg-header hover:border-text-muted"
                    }`}
                  >
                    {style}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-8">
              <div>
                <label className="text-[10px] uppercase tracking-[0.3em] font-black text-label mb-3 block">Neural_Engine</label>
                <div className="relative">
                  <select 
                    value={state.imageService}
                    onChange={(e) => setState(s => ({ ...s, imageService: e.target.value }))}
                    className="w-full bg-card border border-border rounded-xl p-4 focus:border-accent focus:outline-none text-xs font-black uppercase tracking-[0.2em] appearance-none"
                  >
                    {IMAGE_SERVICES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none opacity-40">
                    <ChevronRight className="w-4 h-4 rotate-90" />
                  </div>
                </div>
              </div>

              <div className="p-8 border border-border bg-card rounded-2xl space-y-6 shadow-xl relative overflow-hidden">
                <div className="absolute top-0 left-0 w-1 h-full bg-accent" />
                <div className="flex items-center gap-3 text-accent">
                  <Layout className="w-5 h-5" />
                  <span className="text-[10px] uppercase font-black tracking-[0.3em]">Aesthetic_Core</span>
                </div>
                <p className="text-xs text-text-muted leading-relaxed font-medium italic">
                  "Choosing a mode locks the structure rules for your Plot and Character cards. This dictates CSS constraints."
                </p>
                <div className="flex gap-2">
                  {(["Literary", "Structured", "Chaos"] as const).map(mode => (
                    <button 
                      key={mode} 
                      onClick={() => setState(s => ({ ...s, aestheticMode: mode }))}
                      className={`flex-1 py-3 rounded-lg border text-[9px] font-black uppercase tracking-[0.2em] transition-all hover:bg-accent/10 ${
                        state.aestheticMode === mode 
                          ? "bg-accent/20 border-accent text-accent shadow-[0_0_10px_rgba(20,184,166,0.2)]" 
                          : "bg-bg border-border text-text-muted hover:border-accent/40 hover:text-accent"
                      }`}
                    >
                      {mode}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      );

    case 4: // Palette & Identity
      // Curated palettes — order is [Background, Main Text, Accent 1, Accent 2, Contrast].
      // Every preset is contrast-checked: main-text vs background ≥ 13:1 (WCAG AAA),
      // and each accent stays visible against the background (≥ 2.9:1). See palette notes.
      const PALETTE_PRESETS: { name: string; vibe: string; colors: string[] }[] = [
        { name: "Classic Slate",   vibe: "Default · cool & balanced",   colors: ["#1a1a24", "#f8f8f8", "#14b8a6", "#f43f5e", "#fbbf24"] },
        { name: "Eldritch Void",   vibe: "Cosmic horror · arcane",      colors: ["#0d0a1a", "#ECE8FF", "#8b5cf6", "#d946ef", "#2dd4bf"] },
        { name: "Crimson Noir",    vibe: "Hard-boiled · bloody",        colors: ["#14100F", "#F5EDED", "#ef4444", "#b91c1c", "#f59e0b"] },
        { name: "Emerald Grove",   vibe: "Verdant · natural fantasy",   colors: ["#0B130E", "#EAF6EE", "#10b981", "#34d399", "#fbbf24"] },
        { name: "Ember Forge",     vibe: "Warm · industrial heat",      colors: ["#1a0f0a", "#FBEFE2", "#f97316", "#fbbf24", "#ef4444"] },
        { name: "Arctic Steel",    vibe: "Cold sci-fi · clinical",      colors: ["#0E1620", "#EAF2FA", "#38bdf8", "#22d3ee", "#94a3b8"] },
        { name: "Royal Amethyst",  vibe: "Regal · high magic",          colors: ["#15122B", "#ECEAFB", "#a855f7", "#818cf8", "#fbbf24"] },
        { name: "Sakura Dusk",     vibe: "Soft · romance & slice",      colors: ["#1C1320", "#FBEAF2", "#f472b6", "#fb7185", "#c084fc"] },
        { name: "Solar Flare",     vibe: "High energy · shonen",        colors: ["#100D08", "#FCF6E8", "#facc15", "#fb923c", "#ef4444"] },
        { name: "Oceanic Deep",    vibe: "Aquatic · deep blue",         colors: ["#08171C", "#E5F4F6", "#2dd4bf", "#60a5fa", "#22d3ee"] },
        { name: "Parchment Light", vibe: "Light · old manuscript",      colors: ["#F4ECD8", "#2A2118", "#B45309", "#0F766E", "#1E3A8A"] },
        { name: "Monochrome Ink",  vibe: "Light · minimal print",       colors: ["#F5F5F4", "#1C1917", "#525252", "#b91c1c", "#DC2626"] },
      ];
      const paletteMatches = (cols: string[]) =>
        cols.length === state.palette.length &&
        cols.every((c, i) => c.toLowerCase() === (state.palette[i] || "").toLowerCase());

      return (
        <div className="space-y-10 py-12 text-center">
          <div className="space-y-4">
            <h2 className="text-4xl font-black uppercase tracking-tighter drop-shadow-2xl">Visual_Registry</h2>
            <p className="text-text-muted font-medium max-w-lg mx-auto">Define the core colors that bridge your prose and your imagery.</p>
          </div>

          <div className="flex flex-wrap justify-center gap-6 py-16">
            {state.palette.map((color, idx) => (
              <div key={idx} className="group flex flex-col items-center gap-6">
                <div className="relative">
                  <label className="cursor-pointer">
                    <input 
                      type="color"
                      value={color}
                      onChange={(e) => {
                        const newPalette = [...state.palette];
                        newPalette[idx] = e.target.value;
                        setState(s => ({ ...s, palette: newPalette }));
                      }}
                      className="sr-only"
                    />
                    <div 
                      className="w-20 h-32 rounded-2xl border border-white/5 shadow-2xl transition-all duration-500 group-hover:scale-110 group-hover:-translate-y-2 group-hover:rotate-3 flex items-end p-3 overflow-hidden"
                      style={{ backgroundColor: color }}
                    >
                      <div className="absolute inset-0 bg-gradient-to-tr from-black/20 to-transparent pointer-events-none" />
                      <div className="bg-black/40 backdrop-blur-md px-2 py-1 rounded text-[8px] font-mono text-white/60 tracking-wider">
                        C_{idx + 1}
                      </div>
                    </div>
                  </label>
                </div>
                <div className="space-y-1">
                  <input 
                    type="text" 
                    value={color}
                    onChange={(e) => {
                      const newPalette = [...state.palette];
                      newPalette[idx] = e.target.value;
                      setState(s => ({ ...s, palette: newPalette }));
                    }}
                    className="w-24 bg-card border border-border rounded px-2 py-1 text-[10px] font-mono text-center text-text-muted uppercase focus:border-accent focus:outline-none transition-colors" 
                  />
                  <div className="text-[10px] text-label uppercase font-black tracking-widest opacity-80">
                    {idx === 0 ? "Background" : idx === 1 ? "Main Text" : idx === 2 ? "Accent 1" : idx === 3 ? "Accent 2" : "Contrast"}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Curated palette presets */}
          <div className="space-y-6">
            <div className="flex items-center justify-center gap-3">
              <div className="h-px w-10 bg-border" />
              <h3 className="text-[11px] text-label font-black uppercase tracking-[0.3em]">Or select a curated palette</h3>
              <div className="h-px w-10 bg-border" />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-3xl mx-auto">
              {PALETTE_PRESETS.map((preset) => {
                const active = paletteMatches(preset.colors);
                return (
                  <button
                    key={preset.name}
                    type="button"
                    onClick={() => setState(s => ({ ...s, palette: [...preset.colors] }))}
                    aria-pressed={active}
                    className={`group text-left p-4 rounded-2xl border transition-all active:scale-[0.98] ${active ? "border-accent bg-accent/10 shadow-[0_0_20px_rgba(20,184,166,0.18)]" : "border-border bg-card hover:border-accent/40 hover:bg-header/30"}`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-3">
                      <div className="min-w-0">
                        <div className="text-xs font-black uppercase tracking-wide text-text-main truncate">{preset.name}</div>
                        <div className="text-[10px] text-text-dim font-medium truncate">{preset.vibe}</div>
                      </div>
                      {active && <Check className="w-4 h-4 text-accent shrink-0" />}
                    </div>
                    <div className="flex h-6 rounded-lg overflow-hidden border border-white/10">
                      {preset.colors.map((c, i) => (
                        <div key={i} className="flex-1" style={{ backgroundColor: c }} title={c} />
                      ))}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="p-6 bg-header/20 rounded-xl border border-border inline-block mx-auto mb-10">
            <p className="text-[10px] text-label font-bold uppercase tracking-[0.3em]">
              * Click a swatch above to fine-tune any color
            </p>
          </div>
        </div>
      );

    case 5: // World Grounding
      const GROUNDING_TEMPLATES = [
        {
          id: "cyberpunk",
          title: "Technological Hardlock",
          genre: "Cyberpunk / Hard Sci-fi",
          description: "Forces a gritty, cybernetic reality with no mystical or fantasy loopholes.",
          rules: `[PROTOCOL_01] DO NOT allow any supernatural magic, traditional spellcasting, or divine pantheon intervention.
[PROTOCOL_02] INSTEAD, enforce technological explanations: neural-net load limits, nanite subroutines, high-latency corporate satellite relays, and localized visual/sensory hallucinations caused by neural implant feedback.

[PROTOCOL_03] DO NOT solve atmospheric threats or physical traversal instantly or easily.
[PROTOCOL_04] INSTEAD, emphasize dense concrete architectural congestion, constant heavy polluted rain, and strict corporate scan gates that demand authenticated digital credentials.`,
          icon: "Cpu"
        },
        {
          id: "gothic",
          title: "Gothic Ritual & Soil",
          genre: "Victorian Gothic / Dark Fantasy",
          description: "Enhances slow-burning dread, ritual bloodlines, and analog limitations.",
          rules: `[PROTOCOL_01] DO NOT use modern slang, immediate communications, or electrical appliances.
[PROTOCOL_02] INSTEAD, enforce traditional instruments: gaslight lamps, leather-bound handwritten diaries, mechanical lockboxes, and letter carriers traveling by steam locomotive or carriage.

[PROTOCOL_03] DO NOT treat magic or monsters as trivial, combat-ready stats.
[PROTOCOL_04] INSTEAD, frame supernatural elements as ancient, heavy, dangerous rituals requiring bloodline sacrifices, physical catalysts (salt, iron, vellum, wax), and deep mental degradation.`,
          icon: "ShieldAlert"
        },
        {
          id: "noir",
          title: "Intrigue & Gritty Realism",
          genre: "Hard-boiled Noir / Realism",
          description: "Focuses on professional friction, institutional corruption, and gray morality.",
          rules: `[PROTOCOL_01] DO NOT introduce flashy superpowers, magical artifacts, or ultimate forces of good versus evil.
[PROTOCOL_02] INSTEAD, model conflicts on systemic friction, monetary leverage, black-market bribes, bureaucratic decay, and human self-interest.

[PROTOCOL_03] DO NOT allow easy trust or convenient confessions between characters.
[PROTOCOL_04] INSTEAD, ground conversations in subtext, unspoken agreements, hidden wiretaps, physical blackmail ledgers, and compromised authority structures.`,
          icon: "Terminal"
        },
        {
          id: "cosmic",
          title: "Dread Resonance",
          genre: "Space Opera / Cosmic Horror",
          description: "Binds deep-space high-tech setup with deep eldritch dread.",
          rules: `[PROTOCOL_01] DO NOT allow instantaneous portals, soft warp-drives, or lighthearted space adventure tropes.
[PROTOCOL_02] INSTEAD, emphasize long cryo-sleep fallout, severe cosmic radiation, solar sail navigation, and severe mental fatigue during deep void travel.

[PROTOCOL_03] DO NOT construct relatable, humanoid alien politics with clear moral goals.
[PROTOCOL_04] INSTEAD, represent extraterrestrial presences as ancient, uncaring, massive entities or radioactive signals emitting from dormant black holes.`,
          icon: "Compass"
        },
        {
          id: "fantasy",
          title: "Aetheric Law & Axiom",
          genre: "Fantasy / High Fantasy",
          description: "Establishes systematic spellcraft costs and ancient blood pact structures.",
          rules: `[PROTOCOL_01] DO NOT allow casual magic casting without physical toll or resource exhaust.
[PROTOCOL_02] INSTEAD, require rigorous preparation: rune-carving on weapon hilts, alignment with planar tides, consumption of raw catalyst dust, and mental memory burn of the spells themselves.

[PROTOCOL_03] DO NOT resolve battles with abrupt power-of-friendship power-ups or convenient deus ex machina.
[PROTOCOL_04] INSTEAD, demand clever exploiting of ancient geometric wards, elemental vulnerabilities, and pre-established ironclad binding vows.`,
          icon: "Sparkles"
        },
        {
          id: "isekai",
          title: "System Overdrive",
          genre: "Isekai / Portal Fantasy",
          description: "Grounds the classic transmigration story with gamified UI artifacts and soul friction.",
          rules: `[PROTOCOL_01] DO NOT let the protagonist perfectly assimilate into the new world as a native speaker immediately.
[PROTOCOL_02] INSTEAD, keep foreign habits active, and frame the world's status screen as an external, malfunctioning UI overlay that flickers with system warnings when crossing magical ley lines.

[PROTOCOL_03] DO NOT make native legendary tier characters immediately fall in love or pledge loyalty.
[PROTOCOL_04] INSTEAD, present them as calculating historical political powers who view the reincarnated hero as a highly dangerous anomaly or a tool to be heavily monitored.`,
          icon: "Zap"
        },
        {
          id: "supernatural",
          title: "Sub-Reality Leakage",
          genre: "Modern Supernatural",
          description: "Sets laws for the secret world hidden just beneath the civilized concrete surface.",
          rules: `[PROTOCOL_01] DO NOT allow public supernatural exposure or military-grade modern weapons handling spirits freely.
[PROTOCOL_02] INSTEAD, enforce the Masquerade: strange occurrences are covered up by specialized municipal taskforces, and spirits are harmed only by analog relics (blessed lead bullets, cold iron alloys, salt-loaded shotgun cartridges).

[PROTOCOL_03] DO NOT portray ghosts or spirits as simple friendly sprites.
[PROTOCOL_04] INSTEAD, write them as lingering echoes bound by desperate psychological obsessions, geometric patterns, or unfulfilled tragic demands.`,
          icon: "Shield"
        },
        {
          id: "survival",
          title: "Atmospheric Entropic Decline",
          genre: "Post-Apocalyptic / Survival",
          description: "Enforces immediate biological scarcity, physical decay, and radioactive ash.",
          rules: `[PROTOCOL_01] DO NOT allow characters to find unlimited fresh food, clean water, or functional pristine vehicles.
[PROTOCOL_02] INSTEAD, describe the brutal, constant tax of survival: filtering toxic particulate from drinking water, dealing with radiation-sickness, and scavenging custom handmade replacement iron parts.

[PROTOCOL_03] DO NOT romanticize scavenged communities as safe utopias.
[PROTOCOL_04] INSTEAD, render every encampment suspended on thin ice, driven by desperate trades, water-purification blockades, or constant fear of raiders.`,
          icon: "AlertTriangle"
        }
      ];

      const groundingIcon = (name: string, cls: string) => {
        switch (name) {
          case "Cpu": return <Cpu className={cls} />;
          case "ShieldAlert": return <ShieldAlert className={cls} />;
          case "Terminal": return <Terminal className={cls} />;
          case "Compass": return <Compass className={cls} />;
          case "Sparkles": return <Sparkles className={cls} />;
          case "Zap": return <Zap className={cls} />;
          case "Shield": return <Shield className={cls} />;
          case "AlertTriangle": return <AlertTriangle className={cls} />;
          default: return null;
        }
      };

      return (
        <div className="space-y-12 py-10 font-sans">
          {/* Section Header */}
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div className="space-y-2">
              <h2 className="text-4xl font-black uppercase tracking-tighter drop-shadow-xl flex items-center gap-3">
                Grounding_Logic <span className="text-xs bg-accent/20 text-accent px-2.5 py-1 rounded font-mono uppercase tracking-widest">v6.1</span>
              </h2>
              <p className="text-text-muted font-medium text-sm">Define hard physical boundaries, logical limitations, and atmospheric laws to ground your world.</p>
            </div>
          </div>

          {/* Core Concept Explanation Panel */}
          <div className="bg-card border border-border p-8 rounded-3xl relative overflow-hidden group shadow-2xl">
            <div className="absolute top-0 right-0 p-8 opacity-5">
              <Cpu className="w-32 h-32 text-accent" />
            </div>
            
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 bg-accent/10 border border-accent/30 rounded-xl flex items-center justify-center shrink-0">
                <HelpCircle className="w-5 h-5 text-accent" />
              </div>
              <div className="space-y-4">
                <h3 className="text-sm font-black uppercase tracking-[0.2em] text-accent">What are Reality Protocols?</h3>
                <p className="text-xs text-text-muted leading-relaxed max-w-4xl">
                  Reality Protocols act as the **creative laws and physics boundaries** of your story. Generative AI models are prone to generic fantasy soup—suddenly spawning magical portals in hard science-fiction, or using modern smartphone terms in 18th century gothic settings. 
                </p>
                <p className="text-xs text-text-muted leading-relaxed max-w-4xl">
                  By declaring explicit <span className="text-text-main font-bold font-mono tracking-tighter decoration-accent/40 decoration-wavy underline underline-offset-4">DO NOT / INSTEAD</span> parameters, you program the universe's logic gates so every generated plot point, environment, and response maintains pristine conceptual integrity.
                </p>
              </div>
            </div>
          </div>

          {/* Primary action: co-design with the collaborator */}
          <button
            onClick={() => askAssistant(`[WORKSHOP ACTION — DESIGN GROUNDING RULES] Let's build custom World Grounding "Reality Protocols" for THIS story together — not a generic template. Using the established setting, concept, and tone, propose a tailored DO NOT / INSTEAD ruleset in the [PROTOCOL_NN] format that locks this world's physics/logic and stops the deployed AI from drifting into genre clichés. Briefly explain your reasoning, then emit the finished ruleset with a [SET_RULES: ...] tag so it loads into my editor. We'll refine from there.`)}
            disabled={state.isAssistantLoading}
            className="w-full p-6 rounded-2xl border border-accent bg-accent/10 hover:bg-accent/15 transition-all text-left group disabled:opacity-50 shadow-[0_0_24px_rgba(20,184,166,0.18)] active:scale-[0.995]"
          >
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-accent/20 border border-accent/40 flex items-center justify-center shrink-0">
                <Sparkles className="w-6 h-6 text-accent" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-black uppercase tracking-[0.15em] text-accent flex items-center gap-2">Design your own with the collaborator <ChevronRight className="w-4 h-4 transition-transform group-hover:translate-x-1" /></div>
                <div className="text-xs text-text-muted mt-1 leading-relaxed">Have Aether_Core propose Reality Protocols tailored to your specific setting &amp; concept, then refine them together in chat. Recommended — the templates below are just examples to explore.</div>
              </div>
            </div>
          </button>

          {/* Template pills — expand to preview, then load into the editor */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-accent rounded-full" />
              <h3 className="text-xs font-black uppercase tracking-[0.3em] text-text-main">Or start from a template <span className="text-text-dim normal-case tracking-normal font-medium">(expand to preview, then load into the editor)</span></h3>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-start">
              {GROUNDING_TEMPLATES.map((tpl) => {
                const active = state.groundingRules === tpl.rules;
                return (
                  <details key={tpl.id} className={`group/pill rounded-2xl border transition-all overflow-hidden ${active ? "border-accent bg-accent/5" : "border-border bg-card hover:border-accent/40"}`}>
                    <summary className="cursor-pointer list-none flex items-center gap-3 p-4 select-none">
                      <div className="p-2 bg-header/40 border border-border rounded-lg shrink-0">
                        {groundingIcon(tpl.icon, "w-4 h-4 text-accent")}
                      </div>
                      <div className="min-w-0 flex-1">
                        <span className="text-[8px] font-bold uppercase tracking-widest text-accent font-mono block">{tpl.genre}</span>
                        <h4 className="text-sm font-black uppercase tracking-tight text-text-main truncate">{tpl.title}</h4>
                      </div>
                      {active && <span className="text-[8px] font-black uppercase tracking-widest text-accent font-mono shrink-0">In use</span>}
                      <ChevronRight className="w-4 h-4 text-text-dim shrink-0 transition-transform group-open/pill:rotate-90" />
                    </summary>
                    <div className="px-4 pb-4 pt-3 space-y-3 border-t border-border">
                      <p className="text-xs text-text-dim leading-relaxed">{tpl.description}</p>
                      <pre className="text-[11px] font-mono leading-relaxed text-text-muted bg-black/20 p-3 rounded-lg whitespace-pre-wrap max-h-48 overflow-y-auto custom-scrollbar">{tpl.rules}</pre>
                      <button
                        onClick={() => setState(s => ({ ...s, groundingRules: tpl.rules }))}
                        className={`w-full py-2.5 rounded-lg border text-[9px] font-black uppercase tracking-widest transition-all ${active ? "bg-accent text-bg border-accent shadow-[0_4px_12px_rgba(20,184,166,0.3)]" : "bg-header/20 border-border text-text-muted hover:border-accent hover:text-accent hover:bg-accent/10"}`}
                      >
                        {active ? "✓ Loaded into editor" : "Use this template"}
                      </button>
                    </div>
                  </details>
                );
              })}
            </div>
          </div>

          {/* Compact active-ruleset editor */}
          <div className="space-y-3">
            <div className="flex justify-between items-center px-1">
              <div className="flex items-center gap-2">
                <Terminal className="w-3.5 h-3.5 text-accent" />
                <span className="text-[10px] font-black uppercase tracking-widest text-text-main">Active Reality Protocols</span>
              </div>
              <div className="flex items-center gap-4">
                {state.groundingRules && isSyncNeeded && syncDeskstateToAI && (
                  <button
                    onClick={syncDeskstateToAI}
                    className="text-[9px] font-black uppercase tracking-wider text-amber-400 hover:text-amber-300 flex items-center gap-1 animate-pulse"
                  >
                    ↺ Sync to collaborator
                  </button>
                )}
                {state.groundingRules && (
                  <button
                    onClick={() => setState(s => ({ ...s, groundingRules: "" }))}
                    className="text-[9px] font-black uppercase tracking-wider text-red-400 hover:underline"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>

            <div className="relative">
              <textarea
                value={state.groundingRules}
                onChange={(e) => setState(s => ({ ...s, groundingRules: e.target.value }))}
                className="w-full h-[260px] bg-card border border-border rounded-2xl p-6 focus:border-accent focus:outline-none transition-all font-mono text-xs leading-loose custom-scrollbar shadow-inner"
                placeholder={`Click "Design your own with the collaborator" above and the AI drafts rules straight into here — or expand a template and hit "Use this".

[PROTOCOL_01] DO NOT introduce arbitrary magic into a grounded setting.
[PROTOCOL_02] INSTEAD, build tension from real-world stakes and physical obstacles.`}
              />
              <div className="absolute bottom-4 right-6 text-[8px] font-mono text-text-muted opacity-30 tracking-widest">
                {state.groundingRules ? `BUFFER_SIZE::${state.groundingRules.length}_CHARS` : "BUFFER::EMPTY"}
              </div>
            </div>
            <p className="text-[10px] text-text-dim px-1">This is your live ruleset — the collaborator fills it when you co-design, templates load into it, and you can edit directly. Hit <span className="text-text-muted font-bold">Sync</span> when you're happy so the collaborator gets the final version.</p>
          </div>

          {/* Logical Contrast Examples (reference) */}
          <div className="bg-header/20 border border-border p-6 rounded-3xl space-y-4">
            <div className="space-y-1">
              <span className="text-[8px] font-bold text-accent font-mono uppercase tracking-[0.2em]">DEMONSTRATION — WHY THIS MATTERS</span>
              <h4 className="text-xs font-black uppercase tracking-wider">Continuity Integrity</h4>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-red-400 text-[9px] font-bold uppercase tracking-wider">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-400" /> BROKEN (No Fences)
                </div>
                <p className="text-xs italic text-text-dim leading-relaxed bg-black/20 p-3.5 rounded-xl border border-red-500/10 font-sans">
                  "When the space ranger runs out of ammunition, he closes his eyes, gathers the elements, and casts a solar light shield to block the oncoming turret fire."
                </p>
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-accent text-[9px] font-bold uppercase tracking-wider">
                  <span className="w-1.5 h-1.5 rounded-full bg-accent" /> GROUNDED (Protocols Active)
                </div>
                <p className="text-xs italic text-text-muted leading-relaxed bg-black/20 p-3.5 rounded-xl border border-accent/10 font-sans">
                  "When the space ranger runs out of ammunition, he rips the high-insulation copper coolant pipe off the generator wall to redirect superheated exhaust, steaming the hallway blind."
                </p>
              </div>
            </div>
          </div>
        </div>
      );

    case 6: // Title & Summary
      return (
        <div className="space-y-10">
          <div className="space-y-4">
            <h2 className="text-4xl font-black uppercase tracking-tighter">Identity_Stamp</h2>
            <p className="text-text-muted font-medium text-sm">Finalize the project name and narrative summary of the domain.</p>
          </div>
          
          <div className="space-y-12 bg-card/30 border border-border p-8 rounded-3xl">
            <div className="space-y-3">
              <label className="text-[10px] uppercase tracking-[0.2em] font-black text-accent ml-2">Story_Title</label>
              <input 
                type="text"
                value={state.title}
                onChange={(e) => setState(s => ({ ...s, title: e.target.value }))}
                placeholder="e.g. THE FALL OF AETHERIA"
                className="w-full bg-card border border-border rounded-xl p-5 text-2xl font-black uppercase tracking-tighter focus:border-accent focus:outline-none transition-all"
              />
            </div>
            <div className="space-y-3">
              <label className="text-[10px] uppercase tracking-[0.2em] font-black text-accent ml-2">Narrative_Summary <span className="text-text-dim normal-case tracking-normal font-medium">— the ~20-word discovery hook, not the full premise</span></label>
              <textarea
                className="w-full h-48 bg-card border border-border rounded-xl p-6 font-serif text-lg leading-relaxed focus:border-accent transition-all resize-none shadow-inner"
                value={state.summary}
                onChange={(e) => setState(s => ({ ...s, summary: e.target.value }))}
                placeholder="A short, user-facing hook — a reason to click, not the whole plot. Pick one in chat and the collaborator drops it here, or type your own."
              />
            </div>
          </div>
        </div>
      );

    case 7: // Plot Card
      return (
        <div className="space-y-10">
          <div className="flex justify-between items-end">
            <div className="space-y-4">
              <h2 className="text-4xl font-black uppercase tracking-tighter">Manifest_Card</h2>
              <p className="text-text-muted font-medium text-sm">Visualizing the story core. Calibrate and adjust elements freely.</p>
            </div>
            <div className="flex gap-4">
              <button
                onClick={() => askAssistant(`[WORKSHOP ACTION — DRAFT PLOT CARD] Draft the COMPLETE user-facing Plot Card for "${state.title || 'this story'}" as self-contained HTML, following the injected USCS Plot Card spec. Use my locked visual identity — background ${state.palette[0]}, text ${state.palette[1]}, primary ${state.palette[2]}, secondary ${state.palette[3]}, accent ${state.palette[4]} — and the ${state.aestheticMode} aesthetic. Include every required field; do not abbreviate. ACCENT BORDERS: to set apart or colour-code a section, use a FULL border (border:2px solid #hex) in the accent colour — NEVER a single-side left/right accent bar (border-left:Npx solid …), nor an inset box-shadow or gradient strip faking one; ISK0 strips all of those, so the accent silently vanishes on the platform. Emit the finished card wrapped in <<<USCS_BLOCK PLOT_CARD>>> … <<<END USCS_BLOCK>>> so it loads into my live preview; keep only a brief note in chat.`)}
                disabled={state.isAssistantLoading}
                className="px-6 py-2 bg-accent text-black rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-white transition-all flex items-center gap-2 disabled:opacity-50"
              >
                <Sparkles className="w-3 h-3" /> {state.deliverables.plotCard ? "Regenerate Card" : "Draft Plot Card"}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2 space-y-3">
              {state.deliverables.plotCard ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between px-1">
                    <span className="text-[10px] font-black uppercase tracking-widest text-accent flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5" /> Live Plot Card — captured HTML</span>
                    <div className="flex items-center gap-2.5">
                      <span className="text-[8px] font-mono text-text-dim uppercase tracking-widest">sandboxed · scripts off</span>
                      <CopyButton variant="button" label="Copy HTML" text={state.deliverables.plotCard} title="Copy the raw Plot Card HTML (paste into a playroom or test render)" />
                    </div>
                  </div>
                  <CardPreview
                    title="Plot Card Preview"
                    html={state.deliverables.plotCard}
                    bg={state.palette[0] || "#18181b"}
                    height={520}
                  />
                  <p className="text-[10px] text-text-dim px-1">This is the real HTML the player will see. Tinker the palette on the right and hit <span className="text-text-muted font-bold">Apply Palette &amp; Iterate</span>, or ask for changes in chat — the AI re-emits the card and this preview refreshes.</p>
                </div>
              ) : (
              <div
                className={`aspect-[16/9] w-full border rounded-3xl shadow-2xl flex items-center justify-center relative overflow-hidden group transition-all duration-700 ${
                  state.aestheticMode === "Literary" ? "font-serif border-accent/20" :
                  state.aestheticMode === "Chaos" ? "skew-x-1 -rotate-1 border-accent/40" :
                  "font-sans border-white/10"
                }`}
                style={{ backgroundColor: state.palette[0] || "#18181b" }}
              >
                <div 
                  className={`absolute inset-0 opacity-20 ${state.aestheticMode === 'Chaos' ? 'animate-pulse' : ''}`} 
                  style={{ background: `linear-gradient(135deg, ${state.palette[2] || "#14b8a6"} 0%, transparent 100%)` }} 
                />
                
                {state.aestheticMode === "Literary" && (
                  <div className="absolute inset-0 opacity-10 pointer-events-none" style={{ backgroundImage: `radial-gradient(${(state.palette[1] || "#ffffff")}22 1px, transparent 1px)`, backgroundSize: '20px 20px' }} />
                )}

                <div className={`text-center p-12 relative z-10 space-y-6 ${state.aestheticMode === "Literary" ? "max-w-xl" : ""}`}>
                  <div className="absolute top-8 left-8 flex gap-4 opacity-0 group-hover:opacity-100 transition-opacity">
                     <div className="px-3 py-1 bg-black/40 border border-white/10 rounded font-mono text-[7px] text-accent tracking-[0.2em]">HL::0${state.heatLevel}</div>
                     <div className="px-3 py-1 bg-black/40 border border-white/10 rounded font-mono text-[7px] text-accent tracking-[0.2em]">MD::{state.mode || "PEND"}</div>
                  </div>
                  
                  <div 
                    className={`rounded-full mx-auto flex items-center justify-center relative transition-all duration-500 ${
                      state.aestheticMode === "Literary" ? "w-16 h-16" : "w-20 h-20"
                    }`}
                    style={{ backgroundColor: `${(state.palette[2] || "#14b8a6")}33` }}
                  >
                    <Layout className="w-10 h-10" style={{ color: state.palette[2] || "#14b8a6" }} />
                    <div className="absolute inset-0 border-2 rounded-full animate-ping opacity-20" style={{ borderColor: state.palette[2] || "#14b8a6" }} />
                  </div>
                  <div className="space-y-2">
                    <h3 
                      className={`font-black tracking-tighter uppercase transition-all ${
                        state.aestheticMode === "Literary" ? "text-2xl italic tracking-normal" : "text-3xl"
                      }`} 
                      style={{ color: state.palette[1] || "#ffffff" }}
                    >
                      {state.title || "UNTITLED_MANIFEST"}
                    </h3>
                    <p className="text-xs font-mono tracking-widest uppercase" style={{ color: `${(state.palette[1] || "#ffffff")}99` }}>{state.settingType || "AWAITING_SETTING"}</p>
                  </div>
                  <div className="h-px w-32 mx-auto" style={{ backgroundColor: `${(state.palette[2] || "#14b8a6")}66` }} />
                  
                  {state.aestheticMode === "Structured" && (
                     <div className="grid grid-cols-3 gap-2 opacity-40">
                        {[1,2,3].map(i => <div key={i} className="h-1 bg-accent/20 rounded" />)}
                     </div>
                  )}
                </div>
              </div>
              )}
            </div>

            <div className="space-y-8 bg-card border border-border p-8 rounded-3xl h-fit sticky top-8">
              <div className="flex items-center gap-3 text-accent border-b border-border pb-4 mb-6">
                <Palette className="w-5 h-5" />
                <h3 className="text-xs font-black uppercase tracking-[0.2em]">Chromatic_Tuning</h3>
              </div>
              
              <div className="space-y-6">
                {state.palette.map((color, idx) => (
                  <div key={idx} className="space-y-3">
                    <div className="flex justify-between items-center px-1">
                      <span className="text-[10px] font-black uppercase text-label tracking-widest">
                        {idx === 0 ? "Background" : idx === 1 ? "Typography" : idx === 2 ? "Primary" : idx === 3 ? "Secondary" : "Accent"}
                      </span>
                    </div>
                    <div className="flex gap-4 items-center group">
                       <div className="relative">
                         <input 
                           type="color"
                           value={color}
                           onChange={(e) => {
                             const newPalette = [...state.palette];
                             newPalette[idx] = e.target.value;
                             setState(s => ({ ...s, palette: newPalette }));
                           }}
                           className="absolute inset-0 opacity-0 w-full h-full cursor-pointer z-10"
                         />
                         <div 
                           className="w-16 h-16 rounded-2xl border-2 border-white/10 shadow-lg group-hover:border-accent/40 transition-all flex items-center justify-center overflow-hidden"
                           style={{ backgroundColor: color }}
                         >
                           <div className="w-full h-full opacity-0 group-hover:opacity-100 bg-black/20 flex items-center justify-center transition-opacity">
                              <Palette className="w-4 h-4 text-white" />
                           </div>
                         </div>
                       </div>
                       <div className="flex-1 space-y-1">
                          <div className="text-[11px] font-mono font-bold uppercase tracking-widest text-text-main">{color}</div>
                          <div className="text-[8px] font-mono text-text-dim uppercase tracking-tighter">HEX_CODE::LOCKED</div>
                       </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="pt-6 border-t border-border mt-8 space-y-2">
                {state.deliverables.plotCard ? (
                  <>
                    <button
                      onClick={() => {
                        const from = state.deliverables.plotCardPalette;
                        if (!from) {
                          setState(s => ({ ...s, deliverables: { ...s.deliverables, plotCardPalette: [...s.palette] } }));
                          triggerToast?.("Captured this card's current palette as the baseline — tweak a swatch, then Recolor.", "info");
                          return;
                        }
                        const recolored = recolorHtml(state.deliverables.plotCard, from, state.palette);
                        if (recolored === state.deliverables.plotCard) { triggerToast?.("No palette-derived colours to change — adjust a swatch first.", "info"); return; }
                        setState(s => ({ ...s, deliverables: { ...s.deliverables, plotCard: recolored, plotCardPalette: [...s.palette] } }));
                        triggerToast?.("Card recoloured to the current palette ⚡ (instant, no AI call)", "ai-to-ui");
                      }}
                      disabled={state.isAssistantLoading}
                      className="w-full py-4 bg-accent/10 border border-accent/20 text-accent rounded-xl text-[10px] font-black uppercase tracking-[0.2em] hover:bg-accent hover:text-black transition-all disabled:opacity-50"
                    >
                      ⚡ Recolor to Palette · instant
                    </button>
                    <button
                      onClick={() => askAssistant(`[WORKSHOP ACTION — ITERATE PLOT CARD] I've set the palette to background ${state.palette[0]}, text ${state.palette[1]}, primary ${state.palette[2]}, secondary ${state.palette[3]}, accent ${state.palette[4]}. Re-skin the Plot Card HTML to use exactly these colors (keep the content and structure unless I ask otherwise) and re-emit the FULL updated card wrapped in <<<USCS_BLOCK PLOT_CARD>>> … <<<END USCS_BLOCK>>> so my live preview refreshes.`)}
                      disabled={state.isAssistantLoading}
                      className="w-full py-2.5 border border-border text-text-muted rounded-xl text-[9px] font-black uppercase tracking-widest hover:border-accent hover:text-accent hover:bg-accent/10 transition-all disabled:opacity-50"
                    >
                      Ask AI to re-skin instead
                    </button>
                    <p className="text-[9px] text-text-dim px-1 leading-relaxed">Recolor swaps your palette colours (hex + rgba borders/tints) directly in the card — instant and free. Use re-skin only for off-palette shades or structural changes.</p>
                  </>
                ) : (
                  <button
                    onClick={() => askAssistant(`I've set my palette to background ${state.palette[0]}, text ${state.palette[1]}, primary ${state.palette[2]}, secondary ${state.palette[3]}, accent ${state.palette[4]}. When you draft the Plot Card, use exactly these colors.`)}
                    disabled={state.isAssistantLoading}
                    className="w-full py-4 bg-accent/10 border border-accent/20 text-accent rounded-xl text-[10px] font-black uppercase tracking-[0.2em] hover:bg-accent hover:text-black transition-all disabled:opacity-50"
                  >
                    Lock Palette for the Card
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      );

    case 8: // Character Sheets
      return (
        <div className="space-y-10">
          <div className="space-y-3 text-center">
            <h2 className="text-4xl font-black uppercase tracking-tighter">Persona_Matrices</h2>
            <p className="text-text-muted font-medium text-sm max-w-xl mx-auto">Build the cast one character at a time. First shape each character's narration guidance — personality, wants, speech & mannerisms, lore — with the collaborator. The user-facing HTML card comes last, once they're fully defined.</p>
          </div>

          {/* Primary action: construct the next character — top & centre */}
          <div className="flex flex-col items-center text-center gap-4 p-8 bg-header/20 border border-border border-dashed rounded-3xl">
            <div className="w-14 h-14 bg-accent/10 rounded-full flex items-center justify-center">
              <Users className="w-7 h-7 text-accent opacity-50" />
            </div>
            <div className="space-y-1">
              <h3 className="text-sm font-black uppercase tracking-[0.3em]">Construct New Persona</h3>
              <p className="text-xs text-text-dim max-w-sm">Develop the next character's narration guidance — who they are, what they want, how they speak, their lore. The HTML card comes afterwards, once they're defined.</p>
            </div>
            <button
              onClick={() => askAssistant(`[WORKSHOP ACTION — BUILD NEXT CHARACTER] Let's develop the next character's NARRATION GUIDANCE together — the substance the deployed AI needs to play them: personality, wants/goals, fears, speech & mannerisms, relationships to {{user}} and the cast, and the relevant lore — following the injected USCS Character Sheet "Part B" spec (respect §21 caps: ≤1500 tokens primary / ≤800 supporting). Propose the character (or continue from the cast we've discussed) and refine it WITH me; when it's solid, capture it as <<<USCS_BLOCK CHAR_DESC: [the character's actual name]>>> … <<<END USCS_BLOCK>>>. CRITICAL: put the character's REAL name in that sentinel (e.g. "CHAR_DESC: Aria Vance") — never the literal word "Name". Do NOT produce the HTML card yet — we generate that separately once the character is fully defined. Build and confirm ONE character before the next.`)}
              disabled={state.isAssistantLoading}
              className="px-6 py-2 bg-accent/20 border border-accent/40 text-accent rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-accent/30 transition-all font-mono disabled:opacity-50"
            >
              INIT_PERSONA_SYNC
            </button>
          </div>

          {/* Captured cast — real sheets built in the workshop */}
          {state.deliverables.characters.length === 0 ? (
            <div className="flex items-center justify-center gap-3 p-6 rounded-2xl border border-border/60 bg-white/[0.01] text-center">
              <span className="text-[10px] font-mono uppercase tracking-widest text-text-dim">No characters captured yet — finished sheets from the collaborator will appear here.</span>
            </div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fit,minmax(320px,1fr))] gap-6">
              {state.deliverables.characters.map((char, i) => (
                <div key={i} className="bg-card border border-border rounded-3xl relative overflow-hidden group">
                  <div className="absolute top-0 left-0 w-1.5 h-full bg-accent opacity-40 group-hover:opacity-100 transition-opacity z-10" />
                  <div className="p-6 space-y-4">
                    <div className="flex justify-between items-start gap-3">
                      <h4 className="text-2xl font-black tracking-tighter uppercase min-w-0 truncate">{char.name}</h4>
                      <div className="flex gap-1.5 shrink-0">
                        <span className={`text-[8px] font-mono font-bold uppercase tracking-widest px-2 py-1 rounded border ${char.desc ? "bg-accent/15 text-accent border-accent/30" : "bg-header text-text-dim border-border"}`}>Guidance {char.desc ? "✓" : "—"}</span>
                        <span className={`text-[8px] font-mono font-bold uppercase tracking-widest px-2 py-1 rounded border ${char.card ? "bg-accent/15 text-accent border-accent/30" : "bg-header text-text-dim border-border"}`}>Card {char.card ? "✓" : "—"}</span>
                      </div>
                    </div>

                    {/* The character itself — narration guidance (Part B), shown prominently */}
                    {char.desc ? (
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[9px] font-black uppercase tracking-widest text-accent">Narration Guidance <span className="text-text-dim font-medium normal-case tracking-normal">— personality · wants · speech · lore</span></span>
                          <CopyButton text={char.desc} title={`Copy ${char.name}'s narration guidance`} />
                        </div>
                        <pre className="text-[11px] font-mono leading-relaxed text-text-muted bg-header/20 border border-border rounded-xl p-4 whitespace-pre-wrap max-h-[340px] overflow-y-auto custom-scrollbar">{char.desc}</pre>
                      </div>
                    ) : (
                      <div className="rounded-xl border border-dashed border-border p-4 text-[10px] font-mono uppercase tracking-widest text-text-dim text-center">No guidance captured yet — build this character's personality, wants, speech &amp; lore in chat.</div>
                    )}

                    {/* The user-facing HTML card — the FINAL artifact, after the guidance */}
                    {char.card ? (
                      <details className="group/card rounded-xl border border-border bg-header/20">
                        <summary className="cursor-pointer list-none flex items-center justify-between gap-2 p-3 text-[10px] font-black uppercase tracking-widest text-text-muted">
                          <span className="flex items-center gap-2"><ChevronRight className="w-3.5 h-3.5 transition-transform group-open/card:rotate-90" /> Preview HTML card</span>
                          <span onClick={(e) => e.preventDefault()}>
                            <CopyButton variant="button" label="Copy HTML" text={char.card} title={`Copy ${char.name}'s card HTML`} />
                          </span>
                        </summary>
                        <div className="p-3 pt-0 space-y-2">
                          <CardPreview
                            title={`Character Card — ${char.name}`}
                            html={char.card}
                            bg={state.palette[0] || "#18181b"}
                            height={360}
                            rounded="rounded-xl"
                            shadow={false}
                          />
                          <button
                            onClick={() => {
                              const from = char.cardPalette;
                              if (!from) {
                                setState(s => ({ ...s, deliverables: { ...s.deliverables, characters: s.deliverables.characters.map(c => c.name === char.name ? { ...c, cardPalette: [...s.palette] } : c) } }));
                                triggerToast?.(`Captured ${char.name}'s card palette as the baseline — change a swatch, then Recolor.`, "info");
                                return;
                              }
                              const recolored = recolorHtml(char.card, from, state.palette);
                              if (recolored === char.card) { triggerToast?.("No palette-derived colours to change — adjust a swatch first.", "info"); return; }
                              setState(s => ({ ...s, deliverables: { ...s.deliverables, characters: s.deliverables.characters.map(c => c.name === char.name ? { ...c, card: recolored, cardPalette: [...s.palette] } : c) } }));
                              triggerToast?.(`${char.name}'s card recoloured to the current palette ⚡`, "ai-to-ui");
                            }}
                            disabled={state.isAssistantLoading}
                            className="w-full py-2 rounded-lg border border-accent/40 bg-accent/10 text-accent text-[9px] font-black uppercase tracking-widest hover:bg-accent/20 transition-all disabled:opacity-50"
                          >
                            ⚡ Recolor to current palette
                          </button>
                        </div>
                      </details>
                    ) : char.desc ? (
                      <button
                        onClick={() => askAssistant(`[WORKSHOP ACTION — CHARACTER HTML CARD] The narration guidance for "${char.name}" is defined — now produce their user-facing Part A HTML card based on it, using my locked palette and ${state.aestheticMode} aesthetic, per the injected USCS HTML spec. HARD CONSTRAINTS: the card is FLUID, never a narrow fixed width — width:100%; max-width:600px; margin:0 auto (fills a phone, caps and centers on desktop). Any multi-column section uses PERCENTAGE-width cells (width:50%/33%/100% + padding + box-sizing:border-box) inside display:flex; flex-wrap:wrap, so it reflows from ~300px to 600px; any fixed-px decorative element stays ≤300px. The OUTER CARD BACKGROUND must be EXACTLY ${state.palette[0]} (the locked palette background — not an off-palette near-black). Use ${state.palette[2]} as the SOLID hex for accent TEXT (title, accent words, pill text) — rgba is fine for borders and faint background tints, never for text. ACCENT BORDERS: to set apart a section, use a FULL border (border:2px solid #hex) — NEVER a single-side border-left/right bar, inset box-shadow, or gradient strip; ISK0 strips those so the accent vanishes on the platform. Emit it wrapped in <<<USCS_BLOCK CHAR_CARD: ${char.name}>>> … <<<END USCS_BLOCK>>> so it loads into the preview here. Keep only a brief note in chat.`)}
                        disabled={state.isAssistantLoading}
                        className="w-full py-2.5 rounded-lg border border-accent/40 bg-accent/10 text-accent text-[9px] font-black uppercase tracking-widest hover:bg-accent/20 transition-all disabled:opacity-50"
                      >
                        ✦ Generate HTML card →
                      </button>
                    ) : null}

                    {/* Refine the guidance in chat (replaces the dead Edit_Profile) */}
                    <button
                      onClick={() => askAssistant(`[WORKSHOP ACTION — REFINE CHARACTER] Let's refine "${char.name}"'s narration guidance. Briefly note what's already defined and ask what I'd like to change — personality, wants, fears, speech & mannerisms, relationships, or lore. When we update, re-emit <<<USCS_BLOCK CHAR_DESC: ${char.name}>>> … <<<END USCS_BLOCK>>>${char.card ? ` (and re-emit <<<USCS_BLOCK CHAR_CARD: ${char.name}>>> only if the visible card needs to reflect the change)` : ""} so the captured sheet here updates.`)}
                      disabled={state.isAssistantLoading}
                      className="w-full py-2.5 rounded-lg border border-border text-[9px] font-black uppercase tracking-widest text-text-muted hover:border-accent hover:text-accent hover:bg-accent/10 transition-all disabled:opacity-50"
                    >
                      Refine "{char.name}" in chat
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      );

    case 11: { // Guidelines
      // Helper to parse rules
      const rules = state.groundingRules || "";
      const lines = rules.split('\n').filter(l => l.trim().length > 0);
      const parsedRules: { protocol?: string; type: "DO_NOT" | "INSTEAD" | "OTHER"; text: string }[] = [];
      
      lines.forEach(line => {
        const protocolMatch = line.match(/^\[?(PROTOCOL_\d+|RULE_\d+|LAW_\d+)?\]?\s*(.*)$/i);
        const protocol = protocolMatch ? protocolMatch[1] : undefined;
        const bodyField = protocolMatch ? protocolMatch[2] : line;
        
        if (bodyField.toUpperCase().includes("DO NOT")) {
          parsedRules.push({
            protocol,
            type: "DO_NOT",
            text: bodyField.replace(/DO NOT/i, "").trim().replace(/^:\s*/, "")
          });
        } else if (bodyField.toUpperCase().includes("INSTEAD")) {
          parsedRules.push({
            protocol,
            type: "INSTEAD",
            text: bodyField.replace(/INSTEAD/i, "").trim().replace(/^:\s*/, "")
          });
        } else {
          parsedRules.push({
            protocol,
            type: "OTHER",
            text: bodyField.trim()
          });
        }
      });

      return (
        <div className="space-y-12 py-6 font-sans">
          {/* Header */}
          <div className="space-y-2">
            <h2 className="text-4xl font-black uppercase tracking-tighter flex items-center gap-3">
              Aether_Guidelines <span className="text-xs bg-accent/20 text-accent px-2.5 py-1 rounded font-mono uppercase tracking-widest">v2.4</span>
            </h2>
            <p className="text-text-muted font-medium text-sm">
              Define the hard narrative boundaries, character-pacing standards, and structural constraints for the Performer LLM.
            </p>
          </div>

          {/* Compact mode — density dial for the guidelines (jargon-free explainer) */}
          <button
            onClick={() => setState(s => ({ ...s, leanGuidelines: !s.leanGuidelines }))}
            className="w-full flex items-start gap-3 p-4 rounded-2xl border border-border bg-card hover:border-accent/30 transition-all text-left"
          >
            <div className={`w-9 h-5 rounded-full shrink-0 relative transition-colors mt-0.5 ${state.leanGuidelines ? "bg-accent" : "bg-border"}`}>
              <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${state.leanGuidelines ? "left-[18px]" : "left-0.5"}`} />
            </div>
            <div className="min-w-0">
              <div className="text-[11px] font-black uppercase tracking-[0.15em] text-text-main">Compact mode {state.leanGuidelines ? <span className="text-accent">· ON</span> : <span className="text-text-dim">· OFF</span>}</div>
              <p className="text-[11px] text-text-dim leading-snug mt-1">The Guidelines are the rulebook your story-AI re-reads on <span className="text-text-muted">every single message</span> — so a bigger rulebook costs more tokens on every turn of the finished story. <span className="text-text-muted">Compact mode</span> builds a leaner one: fewer, tighter rules and a condensed cast-relationship map, roughly half the size. Great with strong models (Claude / GPT-4-class) that fill in the gaps — leave it OFF for weaker / free models, which behave better with the fuller, more spelled-out version.</p>
            </div>
          </button>

          <button
            onClick={() => askAssistant(`[WORKSHOP ACTION — ASSEMBLE GUIDELINES] Assemble the complete Prompt Guidelines for the deployed AI now, per the injected USCS §7 spec. OPEN with the one-paragraph emotional mandate (§22.4). ${state.leanGuidelines ? "COMPACT BUILD — keep it lean: ~15 essential rules, each terse (1–2 sentences, no worked examples); condense the NPC Social Web (§7A) to a short relationship map plus only the rules that actually change behaviour (skip the full subsection treatment); list any active modules as a brief reference. Prioritise the highest-impact guidance and drop low-value elaboration — aim for roughly HALF the length of a full build (target ≤3000 tokens)." : "Include AT LEAST 15 rules, and weave in: our locked World Grounding rules, the NPC Social Web & Anti-Harem architecture (§7A) for our cast, the Status Dashboard rules (§7B) if we enabled one, and character-specific voice/behaviour/speech rules now that the sheets exist. Respect the §21 cap (≤3000 tokens)."} Emit the finished block wrapped in <<<USCS_BLOCK GUIDELINES>>> … <<<END USCS_BLOCK>>>; keep only a brief note in chat.`)}
            disabled={state.isAssistantLoading}
            className="w-full p-5 rounded-2xl border border-accent bg-accent/10 hover:bg-accent/15 transition-all flex items-center gap-4 shadow-[0_0_24px_rgba(20,184,166,0.18)] disabled:opacity-50 active:scale-[0.995] text-left"
          >
            <div className="w-12 h-12 rounded-xl bg-accent/20 border border-accent/40 flex items-center justify-center shrink-0">
              <Sparkles className="w-6 h-6 text-accent" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-black uppercase tracking-[0.15em] text-accent">{state.deliverables.guidelines ? "Re-assemble Guidelines" : "Assemble Guidelines with the collaborator"}{state.leanGuidelines ? " · compact" : ""}</div>
              <div className="text-xs text-text-muted mt-0.5">{state.leanGuidelines ? "Builds a COMPACT rule set (~half size) from your grounding rules, cast & sheets — opens with the emotional mandate." : "Builds the full §7 rule set from your grounding rules, social web, dashboard & character sheets — opens with the emotional mandate."}</div>
            </div>
          </button>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Left side: Re-injected Grounding Rules */}
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Cpu className="w-4 h-4 text-accent animate-pulse" />
                  <span className="text-xs font-black uppercase tracking-widest text-text-main">
                    Injected_Grounding_Rules
                  </span>
                </div>
                <span className="text-[8px] bg-red-400/10 border border-red-500/20 text-red-400 font-mono px-2 py-0.5 rounded">
                  ACTIVE_INHERITANCE
                </span>
              </div>

              <div className="bg-card/40 border border-border p-6 rounded-3xl space-y-4 shadow-2xl">
                <p className="text-[10px] text-text-muted leading-relaxed">
                  The <span className="text-accent font-bold font-mono">DO_NOT / INSTEAD</span> rulesets defined in your World Grounding map are integrated directly below. These serve as narrative constraints for the generative pipeline.
                </p>

                {parsedRules.length === 0 ? (
                  <div className="p-8 border border-dashed border-white/5 rounded-2xl text-center space-y-2">
                    <AlertTriangle className="w-6 h-6 text-text-dim mx-auto opacity-30" />
                    <p className="text-[10px] uppercase font-mono text-text-dim tracking-widest">No active grounding rulesets detected</p>
                    <p className="text-[9px] text-text-muted">Return to World Grounding to initialize reality laws.</p>
                  </div>
                ) : (
                  <div className="space-y-3 max-h-[400px] overflow-y-auto pr-1 cs-scrollbar">
                    {parsedRules.map((rule, idx) => (
                      <div 
                        key={idx} 
                        className={`p-4 rounded-xl border text-xs leading-relaxed transition-all ${
                          rule.type === "DO_NOT"
                            ? "border-red-500/10 bg-red-500/[0.02] hover:bg-red-500/[0.04]"
                            : rule.type === "INSTEAD"
                            ? "border-emerald-500/10 bg-emerald-500/[0.02] hover:bg-emerald-500/[0.04]"
                            : "border-border/30 bg-bg/20"
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                          {rule.protocol && (
                            <span className="text-[7px] font-mono font-bold bg-white/5 px-1 py-0.5 rounded opacity-60">
                              {rule.protocol}
                            </span>
                          )}
                          <span className={`text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded ${
                            rule.type === "DO_NOT"
                              ? "bg-red-400/20 text-red-400"
                              : rule.type === "INSTEAD"
                              ? "bg-emerald-400/20 text-emerald-400"
                              : "bg-white/10 text-text-muted"
                          }`}>
                            {rule.type === "DO_NOT" ? "DO_NOT" : rule.type === "INSTEAD" ? "INSTEAD" : "PROTOCOL"}
                          </span>
                        </div>
                        <p className="text-text-main font-mono italic text-[11px] leading-relaxed">
                          {rule.text}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Right side: Guidelines Suggestions */}
            <div className="space-y-6">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-accent" />
                <span className="text-xs font-black uppercase tracking-widest text-text-main">
                  Pacing & Social Alignment
                </span>
              </div>

              <div className="bg-card hover:border-accent/30 transition-colors border border-border p-6 rounded-3xl space-y-6 shadow-2xl">
                <div>
                  <h4 className="text-[10px] font-black text-accent uppercase tracking-wider mb-2">Social Web & Social Map Protocols</h4>
                  <p className="text-xs text-text-dim leading-relaxed">
                    Guidelines dictate how the AI should pace interactions, reveal secrets, and respect the social constraints of the characters.
                  </p>
                </div>

                <div className="space-y-3 text-[11px]">
                  <div className="p-3 bg-white/[0.02] border border-border/40 rounded-xl space-y-1">
                    <span className="text-[8px] font-black uppercase text-accent/60 font-mono">PACING CONTRACT</span>
                    <p className="text-text-main leading-relaxed">
                      "NEVER skip romantic tension or character awkwardness. Build dialogue depth by highlighting underlying micro-interactions before emotional resolution."
                    </p>
                  </div>
                  <div className="p-3 bg-white/[0.02] border border-border/40 rounded-xl space-y-1">
                    <span className="text-[8px] font-black uppercase text-accent/60 font-mono">SOCIAL MAP ALIGNMENT</span>
                    <p className="text-text-main leading-relaxed">
                      "Respect the social hierarchy of characters. Secret feelings, loyalty divides, and historical grudges should govern AI responses and scene developments."
                    </p>
                  </div>
                </div>

                <div className="pt-2">
                  <span className="text-[8px] font-mono text-text-muted uppercase tracking-widest block mb-1">PROMPT STRUCTURE:</span>
                  <div className="bg-bg/40 border border-border/40 font-mono text-[9px] p-3 rounded-lg leading-relaxed text-text-muted">
                    "Under Guidelines Step, refine the 15+ interactive prompt parameters. Collaborate with building blocks inside the link stream below."
                  </div>
                </div>
              </div>
            </div>
          </div>

          {state.deliverables.guidelines && (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-black uppercase tracking-widest text-accent flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5" /> Captured Guidelines — your assembled output</span>
                <CopyButton variant="button" text={state.deliverables.guidelines} title="Copy the Guidelines block to clipboard" />
              </div>
              <pre className="text-[11px] font-mono leading-relaxed text-text-muted bg-header/20 border border-border rounded-2xl p-5 whitespace-pre-wrap max-h-[420px] overflow-y-auto custom-scrollbar">{state.deliverables.guidelines}</pre>
            </div>
          )}
        </div>
      );
    }

    case 12: { // Reminders
      return (
        <div className="space-y-12 py-6 font-sans">
          {/* Header */}
          <div className="space-y-2">
            <h2 className="text-4xl font-black uppercase tracking-tighter flex items-center gap-3">
              Aether_Reminders <span className="text-xs bg-accent/20 text-accent px-2.5 py-1 rounded font-mono uppercase tracking-widest">v1.8</span>
            </h2>
            <p className="text-text-muted font-medium text-sm">
              Construct high-intensity, prioritized reminders to prevent the Performer LLM from defaulting, breaking formatting, or self-narrating.
            </p>
          </div>

          <button
            onClick={() => askAssistant(`[WORKSHOP ACTION — ASSEMBLE REMINDERS] Assemble the complete AI Reminders block now, per the injected USCS §8 spec. OPEN with the single emotional-target line (§22.4) — the AI's north star. Produce ~7 high-priority reminders reinforcing the non-negotiables (no self-narration, output format, heat bounds ${state.mode === 'NSFW' ? `${state.heatLevel}/5` : 'SFW'}, and character precision now that the sheets exist). Respect the §21 cap (≤800 tokens). Emit the finished block wrapped in <<<USCS_BLOCK REMINDERS>>> … <<<END USCS_BLOCK>>>; keep only a brief note in chat.`)}
            disabled={state.isAssistantLoading}
            className="w-full p-5 rounded-2xl border border-accent bg-accent/10 hover:bg-accent/15 transition-all flex items-center gap-4 shadow-[0_0_24px_rgba(20,184,166,0.18)] disabled:opacity-50 active:scale-[0.995] text-left"
          >
            <div className="w-12 h-12 rounded-xl bg-accent/20 border border-accent/40 flex items-center justify-center shrink-0">
              <Sparkles className="w-6 h-6 text-accent" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-black uppercase tracking-[0.15em] text-accent">{state.deliverables.reminders ? "Re-assemble Reminders" : "Assemble Reminders with the collaborator"}</div>
              <div className="text-xs text-text-muted mt-0.5">Builds the ~7-line reinforcement block, opening with the emotional-target north star.</div>
            </div>
          </button>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* North Star Target */}
            <div className="bg-card border border-border p-6 rounded-3xl relative overflow-hidden flex flex-col justify-between h-[240px] shadow-2xl">
              <div className="absolute top-0 right-0 p-6 opacity-5">
                <Compass className="w-24 h-24 text-accent" />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Compass className="w-4 h-4 text-accent" />
                  <span className="text-[10px] font-black uppercase tracking-widest text-[#fbbf24]">
                    North_Star_Target
                  </span>
                </div>
                <p className="text-xs text-text-dim leading-relaxed">
                  Every reminder is calibrated against this central psychological compass, ensuring the AI maintains output resonance.
                </p>
              </div>

              <div className="p-4 bg-[#fbbf24]/5 border border-[#fbbf24]/20 rounded-xl">
                <span className="text-[8px] font-mono font-bold uppercase text-[#fbbf24] tracking-widest block mb-1">
                  CURRENT MANDATE TONE
                </span>
                <p className="text-sm font-black text-white italic truncate" title={state.tone || "Not yet defined"}>
                  "{state.tone || "AWAITING INTAKE..."}"
                </p>
              </div>
            </div>

            {/* Middle and Right: Reminders Cards */}
            <div className="lg:col-span-2 bg-card border border-border p-6 rounded-3xl space-y-6 shadow-2xl">
              <div className="flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-accent" />
                <span className="text-xs font-black uppercase tracking-widest text-text-main">
                  AI Output Safeguards (10+ Required)
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-mono">
                <div className="p-4 bg-white/[0.01] border border-border/45 rounded-xl leading-relaxed hover:bg-white/[0.02] hover:border-accent/20 transition-all">
                  <span className="text-[8px] font-black text-red-400 bg-red-400/10 px-1 py-0.5 rounded uppercase tracking-widest block w-fit mb-2">#01 PRIMARY RULE</span>
                  <span className="text-text-main">NEVER narrate, speak, or take decisions for the Creator/Player character.</span>
                </div>
                <div className="p-4 bg-white/[0.01] border border-border/45 rounded-xl leading-relaxed hover:bg-white/[0.02] hover:border-accent/20 transition-all">
                  <span className="text-[8px] font-black text-accent bg-accent/10 px-1 py-0.5 rounded uppercase tracking-widest block w-fit mb-2">#02 OUTPUT FORMAT</span>
                  <span className="text-text-main">Always output character dialogue in high-contrast clean blocks with custom aesthetic colors.</span>
                </div>
                <div className="p-4 bg-white/[0.01] border border-border/45 rounded-xl leading-relaxed hover:bg-white/[0.02] hover:border-accent/20 transition-all">
                  <span className="text-[8px] font-black text-accent bg-accent/10 px-1 py-0.5 rounded uppercase tracking-widest block w-fit mb-2">#03 WRITING STYLE</span>
                  <span className="text-text-main">Avoid purple prose, cliché metaphors, and romantic generalizations.</span>
                </div>
                <div className="p-4 bg-white/[0.01] border border-border/45 rounded-xl leading-relaxed hover:bg-white/[0.02] hover:border-accent/20 transition-all">
                  <span className="text-[8px] font-black text-accent bg-accent/10 px-1 py-0.5 rounded uppercase tracking-widest block w-fit mb-2">#04 EXPLICIT BOUNDS</span>
                  <span className="text-text-main">Strictly adhere to the designated Heat Level limits {state.mode === 'NSFW' ? `(${state.heatLevel}/5)` : '(SFW Only)'} under all conditions.</span>
                </div>
              </div>
            </div>
          </div>

          {state.deliverables.reminders && (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-black uppercase tracking-widest text-accent flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5" /> Captured Reminders — your assembled output</span>
                <CopyButton variant="button" text={state.deliverables.reminders} title="Copy the Reminders block to clipboard" />
              </div>
              <pre className="text-[11px] font-mono leading-relaxed text-text-muted bg-header/20 border border-border rounded-2xl p-5 whitespace-pre-wrap max-h-[360px] overflow-y-auto custom-scrollbar">{state.deliverables.reminders}</pre>
            </div>
          )}
        </div>
      );
    }

    case 9: // Scenarios
    case 10: // Prompt Plot
    case 13: // First Message
    case 14: // Image Prompts
      return (
        <div className="space-y-12 py-6 font-sans">
          {/* Header */}
          <div className="space-y-2">
            <h2 className="text-4xl font-black uppercase tracking-tighter flex items-center gap-3">
              {STEPS[storyStep].replace(/ /g, '_')} <span className="text-xs bg-accent/20 text-accent px-2.5 py-1 rounded font-mono uppercase tracking-widest">AETHER_STREAM</span>
            </h2>
            <p className="text-text-muted font-medium text-sm">
              {storyStep === 9 ? "A planning step: design the alternate openings, the three-act structure, and any optional systems — each feeds a later step (see below)." :
               storyStep === 10 ? "Output performer instructions and inject the verbatim Architect Protocol sequence." :
               storyStep === 13 ? "Establish high-impact entry narrative lines and authored openings for all cast segments." :
               "Generate style-compliant visual prompt triggers and portrait schemas for the engine."}
            </p>
          </div>

          {storyStep === 9 && (
            <div className="bg-card border border-border p-6 rounded-3xl space-y-3">
              <h3 className="text-sm font-black uppercase tracking-[0.2em] text-accent flex items-center gap-2"><HelpCircle className="w-4 h-4" /> What this step makes — and where it lands on ISK0</h3>
              <p className="text-xs text-text-muted leading-relaxed">This is a <span className="text-text-main font-bold">planning</span> step — nothing here is pasted into ISK0 as one block. Each output feeds a later step:</p>
              <ul className="text-xs text-text-muted space-y-1.5 leading-relaxed">
                <li>• <span className="text-text-main font-bold">Scenario variants</span> (2–3 alternate openings) → become your <span className="text-text-main">First Messages</span> (next step), which fill ISK0's <span className="text-accent font-mono text-[11px]">"First Messages (Scenarios)"</span> field.</li>
                <li>• <span className="text-text-main font-bold">Three-act structure &amp; hooks</span> → become the <span className="text-text-main">phase / pacing structure of your Prompt Plot</span> (used directly, or expanded into modules).</li>
                <li>• <span className="text-text-main font-bold">Optional modules / timekeeping / status dashboard</span> → folded into your <span className="text-text-main">Prompt Plot &amp; Guidelines</span> (ISK0's main prompt).</li>
              </ul>
            </div>
          )}

          {/* Locked-in Decisions Summary Panel */}
          <LockedStepsSummary state={state} />

          {/* Prompt / Interactivity Guideline Card for the Active Step */}
          <div className="bg-card hover:border-accent/30 border border-border p-8 rounded-3xl relative overflow-hidden flex flex-col md:flex-row gap-6 items-center shadow-2xl transition-colors">
            <div className="w-16 h-16 bg-accent/10 rounded-full flex items-center justify-center shrink-0">
              {storyStep === 9 ? <BookOpen className="w-8 h-8 text-accent opacity-80" /> :
               storyStep === 10 ? <Cpu className="w-8 h-8 text-accent opacity-80 animate-pulse" /> :
               storyStep === 13 ? <MessageSquare className="w-8 h-8 text-accent opacity-80" /> :
               <ImageIcon className="w-8 h-8 text-accent opacity-80" />}
            </div>
            <div className="space-y-2 text-center md:text-left flex-1">
              <span className="text-[8px] font-mono font-black text-accent uppercase tracking-[0.3em] block">
                SIDELINE_COMMUNICATION_PROTOCOL :: ACTIVE
              </span>
              <h3 className="text-lg font-black uppercase tracking-tight">
                {storyStep === 9 ? "Plan Scenarios, Act Structure & Systems" :
                 storyStep === 10 ? "Formulate the Prompt Plot" :
                 storyStep === 13 ? "Script Dynamic Authored Openings" :
                 "Calibrate Image Prompts"}
              </h3>
              <p className="text-xs text-text-dim leading-relaxed max-w-2xl">
                {storyStep === 9 ? "Use the Collaborator Chat to design 2–3 scenario variants (alternate openings), shape the three-act structure, and decide on optional modules / timekeeping / status systems — or hit the button to start." :
                 storyStep === 10 ? "Send 'Generate performant instructions for prompt map' in the sideline chat to assemble verbatim continuity protocols." :
                 storyStep === 13 ? "Write the actual opening message for each scenario variant — these become ISK0's 'First Messages (Scenarios)' field. Use the chat, or hit the button to draft them." :
                 "Calibrate stable diffusion seeds and descriptions: 'Draft location portrait triggers' on the sideline chat."}
              </p>
            </div>
            <button 
              onClick={() => {
                const query = storyStep === 9 ? "[WORKSHOP ACTION — SCENARIO & SYSTEM PLANNING] Based on our locked premise, propose: (1) 2–3 scenario VARIANTS — distinct alternate openings/entry points that all lead into the same core story (these become our First Messages later); (2) the three-act STRUCTURE with early/mid/late hooks (this becomes the Prompt Plot's pacing/phase structure); and (3) a recommendation on whether the story benefits from optional MODULES, a timekeeping system, or a status dashboard. Capture the finished scenario variants wrapped in <<<USCS_BLOCK SCENARIOS>>> … <<<END USCS_BLOCK>>>." :
                              storyStep === 10 ? "Structure the prompt plot instructions and include Architect Protocols." :
                              storyStep === 13 ? "Draft the opening First Message for each scenario variant we defined — one authored opening per variant, per the USCS First Message rules. Wrap EACH finished message in its own <<<USCS_BLOCK FIRST_MESSAGE: N>>> … <<<END USCS_BLOCK>>> (numbered 1, 2, 3… per scenario) so they're captured and counted toward the budget." :
                              "Build detailed stable diffusion image prompts for our main cast.";
                askAssistant(query);
              }}
              className="px-6 py-3 bg-accent border border-accent text-black font-black text-[10px] uppercase tracking-widest rounded-xl hover:bg-transparent hover:text-accent transition-all shrink-0 active:scale-95"
            >
              TRIGGER_COHESION
            </button>
          </div>
        </div>
      );

    case 15: { // Compliance & Assembly
      // Calculate Compliance Integrity Score
      const modeCompliant = state.mode !== null;
      const toneCompliant = !!state.tone && !!state.settingType;
      const aestheticCompliant = !!state.artStyle && state.palette.length > 0;
      const groundingCompliant = state.groundingRules.length > 10;
      const personaCompliant = state.deliverables.characters.length > 0;
      const creativeCompliant = !!state.title && state.concept.length > 10;
      const chatCompliant = state.assistantHistory.length > 1;

      let score = 0;
      if (modeCompliant) score += 15;
      if (toneCompliant) score += 15;
      if (aestheticCompliant) score += 15;
      if (groundingCompliant) score += 15;
      if (personaCompliant) score += 15;
      if (creativeCompliant) score += 15;
      if (chatCompliant) score += 10;

      // Helper function to extract relevant summaries from history
      const parseSummaryFromChat = (keywords: string[], fallback: string) => {
        if (!state.assistantHistory || state.assistantHistory.length === 0) {
          return { text: fallback, sourcedFromChat: false };
        }
        
        // Collate assistant lines
        const sentences: string[] = [];
        state.assistantHistory.forEach(m => {
          if (m.role === "assistant") {
            const cleanText = m.content.replace(/```[\s\S]*?```/g, ""); // clear out code blocks
            const parts = cleanText.split(/(?<=[.!?])\s+/);
            parts.forEach(p => {
              const trimmed = p.trim().replace(/^[-*•\s]+/, "");
              if (trimmed.length > 15 && trimmed.length < 300) {
                sentences.push(trimmed);
              }
            });
          }
        });

        // Search for matching keyword sentences
        for (const sentence of sentences) {
          const lower = sentence.toLowerCase();
          const matched = keywords.some(kw => lower.includes(kw.toLowerCase()));
          if (matched) {
            return { text: sentence, sourcedFromChat: true };
          }
        }
        
        return { text: fallback, sourcedFromChat: false };
      };

      const checklistItems = [
        {
          id: "content_mode",
          title: "Content Guardrails & Mode",
          keywords: ["mode", "sfw", "nsfw", "heat level", "safeguard", "limit"],
          status: modeCompliant,
          fallback: "Safety thresholds and pacing regulations prevent accidental content overlaps, preserving narrative boundaries.",
          askQuery: "Could you summarize the SFW/NSFW constraints and heat level limits of our story?"
        },
        {
          id: "setting_tone",
          title: "Aetheric Setting & Vibe",
          keywords: ["setting", "tone", "atmosphere", "vibe", "style", "world", "genre", "cyberpunk", "fantasy", "historical", "contemporary"],
          status: toneCompliant,
          fallback: "Aetheric tone configuration establishes dialogue pacing frequency, ensuring standard output conformity.",
          askQuery: "Highlight the key tone notes and setting parameters you recommend for this universe."
        },
        {
          id: "aesthetics_palette",
          title: "Aesthetic Identity & Palette",
          keywords: ["palette", "colors", "art style", "visual", "aesthetic", "vector", "illustration", "anime"],
          status: aestheticCompliant,
          fallback: "Stylistic framework and color matrices calibrate custom portrait descriptors and illustration tags.",
          askQuery: "What is your artistic guidance based on our chosen palette and aesthetic mode?"
        },
        {
          id: "world_grounding",
          title: "Reality Safeguards & Grounding",
          keywords: ["grounding", "rules", "matrix", "law", "instead", "do_not", "prohibit", "constraint"],
          status: groundingCompliant,
          fallback: "Reality grounding rules establish hard 'DO_NOT / INSTEAD' mandates, disabling default self-narration states.",
          askQuery: "Explain the logical bounds of reality grounding and exceptions for our cast."
        },
        {
          id: "persona_registry",
          title: "Cast Persona & Emotional Registers",
          keywords: ["character", "persona", "profile", "cast", "role", "lyra", "kaelen", "sheets", "backstory"],
          status: personaCompliant,
          fallback: "Defined performance profiles govern emotional dynamic limits and character dialogue colors.",
          askQuery: "Provide a quick character motivation summary and performance direction tips."
        },
        {
          id: "identity_stamp",
          title: "Narrative Premise & Core Story",
          keywords: ["story", "plot", "manifest", "theme", "conflict", "synopsis", "story core"],
          status: creativeCompliant,
          fallback: "Central narrative summaries and title cards govern playability structures and thematic guidance.",
          askQuery: "What is your main structural outline recommendation based on our locked story title and concept?"
        },
        {
          id: "compiled_integrity",
          title: "Performer Prompt Assembly",
          keywords: ["assembly", "prompt plot", "verbatim", "instruction", "payload", "compile", "completion"],
          status: chatCompliant,
          fallback: "Aether-stream prompt packaging encloses compliance vectors within structural enclosures to prevent model drift.",
          askQuery: "Give a final review of the system instructions and compiler integrity safeguards."
        }
      ];

      return (
        <div className="space-y-12 py-6 font-sans">
          {/* Header */}
          <div className="space-y-2">
            <h2 className="text-4xl font-black uppercase tracking-tighter flex items-center gap-3">
              COMPLIANCE_&_ASSEMBLY <span className="text-xs bg-accent/20 text-accent px-2.5 py-1 rounded font-mono uppercase tracking-widest animate-pulse">SYSTEM_CHECK</span>
            </h2>
            <p className="text-text-muted font-medium text-sm">
              Verify compliance indices, analyze advisor feedback, and compile the final master prompt configuration.
            </p>
          </div>

          {/* Compliance Meter Visual Panel */}
          <div className="bg-card/40 border border-border p-8 rounded-3xl relative overflow-hidden shadow-2xl space-y-6">
            <div className="flex flex-col md:flex-row items-center justify-between gap-6">
              <div className="space-y-3 flex-1">
                <div className="flex items-center gap-2">
                  <Cpu className="text-accent w-4 h-4 animate-spin-slow" />
                  <span className="text-[10px] font-mono font-black text-accent uppercase tracking-[0.2em]">INTEGRITY_CHECKPOINT_V6.1</span>
                </div>
                
                <h3 className="text-2xl font-black uppercase tracking-tight">
                  {score >= 85 ? "MASTER_INTEGRITY_VERIFIED" : "ADVISORY_CALIBRATION_ACTIVE"}
                </h3>
                
                <p className="text-xs text-text-dim leading-relaxed max-w-xl">
                  {score >= 85 
                    ? "All critical visual identity profiles, pacing thresholds, grounding rules, and dialogue matrices are fully synced. Ready for master engine orchestration."
                    : "The story engine has detected missing parameters or unsynced dialogue lines. Ask the collaborator on the sideline to finalize your calibration matrices."
                  }
                </p>
              </div>

              {/* Glowing Calibration Dial */}
              <div className="relative shrink-0 flex flex-col items-center justify-center p-4 bg-header/20 border border-white/5 rounded-2xl w-44 h-44">
                <div className="text-center space-y-1 relative z-10">
                  <span className="text-[9px] font-mono uppercase tracking-widest text-[#fbbf24] block">COMPLIANCE</span>
                  <div className="text-5xl font-black tracking-tighter text-text-main font-mono">
                    {score}%
                  </div>
                  <span className="text-[8px] uppercase tracking-widest text-accent font-black">
                    {score >= 85 ? "NOMINAL" : "TUNING"}
                  </span>
                </div>
                {/* Visual Ring effect */}
                <div 
                  className="absolute inset-2 border-2 rounded-full border-dashed opacity-20 animate-spin-slow" 
                  style={{ borderColor: state.palette[2] || "#14b8a6" }}
                />
              </div>
            </div>

            {/* Glowing Progress bar */}
            <div className="space-y-2">
              <div className="flex justify-between text-[9px] font-mono text-text-muted uppercase tracking-widest">
                <span>Continuity Buffer</span>
                <span>{score}/100 INGESTED</span>
              </div>
              <div className="w-full bg-bg border border-border/60 h-4 rounded-full overflow-hidden p-0.5 relative">
                <div 
                  className="h-full rounded-full bg-gradient-to-r from-accent via-emerald-400 to-[#fbbf24] transition-all duration-1000 relative shadow-[0_0_12px_rgba(20,184,166,0.5)]"
                  style={{ width: `${score}%` }}
                >
                  <div className="absolute inset-0 bg-white/10 animate-pulse pointer-events-none" />
                </div>
              </div>
            </div>
          </div>

          {/* Checklist Cards with Summaries from Chat */}
          <div className="space-y-6">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-accent" />
              <span className="text-xs font-black uppercase tracking-widest text-text-main">
                COMPLIANCE REQUIREMENTS CHECKLIST
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {checklistItems.map((item, idx) => {
                const parsed = parseSummaryFromChat(item.keywords, item.fallback);
                return (
                  <div 
                    key={item.id} 
                    className={`bg-card/30 border p-6 rounded-3xl relative overflow-hidden transition-all duration-300 flex flex-col justify-between group hover:border-accent/40 hover:bg-card/50 ${
                      item.status ? "border-emerald-500/10" : "border-amber-500/10"
                    }`}
                  >
                    {/* Status side bar stripe */}
                    <div className={`absolute top-0 left-0 w-1.5 h-full transition-opacity ${
                      item.status ? "bg-emerald-400 opacity-20 group-hover:opacity-60" : "bg-[#fbbf24] opacity-20 group-hover:opacity-60"
                    }`} />

                    <div className="space-y-4">
                      {/* Badge / Title Row */}
                      <div className="flex items-center justify-between gap-4">
                        <h4 className="text-sm font-black uppercase tracking-tight text-text-main flex-1">
                          {item.title}
                        </h4>
                        
                        <div className="flex items-center gap-2 shrink-0">
                          {item.status ? (
                            <span className="flex items-center gap-1.5 px-2.5 py-1 bg-emerald-400/10 border border-emerald-400/20 text-emerald-400 text-[8px] font-mono uppercase font-black tracking-widest rounded-lg">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> Compliant
                            </span>
                          ) : (
                            <span className="flex items-center gap-1.5 px-2.5 py-1 bg-[#fbbf24]/10 border border-[#fbbf24]/20 text-[#fbbf24] text-[8px] font-mono uppercase font-black tracking-widest rounded-lg">
                              <span className="w-1.5 h-1.5 rounded-full bg-[#fbbf24] animate-pulse" /> PENDING
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Brief Summary Box */}
                      <div className="p-4 rounded-2xl bg-header/20 border border-border/40 space-y-2">
                        <p className="text-xs text-text-dim leading-relaxed font-sans">
                          {parsed.text}
                        </p>
                        
                        {/* Feed Info */}
                        {parsed.sourcedFromChat ? (
                          <div className="flex items-center gap-1.5 pt-1 text-[8px] text-accent/80 font-mono font-black uppercase tracking-widest">
                            <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent" />
                            PULLED FROM COLLABORATOR ADVISORY CHAT
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5 pt-1 text-[8px] text-text-muted font-mono uppercase tracking-widest">
                            <span className="inline-block w-1.5 h-1.5 rounded-full bg-white/10" />
                            CALIBRATION FALLBACK RULES
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Interaction Button at the bottom */}
                    <div className="mt-4 pt-3 border-t border-border/30 flex items-center justify-between gap-4">
                      <span className="text-[8px] font-mono text-text-muted">REQ_RULE::0{idx+1}</span>
                      
                      <button 
                        onClick={() => askAssistant(item.askQuery)}
                        className="opacity-0 group-hover:opacity-100 transition-opacity text-[8px] flex items-center gap-1 bg-accent/10 border border-accent/20 hover:bg-accent/20 text-accent font-mono uppercase tracking-widest px-2 py-1 rounded"
                        title="Query Collaborator Chat for guidance"
                      >
                        <MessageSquare className="w-3 h-3" /> CHAT_SYNC
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Compilation CTA Trigger */}
          <div className="bg-card hover:border-accent/30 border border-border p-8 rounded-3xl relative overflow-hidden flex flex-col md:flex-row gap-6 items-center shadow-2xl transition-colors">
            <div className="w-16 h-16 bg-accent/10 rounded-full flex items-center justify-center shrink-0">
              <Sparkles className="w-8 h-8 text-accent opacity-80 animate-bounce" />
            </div>
            <div className="space-y-2 text-center md:text-left flex-1">
              <span className="text-[8px] font-mono font-black text-accent uppercase tracking-[0.3em] block">
                COMPILATION_PROTOCOL_V6.1 :: READY
              </span>
              <h3 className="text-lg font-black uppercase tracking-tight">
                Package Story & Compile Master Prompt
              </h3>
              <p className="text-xs text-text-dim leading-relaxed max-w-2xl">
                The entire prompt matrix is fully prepped. Trigger cohesion compiler to build a copy-paste-ready narrative instruction payload for the Performer LLM.
              </p>
            </div>
            <button 
              onClick={() => {
                askAssistant("Assemble and print the finalized prompt payload for copying.");
              }}
              className="px-6 py-3 bg-accent border border-accent text-black font-black text-[10px] uppercase tracking-widest rounded-xl hover:bg-transparent hover:text-accent transition-all shrink-0 active:scale-95"
            >
              COMPILE_MASTER_BUILD
            </button>
          </div>
        </div>
      );
    }


    default:
      return (
        <div className="h-96 flex flex-col items-center justify-center space-y-4 border-2 border-dashed border-white/5 rounded-3xl">
          <Settings className="w-12 h-12 text-white/10 animate-spin-slow" />
          <p className="text-white/20 font-mono text-sm tracking-widest uppercase">Initializing Module {state.step + 1}...</p>
        </div>
      );
  }
}

// Add this to your global CSS or in index.css
// @keyframes spin-slow {
//   from { transform: rotate(0deg); }
//   to { transform: rotate(360deg); }
// }
// .animate-spin-slow { animation: spin-slow 8s linear infinite; }

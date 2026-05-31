/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
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
  EyeOff
} from "lucide-react";

// --- Types ---

type Mode = "SFW" | "NSFW";
type HeatLevel = 1 | 2 | 3 | 4 | 5;

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface StoryState {
  step: number;
  mode: Mode | null;
  heatLevel: HeatLevel;
  isDMOnly: boolean;
  concept: string;
  settingType: string;
  tone: string;
  artStyle: string;
  imageService: string;
  palette: string[];
  aestheticMode: "Literary" | "Structured" | "Chaos";
  groundingRules: string;
  title: string;
  characters: any[];
  assistantHistory: Message[];
  isAssistantLoading: boolean;
  aiProvider: "gemini" | "anthropic" | "ollama";
  modelSettings: {
    model: string;
    temperature: number;
    maxTokens: number;
    ollamaBaseUrl?: string;
    geminiApiKey?: string;
    anthropicApiKey?: string;
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
  "Scenarios",
  "Prompt Plot",
  "Guidelines",
  "Reminders",
  "First Message",
  "Image Prompts",
  "Compliance & Assembly"
];

const PROVIDERS = {
  gemini: {
    name: "Google Gemini",
    models: ["gemini-3-flash-preview", "gemini-3.1-pro-preview", "gemini-3.1-flash-lite"],
  },
  anthropic: {
    name: "Anthropic Claude",
    models: ["claude-3-5-sonnet-20241022", "claude-3-5-haiku-20241022", "claude-3-opus-20240229"],
  },
  ollama: {
    name: "Local Ollama",
    models: ["llama3", "gemma2", "mistral", "phi3", "deepseek-coder"],
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

const USCS_SYSTEM_PROMPT = `================================================================================
ISK0 / ISEKAI ZERO — ULTIMATE STORY CREATION SYSTEM v6.1 PIPELINE ENGINE
================================================================================
You are the under-the-hood Modus Operandi for this story creation workshop.
You function exclusively as a professional story architecture compiler and creative collaborator. 
Your role is to guide the creator step-by-step through the structured USCS v6.1 pipeline to build a complete, highly polished, copy-paste-ready story package.

================================================================================
CRITICAL WORKSHOP CORE DIRECTIVE — NEVER VIOLATE
================================================================================
✦ YOU ARE ONLY CO-WRITING AND ARCHITECTING. YOU WILL NOT ROLEPLAY AS A CHARACTER.
✦ You are NEVER speaking as any character, simulating an interactive dialogue, or performing the scene.
✦ You are working at the META LEVEL. The story is the product. You are not a participant in it.
✦ Every block of text, narrative, or guidelines you generate is CRAFT OUTPUT (design documents, instructions, template code) intended to be executed by a SEPARATE AI model later.
✦ DO NOT JUMP TO NARRATING THE GAME FOR THE USER. When the user selects or inputs something, always discuss the structural choice, provide suggestions, refine drafts of the technical documents, and guide them through the current step.

================================================================================
THE TWO SEPARATE LAYERS
================================================================================
1. THE WORKSHOP LAYER:
   - Your direct dialog with the Creator. "Direct collaboration" mode.
   - Direct, helpful, professional language. Use "we" and "let's" to develop ideas, suggest options, ask for feedback, and refine structures.
2. THE TEMPLATE LAYER:
   - Structured craft output: character cards (HTML), character prompt descriptions (Part B), Prompt Plots, Prompt Guidelines (DO NOT/INSTEAD rules), AI Reminders, image prompts, first messages.
   - These must be written in the third person FOR a different, performer AI system to execute later. 
   - Never write self-instructions. Never mix these layers.

================================================================================
USCS PIPELINE - THE 15 WORKSHOP BUILD STEPS
================================================================================
Follow the pipeline build order rigorously. Do not skip or combine steps unless requested. Focus entirely on the current Step defined in the app state.

- STEP 1 (Mode Selection): Mode Selection (SFW vs. NSFW). Locked with appropriate Heat Level (1-5).
- STEP 2 (Concept Intake): Premises, primary character ideas, tone, and the Emotional Mandate archetype ("What does the player feel when they set the phone down? Melancholy/Resonance, Tragedy/Investment, or Power Fantasy/Gratification").
- STEP 3 (Setting & Tone): Verify setting type rules (Contemporary, Fantasy, Isekai, Sci-Fi, Historical, Modern Supernatural, Horror, Post-Apocalyptic). Establish DO NOT / INSTEAD grounding rules. No secondary school settings in NSFW Mode.
- STEP 4 (Art Style Profile): Establish art style (Literary, Structured, or Chaos aesthetic), image generation syntax, and theme.
- STEP 5 (Palette & Identity): Formalize 4-5 hex colors for HTML visuals.
- STEP 6 (World Grounding): Establish the rules using DO NOT / INSTEAD framework. Pair every prohibition with a replacement behavior.
- STEP 7 (Title & Summary): Propose 3 titles. Write one 20-word Plot Summary + 20-word character summaries.
- STEP 8 (Plot Card): Code the Plot Card HTML cleanly.
- STEP 9 (Character Sheets): Design Part A (HTML card) and Part B (AI prompt description) for EVERY character. 1500w max for primary, 800w for supporting. Use G1itzh 4-trait core (3 surface clustering + 1 disruptor), physical/clothing specifications, speech & mannerisms, and wants/needs.
- STEP 10 (Scenarios): Design 2-3 scenario entry points (Witness, Eavesdropper, Stumbler) and the 9 Three-Act Hooks.
- STEP 11 (Prompt Plot): Output the Performer instructions + include the Architect Protocol block verbatim.
- STEP 12 (Guidelines): 15+ Guidelines detailing positive directives and negative constraints. **Guidelines MUST integrate the DO NOT/INSTEAD rulesets defined in World Grounding**.
- STEP 13 (Reminders): 10+ prioritized Reminders (starting with the North Star emotional target).
- STEP 14 (First Message): Write the authored openings for each scenario (300-500w).
- STEP 15 (Image Prompts): Portrait + Cover + Title Edit + Cover Video + 10 Emotion Edits per character + Location prompts.
- STEP 16 (Compliance & Assembly): Final compilation of all blocks.

================================================================================
COOPERATIVE AUTO-ADVANCE PROTOCOL
================================================================================
When you and the creator have fully finalized the deliverables of the current step and it is technically complete and locked in according to the manual rules:
- YOU MUST APPEND the exact token [SYNC_PROCEED] at the very end of your response.
- This token acts as a trigger to physically advance the UI to the next module. 
- Do not append [SYNC_PROCEED] until the current block is completely polished and agreed upon.

================================================================================
NAMING PROTOCOL & LLM GRAVITY WELL OVERRIDE
================================================================================
- Prohibited Names: Kael, Elara, Lyra, Zara, Theron, Aldric, Mira, Seraphina, Caelum, Riven, Daelin, Evander, Thalion, Vaelith, Sylvara, and all names ending in -wyn, -iel, -ael, -ara.
- Every name must have a documented cultural/linguistic origin and etymological reasoning.

================================================================================
HTML & CARD DESIGN RULES
================================================================================
- Inline style attributes only (no <style> blocks or CSS classes). No <html> or <body> containers.
- All containers with padding/border must use 'box-sizing: border-box;'.
- Use No-Background Border Frame for images to prevent mobile subpixel hair-lines. Max width: 300px.
`;

const IMAGE_SERVICES = ["Midjourney", "DALL-E 3", "Stable Diffusion", "NovelAI", "Flux", "Other"];

// --- Components ---

export default function App() {
  const [showSettings, setShowSettings] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [isXL, setIsXL] = useState(false);
  const [isChatDetached, setIsChatDetached] = useState(false);
  const [chatPosition, setChatPosition] = useState({ x: 0, y: 0 });
  const [chatSize, setChatSize] = useState({ width: 400, height: 600 });
  const [dockedChatWidth, setDockedChatWidth] = useState(384); // Default w-96
  const [hoverHeatLevel, setHoverHeatLevel] = useState<HeatLevel | null>(null);

  useEffect(() => {
    const checkScreen = () => {
      setIsMobile(window.innerWidth < 1024);
      setIsXL(window.innerWidth >= 1280);
    };
    checkScreen();
    window.addEventListener('resize', checkScreen);
    return () => window.removeEventListener('resize', checkScreen);
  }, []);

  const [lastSyncedState, setLastSyncedState] = useState({
    mode: null as Mode | null,
    heatLevel: 1 as HeatLevel,
    isDMOnly: false,
    concept: "",
    settingType: "",
    tone: "",
    artStyle: "Anime/VN Style",
    imageService: "Midjourney",
    palette: ["#1a1a24", "#f8f8f8", "#14b8a6", "#f43f5e", "#fbbf24"],
    aestheticMode: "Structured" as "Literary" | "Structured" | "Chaos",
    groundingRules: "",
    title: "",
    step: 0
  });

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

  const [state, setState] = useState<StoryState>({
    step: 0,
    mode: null,
    heatLevel: 1,
    isDMOnly: false,
    concept: "",
    settingType: "",
    tone: "",
    artStyle: "Anime/VN Style",
    imageService: "Midjourney",
    palette: ["#1a1a24", "#f8f8f8", "#14b8a6", "#f43f5e", "#fbbf24"],
    aestheticMode: "Structured",
    groundingRules: "",
    title: "",
    characters: [],
    assistantHistory: [],
    isAssistantLoading: false,
    aiProvider: "gemini",
    modelSettings: {
      model: "gemini-3-flash-preview",
      temperature: 1.0,
      maxTokens: 4096,
      geminiApiKey: "",
      anthropicApiKey: "",
    },
  });

  const [localOllamaModels, setLocalOllamaModels] = useState<string[]>([]);
  const [ollamaError, setOllamaError] = useState<string | null>(null);
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [showGeminiKey, setShowGeminiKey] = useState(false);
  const [showAnthropicKey, setShowAnthropicKey] = useState(false);

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

  const isInterfaceMode = state.step >= 6;

  const isSyncNeeded = 
    state.mode !== lastSyncedState.mode ||
    state.heatLevel !== lastSyncedState.heatLevel ||
    state.isDMOnly !== lastSyncedState.isDMOnly ||
    state.concept !== lastSyncedState.concept ||
    state.settingType !== lastSyncedState.settingType ||
    state.tone !== lastSyncedState.tone ||
    state.artStyle !== lastSyncedState.artStyle ||
    state.palette.join(",") !== lastSyncedState.palette.join(",") ||
    state.aestheticMode !== lastSyncedState.aestheticMode ||
    state.groundingRules !== lastSyncedState.groundingRules ||
    state.title !== lastSyncedState.title ||
    state.step !== lastSyncedState.step;

  const syncDeskstateToAI = () => {
    const updatedFields: string[] = [];
    if (state.mode !== lastSyncedState.mode) updatedFields.push(`Mode: ${state.mode || "None"}`);
    if (state.heatLevel !== lastSyncedState.heatLevel) updatedFields.push(`Heat: ${state.heatLevel}`);
    if (state.isDMOnly !== lastSyncedState.isDMOnly) updatedFields.push(`Trace Strategy: ${state.isDMOnly ? "Dungeon_Mind" : "Full_Story_Package"}`);
    if (state.concept !== lastSyncedState.concept) updatedFields.push(`Narrative Seed modified`);
    if (state.settingType !== lastSyncedState.settingType) updatedFields.push(`Setting: ${state.settingType || "None"}`);
    if (state.tone !== lastSyncedState.tone) updatedFields.push(`Tone: ${state.tone || "None"}`);
    if (state.artStyle !== lastSyncedState.artStyle) updatedFields.push(`Style: ${state.artStyle}`);
    if (state.palette.join(",") !== lastSyncedState.palette.join(",")) updatedFields.push(`Visual Palette updated`);
    if (state.aestheticMode !== lastSyncedState.aestheticMode) updatedFields.push(`Aesthetic Mode: ${state.aestheticMode}`);
    if (state.groundingRules !== lastSyncedState.groundingRules) updatedFields.push(`Grounding Rules modified`);
    if (state.title !== lastSyncedState.title) updatedFields.push(`Title: ${state.title || "Untitled"}`);
    if (state.step !== lastSyncedState.step) updatedFields.push(`Moved to Step: ${state.step + 1} (${STEPS[state.step]})`);

    setLastSyncedState({
      mode: state.mode,
      heatLevel: state.heatLevel,
      isDMOnly: state.isDMOnly,
      concept: state.concept,
      settingType: state.settingType,
      tone: state.tone,
      artStyle: state.artStyle,
      palette: [...state.palette],
      aestheticMode: state.aestheticMode,
      groundingRules: state.groundingRules,
      title: state.title,
      step: state.step
    });

    triggerToast(`Workspace parameters synced to collaborator!`, "ui-to-ai");

    const syncPrompt = `[SYSTEM ACTION - MANUAL STATE SYNCED]
The user updated the workspace deskstate. Here are the current parameters in real-time:
- Active Step: Step ${state.step + 1} ("${STEPS[state.step]}")
- Narrative Mode: ${state.mode || "Pending Selection"} (${state.isDMOnly ? "Dungeon Mind Trace" : "Full Story Package"})
- Thermal Heat Level: ${state.heatLevel}/5
- Setting Type Classification: ${state.settingType || "Not established"}
- Architectural Tone: ${state.tone || "Not established"}
- Visual Art Style: ${state.artStyle} (${state.aestheticMode} approach)
- Chromatic HEX Palette: [${state.palette.join(', ')}]
- Narrative Premise Seed: "${state.concept || "(Empty)"}"
- Reality Protocols: "${state.groundingRules || "(None)"}"
- Draft Title: "${state.title || "Untitled"}"

Please acknowledge these updated options, explicitly address the modified parameters (${updatedFields.length > 0 ? updatedFields.join(', ') : 'no key differences'}), and guide the creator forward on Step ${state.step + 1} ("${STEPS[state.step]}").`;

    askAssistant(syncPrompt);
  };

  const nextStep = () => setState(prev => ({ ...prev, step: Math.min(prev.step + 1, STEPS.length - 1) }));
  const prevStep = () => setState(prev => ({ ...prev, step: Math.max(prev.step - 1, 0) }));

  const askAssistant = async (prompt: string) => {
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
          provider: state.aiProvider,
          modelSettings: state.modelSettings,
          history: state.assistantHistory.map(m => ({
            role: m.role === "assistant" ? "model" : "user",
            parts: [{ text: m.content }]
          })),
          systemInstruction: `${USCS_SYSTEM_PROMPT}

================================================================================
CURRENT WORKSHOP DESKSTATE (COLLABORATOR SYNC CONTEXT)
================================================================================
- CURRENT STEP: ${STEPS[state.step]}
- Mode: ${state.mode || "Pending"}
- Heat Level: ${state.heatLevel}
- Setting: ${state.settingType || "Pending"}
- Concept: ${state.concept || "Variable"}
- Tone: ${state.tone || "Undefined"}
- Reality Protocols / Grounding Rules: 
${state.groundingRules || "No strict rules established yet."}

================================================================================
REAL-TIME UI SYNCHRONIZATION COMMANDS
================================================================================
You have direct, two-way control over the workshop UI. Whenever you want to suggest, lock in, or update a setting so the user sees it immediately on their screen, include any of the following tags anywhere in your response. The engine will parse them out and update the React State in real-time, preventing the user from needing to copy-paste:

✦ [SET_MODE: SFW] or [SET_MODE: NSFW]
✦ [SET_HEAT: <1-5>]
✦ [SET_SETTING: <Setting Name>] (e.g., [SET_SETTING: Fantasy / High Fantasy] or [SET_SETTING: Isekai] or [SET_SETTING: Post-Apocalyptic / Survival])
✦ [SET_TITLE: <Title Text>]
✦ [SET_CONCEPT: <Concept Text>]
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

DIAGNOSTIC WORKSHOP RESPONSE MANDATE:
1. Actively guide and collaborate with the user *exclusively* on the deliverables for the CURRENT STEP: "${STEPS[state.step]}". Use discussion, suggestions, and drafts.
2. DO NOT perform the story, write character dialogue, or introduce simulated turns like "What do you do, Hunter?". You are the co-author, not the player!
3. If the step is fully complete and agreed, conclude your response with the token [SYNC_PROCEED] to advance the workspace.
`
        })
      });

      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || "Communication link severed");
      }
      
      if (data.text) {
        const assistantMessage: Message = { role: "assistant", content: data.text };
        
        // Match tag functions for AI-to-UI Sync in real-time
        const updates: any = {};
        const toastMsgs: string[] = [];

        const modeMatch = data.text.match(/\[SET_MODE:\s*(SFW|NSFW)\]/i);
        if (modeMatch) {
          updates.mode = modeMatch[1].toUpperCase() as Mode;
          toastMsgs.push(`Mode: ${updates.mode}`);
        }

        const heatMatch = data.text.match(/\[SET_HEAT:\s*([1-5])\]/i);
        if (heatMatch) {
          updates.heatLevel = parseInt(heatMatch[1], 10) as HeatLevel;
          toastMsgs.push(`Heat: ${updates.heatLevel}/5`);
        }

        const titleMatch = data.text.match(/\[SET_TITLE:\s*([^\]\n]+)\]/i);
        if (titleMatch) {
          updates.title = titleMatch[1].trim();
          toastMsgs.push(`Title: "${updates.title}"`);
        }

        const conceptMatch = data.text.match(/\[SET_CONCEPT:\s*([^\]]+)\]/i);
        if (conceptMatch) {
          updates.concept = conceptMatch[1].trim();
          toastMsgs.push("Premise Concept");
        }

        const settingMatch = data.text.match(/\[SET_SETTING:\s*([^\]\n]+)\]/i);
        if (settingMatch) {
          updates.settingType = settingMatch[1].trim();
          toastMsgs.push(`Setting: ${updates.settingType}`);
        }

        const toneMatch = data.text.match(/\[SET_TONE:\s*([^\]\n]+)\]/i);
        if (toneMatch) {
          updates.tone = toneMatch[1].trim();
          toastMsgs.push(`Tone: ${updates.tone}`);
        }

        const rulesMatch = data.text.match(/\[SET_RULES:\s*([^\]]+)\]/i);
        if (rulesMatch) {
          updates.groundingRules = rulesMatch[1].trim();
          toastMsgs.push("Reality Protocols");
        }

        const aestheticMatch = data.text.match(/\[SET_AESTHETIC:\s*(Literary|Structured|Chaos)\]/i);
        if (aestheticMatch) {
          const modeVal = aestheticMatch[1].trim();
          updates.aestheticMode = (modeVal.charAt(0).toUpperCase() + modeVal.slice(1).toLowerCase()) as any;
          toastMsgs.push(`Aesthetic: ${updates.aestheticMode}`);
        }

        const artStyleMatch = data.text.match(/\[SET_ART_STYLE:\s*([^\]\n]+)\]/i);
        if (artStyleMatch) {
          updates.artStyle = artStyleMatch[1].trim();
          toastMsgs.push(`Art Style: ${updates.artStyle}`);
        }

        const paletteMatch = data.text.match(/\[SET_PALETTE:\s*([^\]]+)\]/i);
        if (paletteMatch) {
          const colors = paletteMatch[1].split(",").map((c: string) => c.trim()).filter((c: string) => c.startsWith("#") && (c.length === 7 || c.length === 4));
          if (colors.length >= 3) {
            updates.palette = colors;
            toastMsgs.push("Palette Config");
          }
        }

        setState(s => {
          const nextState = {
            ...s,
            ...updates,
            assistantHistory: [...s.assistantHistory, assistantMessage],
            isAssistantLoading: false
          };

          // Update lastSyncedState for the values that were just updated by the AI,
          // so we don't trigger the manual unsynced banner warnings
          setLastSyncedState(ls => ({
            ...ls,
            ...updates,
            step: s.step
          }));

          return nextState;
        });

        if (toastMsgs.length > 0) {
          triggerToast(`Matrix updated parameters: ${toastMsgs.join(", ")}`, "ai-to-ui");
        }

        // Detect Auto-advance trigger
        if (data.text.includes("[SYNC_PROCEED]")) {
          setTimeout(nextStep, 1500);
        }
      } else {
        throw new Error("Empty response from matrix");
      }
    } catch (error: any) {
      console.error(error);
      setState(s => ({ 
        ...s, 
        isAssistantLoading: false,
        assistantHistory: [...s.assistantHistory, { role: "assistant", content: `ERROR_SIGNAL: ${error.message || "Unknown anomaly"}` }]
      }));
    }
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
              <span className="text-[8px] lg:text-[10px] font-mono opacity-50 uppercase tracking-[0.2em]">Story Pipeline v6.1</span>
            </div>
          </div>
          <div className="h-4 w-[1px] bg-border hidden md:block"></div>
          <div className="hidden md:flex flex-col">
            <span className="text-[10px] uppercase tracking-widest text-label">Project</span>
            <span className="text-sm font-mono tracking-tighter">ISK0-FW-992</span>
          </div>
        </div>
        <div className="flex gap-1.5 sm:gap-4 items-center">
          <button 
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            className={`p-2 lg:hidden hover:bg-white/5 rounded-md transition-all ${isSidebarOpen ? 'bg-accent/10 text-accent' : 'text-label'}`}
          >
            <BookOpen className="w-5 h-5" />
          </button>
          <div className="px-2 lg:px-3 py-1 bg-header border border-border rounded flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse"></div>
            <span className="text-[9px] lg:text-[10px] font-bold text-accent uppercase tracking-widest truncate max-w-[80px] sm:max-w-none">
              {STEPS[state.step]}
            </span>
          </div>
          <button 
            onClick={() => setIsChatOpen(!isChatOpen)}
            className={`p-2 xl:hidden hover:bg-white/5 rounded-md transition-all ${isChatOpen ? 'bg-accent/10 text-accent' : 'text-label'}`}
          >
            <MessageSquare className="w-5 h-5" />
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
            disabled={state.step === STEPS.length - 1 || (state.step === 0 && !state.mode)}
            className="flex px-4 lg:px-6 py-2 bg-accent text-black rounded-lg items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] hover:bg-white active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed transition-all shadow-[0_0_20px_rgba(20,184,166,0.3)] z-50 border border-accent/50"
          >
            <span>NEXT</span>
            <ChevronRight className="w-3 h-3 font-black" />
          </button>
        </div>
      </header>

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
                {STEPS.map((step, idx) => (
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

              {isInterfaceMode && (
                <div className="border-t border-border/40 pt-4 mt-auto shrink-0">
                  <StatusMonitor state={state} />
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
        <section className="flex-1 overflow-y-auto p-4 lg:p-8 flex flex-col items-center">
          <div className="w-full max-w-4xl space-y-8 pb-32">
            <AnimatePresence mode="wait">
              <motion.div
                key={state.step}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
              >
                {renderStep(state, setState, nextStep, askAssistant, setHoverHeatLevel, hoverHeatLevel, isSyncNeeded, syncDeskstateToAI)}
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
                x: chatPosition.x, 
                y: chatPosition.y,
                width: chatSize.width,
                height: chatSize.height,
                position: 'fixed',
                top: 100,
                right: 40,
                zIndex: 1000,
                borderRadius: '24px',
                border: '1px solid rgba(255,255,255,0.1)',
                boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)',
                backgroundColor: '#18181b',
                display: 'flex',
                flexDirection: 'column'
              } : { 
                x: 0,
                width: dockedChatWidth,
              }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className={`overflow-hidden flex flex-col min-w-0 max-h-full ${isChatDetached ? '' : 'fixed inset-y-0 right-0 border-l border-border bg-[#18181b] z-[70] xl:z-40 h-full'} ${isChatOpen ? 'flex' : 'hidden xl:flex'} ${isXL && !isChatDetached ? 'relative xl:inset-auto xl:bg-header/40 xl:border-l-0 xl:h-full' : 'w-full sm:w-auto'}`}
              style={!isChatDetached ? { width: dockedChatWidth } : {}}
            >
              {/* Resize Handle for Docked View */}
              {!isChatDetached && isXL && (
                <div 
                  className="absolute left-0 top-0 bottom-0 w-1 cursor-ew-resize hover:bg-accent/40 transition-colors z-[80]"
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
                setState={setState} 
                askAssistant={askAssistant} 
                setIsChatOpen={setIsChatOpen}
                isDetached={isChatDetached}
                setIsDetached={setIsChatDetached}
                isSyncNeeded={isSyncNeeded}
                syncDeskstateToAI={syncDeskstateToAI}
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
            <span>VERSION 6.1.0</span>
            <span>KERNEL: FW-992</span>
          </div>
        </div>
        
        <div className="hidden xs:flex gap-1 items-center">
          <div className="flex gap-1 mr-4">
            {STEPS.map((_, idx) => (
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
          <span className="text-[10px] font-mono text-text-dim/50 uppercase tracking-widest hidden lg:block">System_Stability: 99.2%</span>
        </div>

        <div className="w-32 hidden sm:block"></div>
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
              className="relative w-full max-w-xl bg-header border border-border rounded-3xl p-8 shadow-2xl "
            >
              <div className="absolute top-0 left-0 w-full h-1 bg-accent" />
              <div className="flex justify-between items-start mb-8">
                <div className="space-y-1 text-left">
                  <h2 className="text-xl font-black uppercase tracking-tighter">Model_Configuration</h2>
                  <p className="text-[10px] text-label font-bold uppercase tracking-widest">Aether_Core System Settings</p>
                </div>
                <button 
                  onClick={() => setShowSettings(false)}
                  className="p-2 hover:bg-white/5 rounded-lg text-label hover:text-white transition-all"
                >
                  <ChevronRight className="w-5 h-5 rotate-180" />
                </button>
              </div>

              <div className="space-y-8 text-left">
                {/* Provider Selection */}
                <div className="space-y-4">
                  <label className="text-[10px] uppercase tracking-[0.3em] font-black text-label block">AI_Provider</label>
                  <div className="grid grid-cols-3 gap-3">
                    {(Object.keys(PROVIDERS) as Array<keyof typeof PROVIDERS>).map((p) => (
                      <button
                        key={p}
                        onClick={() => setState(s => ({ 
                          ...s, 
                          aiProvider: p,
                          modelSettings: { 
                            ...s.modelSettings, 
                            model: PROVIDERS[p].models[0],
                            ollamaBaseUrl: s.modelSettings.ollamaBaseUrl || "http://localhost:11434"
                          }
                        }))}
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
                      <p className="text-[9px] text-text-dim leading-normal">
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
                      <p className="text-[9px] text-text-dim leading-normal">
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
                      <p className="text-[9px] text-text-dim leading-normal">
                        💡 Key is processed server-side so it is never exposed in the browser's developer console. Leave empty to use server environment variable default.
                      </p>
                    </div>
                  </div>
                )}

                {/* Model Selection */}
                <div className="space-y-4">
                  <label className="text-[10px] uppercase tracking-[0.3em] font-black text-label block">Target_Model</label>
                  
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
                          {localOllamaModels.map((m) => (
                            <button
                              key={m}
                              onClick={() => setState(s => ({ 
                                ...s, 
                                modelSettings: { ...s.modelSettings, model: m }
                              }))}
                              className={`p-3 rounded-lg border text-[11px] font-mono text-left transition-all flex items-center justify-between ${
                                state.modelSettings.model === m 
                                  ? "border-accent bg-accent/5 text-accent" 
                                  : "border-border bg-bg text-text-muted hover:bg-white/5 hover:text-text-main"
                              }`}
                            >
                              <span>{m}</span>
                              <span className="text-[8px] bg-accent/15 text-accent px-1.5 py-0.5 rounded uppercase font-bold tracking-widest font-sans">Installed</span>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 gap-2">
                          {PROVIDERS[state.aiProvider].models.map((m) => (
                            <button
                              key={m}
                              onClick={() => setState(s => ({ 
                                ...s, 
                                modelSettings: { ...s.modelSettings, model: m }
                              }))}
                              className={`p-3 rounded-lg border text-[11px] font-mono text-left transition-all ${
                                state.modelSettings.model === m 
                                  ? "border-accent bg-accent/5 text-accent" 
                                  : "border-border bg-bg text-text-dim hover:bg-white/5 hover:text-text-muted"
                              }`}
                            >
                              {m}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-2">
                      {PROVIDERS[state.aiProvider].models.map((m) => (
                        <button
                          key={m}
                          onClick={() => setState(s => ({ 
                            ...s, 
                            modelSettings: { ...s.modelSettings, model: m }
                          }))}
                          className={`p-3 rounded-lg border text-[11px] font-mono text-left transition-all ${
                            state.modelSettings.model === m 
                              ? "border-accent bg-accent/5 text-accent" 
                              : "border-border bg-bg text-text-dim hover:bg-white/5 hover:text-text-muted"
                          }`}
                        >
                          {m}
                        </button>
                      ))}
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
                  </div>
                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <label className="text-[10px] uppercase tracking-[0.2em] font-black text-label">Max_Tokens</label>
                      <span className="text-[10px] font-mono text-accent">{state.modelSettings.maxTokens}</span>
                    </div>
                    <input 
                      type="range"
                      min="256"
                      max="8192"
                      step="256"
                      value={state.modelSettings.maxTokens}
                      onChange={(e) => setState(s => ({
                        ...s,
                        modelSettings: { ...s.modelSettings, maxTokens: parseInt(e.target.value) }
                      }))}
                      className="w-full h-1 bg-border rounded-full appearance-none accent-accent cursor-pointer"
                    />
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

function CollaboratorChat({ state, setState, askAssistant, setIsChatOpen, isDetached, setIsDetached, isSyncNeeded, syncDeskstateToAI }: { 
  state: StoryState, 
  setState: React.Dispatch<React.SetStateAction<StoryState>>, 
  askAssistant: (p: string) => Promise<void>,
  setIsChatOpen: (o: boolean) => void,
  isDetached?: boolean,
  setIsDetached?: (d: boolean) => void,
  isSyncNeeded?: boolean,
  syncDeskstateToAI?: () => void
}) {
  return (
    <>
      <div className={`p-4 border-b border-border bg-header/60 flex items-center justify-between shrink-0 ${isDetached ? 'cursor-grab active:cursor-grabbing h-10 py-0' : 'p-6'}`}>
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

      <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar bg-bg/30">
        {state.assistantHistory.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center space-y-4 opacity-40">
            <Sparkles className="w-8 h-8 text-accent animate-pulse" />
            <p className="text-[10px] uppercase font-black tracking-[0.3em]">Awaiting directive...</p>
            <p className="text-xs text-text-muted max-w-[200px] leading-relaxed italic">
              "Discussion initialized for {STEPS[state.step]}."
            </p>
          </div>
        ) : (
          state.assistantHistory.map((m, i) => (
            <div key={i} className={`flex flex-col ${m.role === "assistant" ? "items-start" : "items-end"} gap-2 w-full min-w-0`}>
              <div className={`px-4 py-3 rounded-2xl text-[13px] leading-relaxed max-w-[90%] shadow-lg transition-all break-words ${
                m.role === "assistant" 
                  ? "bg-card border border-border text-text-main rounded-tl-sm" 
                  : "bg-accent/10 border border-accent/20 text-accent font-medium rounded-tr-sm"
              }`}>
                <div className="flex items-center gap-2 mb-2 opacity-50">
                  <div className={`w-1.5 h-1.5 rounded-full ${m.role === "assistant" ? "bg-accent" : "bg-white"}`} />
                  <span className="text-[9px] uppercase font-bold tracking-widest">{m.role === "assistant" ? "Aether_Core" : "User_Node"}</span>
                </div>
                <p className="whitespace-pre-wrap break-words">{m.content}</p>
              </div>
            </div>
          ))
        )}
        {state.isAssistantLoading && (
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
      
      <div className="p-6 border-t border-border bg-[#18181b]/80 shrink-0">
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
        <ChatInput onSend={askAssistant} isLoading={state.isAssistantLoading} />
        
        <div className="grid grid-cols-2 gap-3 mt-4">
          <button className="py-2.5 bg-border/40 hover:bg-border/60 border border-border rounded-lg flex items-center justify-center gap-2 text-[9px] font-black uppercase tracking-widest transition-all">
            <Save className="w-3 h-3" /> Snapshot
          </button>
          <button className="py-2.5 bg-accent/10 hover:bg-accent/20 border border-accent/20 text-accent rounded-lg flex items-center justify-center gap-2 text-[9px] font-black uppercase tracking-widest transition-all">
            <Download className="w-3 h-3" /> Export_Core
          </button>
        </div>
      </div>
    </>
  );
}

function MainInterfaceChat({ state, askAssistant, preview, isSyncNeeded, syncDeskstateToAI }: { 
  state: StoryState, 
  askAssistant: (p: string) => Promise<void>, 
  preview?: React.ReactNode,
  isSyncNeeded?: boolean,
  syncDeskstateToAI?: () => void
}) {
  return (
    <div className="flex flex-col gap-8 w-full">
      {preview && <div className="w-full">{preview}</div>}
      
      <div className="bg-card border border-border rounded-3xl shadow-2xl flex flex-col h-[600px] overflow-hidden">
        <div className="p-6 border-b border-border bg-header/40 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="p-2 bg-accent/10 rounded-lg">
              <Terminal className="w-4 h-4 text-accent" />
            </div>
            <div>
              <h3 className="text-xs font-black uppercase tracking-widest text-accent">Interface_Link Active</h3>
              <p className="text-[10px] text-text-dim uppercase tracking-tighter">Collaborative Pipeline Stream</p>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <span className={`inline-block w-2 h-2 rounded-full ${isSyncNeeded ? "bg-[#fbbf24] animate-pulse" : "bg-[#10b981]"}`} />
            <span className="text-[9px] font-mono text-text-dim uppercase tracking-widest">
              {isSyncNeeded ? "Sync Outdated" : "System Swarmed & Synced"}
            </span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-8 space-y-8 custom-scrollbar">
          {state.assistantHistory.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center space-y-4 opacity-40">
              <Sparkles className="w-12 h-12 text-accent animate-pulse" />
              <p className="text-xs uppercase font-black tracking-[0.4em]">Establish Communication Link</p>
              <p className="max-w-sm text-sm italic text-text-muted">"Current module: {STEPS[state.step]}. Waiting for instructions."</p>
            </div>
          ) : (
            state.assistantHistory.map((m, i) => (
              <div key={i} className={`flex ${m.role === "assistant" ? "justify-start" : "justify-end"} w-full min-w-0`}>
                <div className={`max-w-[85%] p-6 rounded-2xl leading-relaxed text-sm break-words ${
                  m.role === "assistant" 
                    ? "bg-header border border-border text-text-main shadow-lg" 
                    : "bg-accent/10 border border-accent/20 text-accent font-medium shadow-[0_0_20px_rgba(20,184,166,0.1)]"
                }`}>
                  <div className="flex items-center gap-2 mb-3 opacity-40">
                    <div className={`w-1 h-1 rounded-full ${m.role === "assistant" ? "bg-accent" : "bg-white"}`} />
                    <span className="text-[9px] uppercase font-bold tracking-[0.2em]">{m.role === "assistant" ? "Aether_Core" : "User_Node"}</span>
                  </div>
                  <p className="whitespace-pre-wrap break-words">{m.content}</p>
                </div>
              </div>
            ))
          )}
          {state.isAssistantLoading && (
            <div className="flex items-center gap-3 text-accent animate-pulse">
              <div className="flex gap-1">
                <div className="w-1.5 h-1.5 bg-accent rounded-full animate-bounce" />
                <div className="w-1.5 h-1.5 bg-accent rounded-full animate-bounce [animation-delay:0.2s]" />
                <div className="w-1.5 h-1.5 bg-accent rounded-full animate-bounce [animation-delay:0.4s]" />
              </div>
              <span className="text-[10px] uppercase font-black tracking-widest">Processing_Core_Response</span>
            </div>
          )}
          <ChatScrollAnchor history={state.assistantHistory} isLoading={state.isAssistantLoading} />
        </div>

        <div className="p-8 border-t border-border bg-header/20">
          {isSyncNeeded && syncDeskstateToAI && (
            <button 
              onClick={syncDeskstateToAI}
              className="mb-4 w-full py-3 px-4 bg-[#fbbf24]/10 hover:bg-[#fbbf24]/20 border border-[#fbbf24]/20 hover:border-[#fbbf24]/40 rounded-xl flex items-center justify-between text-left transition-all active:scale-[0.99] group shadow-[0_0_15px_rgba(251,191,36,0.05)] animate-pulse"
            >
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-[#fbbf24] shrink-0" />
                <span className="text-xs font-black uppercase tracking-widest text-[#fbbf24]">
                  ✦ UI workspace settings changed
                </span>
              </div>
              <span className="text-[10px] font-black text-white uppercase bg-[#fbbf24]/30 px-3 py-1 rounded font-mono group-hover:bg-[#fbbf24]/50 transition-colors">
                PUSH CURRENT STATE TO COLLABORATOR ↺
              </span>
            </button>
          )}
          <ChatInput onSend={askAssistant} isLoading={state.isAssistantLoading} variant="large" />
        </div>
      </div>
    </div>
  );
}

function StatusMonitor({ state }: { state: StoryState }) {
  const [isOpen, setIsOpen] = React.useState(false);

  return (
    <div className="border border-border bg-[#131316]/95 rounded-2xl overflow-hidden transition-all duration-300 shadow-xl">
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-4 py-3 bg-white/5 hover:bg-white/10 flex items-center justify-between text-left border-b border-border transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-2">
          <Zap className={`w-3.5 h-3.5 text-accent ${isOpen ? 'animate-pulse' : ''}`} />
          <span className="text-[10px] font-black uppercase tracking-wider text-accent">Telemetry_Feed</span>
        </div>
        <div className="flex items-center gap-1.5 font-mono text-[8px] font-bold">
          <span className="inline-block w-1 h-1 rounded-full bg-[#10b981] animate-pulse" />
          <span className="text-text-dim uppercase tracking-widest">{isOpen ? "CLOSE" : "OPEN"}</span>
        </div>
      </button>

      {isOpen ? (
        <div className="p-4 space-y-4 max-h-[320px] overflow-y-auto scrollbar-thin scrollbar-thumb-border text-[10px] leading-relaxed">
          {/* Core Tuning */}
          <section className="space-y-2">
            <h3 className="text-[8px] uppercase font-black tracking-[0.2em] text-label flex items-center gap-1.5">
              <div className="w-1.5 h-[1px] bg-accent" /> Core_Tuning
            </h3>
            <div className="grid grid-cols-2 gap-2 text-[10px]">
              <div className="p-2 rounded border border-border bg-bg/50 flex flex-col">
                <span className="text-text-dim uppercase tracking-widest text-[7px] mb-0.5">Mode</span>
                <span className={`font-black uppercase ${state.mode === 'NSFW' ? 'text-red-400' : 'text-accent'}`}>{state.mode || "PENDING"}</span>
              </div>
              {state.mode === 'NSFW' && (
                <div className="p-2 rounded border border-border bg-bg/50 flex flex-col">
                  <span className="text-text-dim uppercase tracking-widest text-[7px] mb-0.5">Heat_Level</span>
                  <span className="font-mono font-black text-red-500">{state.heatLevel}/5</span>
                </div>
              )}
              <div className="p-2 rounded border border-border bg-bg/50 col-span-2 flex flex-col">
                <span className="text-text-dim uppercase tracking-widest text-[7px] mb-0.5">Aesthetic_Style</span>
                <span className="font-bold text-text-main truncate">{state.artStyle}</span>
              </div>
            </div>
          </section>

          {/* Narrative Anchor */}
          <section className="space-y-2">
            <h3 className="text-[8px] uppercase font-black tracking-[0.2em] text-label flex items-center gap-1.5">
              <div className="w-1.5 h-[1px] bg-accent" /> Narrative_Anchor
            </h3>
            <div className="p-3 rounded-xl border border-border bg-bg text-[10px] space-y-2 leading-relaxed">
              <div>
                <span className="text-[7px] font-black uppercase text-accent/60 block mb-0.5">Tone</span>
                <p className="text-text-main font-semibold italic">"{state.tone || 'Not Defined'}"</p>
              </div>
              <div>
                <span className="text-[7px] font-black uppercase text-accent/60 block mb-0.5">Concept Summary</span>
                <p className="text-text-dim line-clamp-3 leading-normal">{state.concept || 'Awaiting ingest...'}</p>
              </div>
            </div>
          </section>

          {/* Palette Registry */}
          <section className="space-y-2">
            <h3 className="text-[8px] uppercase font-black tracking-[0.2em] text-label flex items-center gap-1.5">
              <div className="w-1.5 h-[1px] bg-accent" /> Chromatic_Registry
            </h3>
            <div className="flex gap-1 h-4">
              {state.palette.map((c, i) => (
                <div key={i} className="flex-1 rounded border border-white/5" style={{ backgroundColor: c }} title={c} />
              ))}
            </div>
          </section>

          {/* Pipeline Progress */}
          <section className="space-y-2">
            <h3 className="text-[8px] uppercase font-black tracking-[0.2em] text-label flex items-center gap-1.5">
              <div className="w-1.5 h-[1px] bg-accent" /> Pipeline_Progress
            </h3>
            <div className="space-y-2">
              <div className="h-1 w-full bg-border rounded-full overflow-hidden">
                <div 
                  className="h-full bg-accent transition-all duration-1000 ease-out shadow-[0_0_10px_rgba(20,184,166,0.5)]" 
                  style={{ width: `${(state.step / (STEPS.length - 1)) * 100}%` }}
                />
              </div>
              <div className="flex justify-between text-[7px] font-mono text-label uppercase tracking-widest font-black">
                <span>Ingest</span>
                <span>Assembly</span>
              </div>
            </div>
          </section>
        </div>
      ) : (
        /* Collapsed minimal row */
        <div className="px-4 py-3 flex justify-between items-center text-[9px] font-mono text-text-dim bg-white/[0.01]">
          <div className="flex items-center gap-1">
            <span className="text-accent/60 font-bold">MODE:</span>
            <span className={`font-black uppercase ${state.mode === 'NSFW' ? 'text-red-400' : 'text-accent'}`}>{state.mode || "PENDING"}</span>
          </div>
          <div className="flex items-center gap-1 overflow-hidden">
            <span className="text-accent/60 font-bold">STYLE:</span>
            <span className="text-text-main font-semibold truncate max-w-[80px]" title={state.artStyle}>
              {state.artStyle.replace(" Style", "").replace("/VN", "")}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function ChatInput({ onSend, isLoading, variant = "default" }: { onSend: (p: string) => void, isLoading: boolean, variant?: "default" | "large" }) {
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
        rows={variant === "large" ? 4 : 3}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSend();
          }
        }}
        className={`w-full bg-bg border border-border rounded-xl px-4 py-4 focus:border-accent focus:outline-none transition-all placeholder:text-text-dim resize-none shadow-inner leading-relaxed ${variant === "large" ? "text-sm" : "text-xs"}`}
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
  useEffect(() => {
    anchorRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history, isLoading]);
  return <div ref={anchorRef} className="h-px w-full shrink-0" />;
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
                {state.characters && state.characters.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {state.characters.slice(0, 3).map((char, idx) => (
                      <span key={idx} className="text-[7px] font-mono bg-white/5 px-1 py-0.5 rounded border border-white/5 uppercase truncate max-w-[70px]">
                        {char.name || char}
                      </span>
                    ))}
                    {state.characters.length > 3 && (
                      <span className="text-[7px] font-mono bg-white/5 px-1 py-0.5 rounded text-accent">+{state.characters.length - 3}</span>
                    )}
                  </div>
                ) : (
                  <div className="flex gap-1.5 pt-0.5">
                    <span className="text-[7px] font-mono bg-white/5 px-1.5 py-0.5 rounded border border-white/5 uppercase text-accent/80">
                      LYRA_VAHN
                    </span>
                    <span className="text-[7px] font-mono bg-white/5 px-1.5 py-0.5 rounded border border-white/5 uppercase text-text-dim">
                      KAELEN_SHADOW
                    </span>
                  </div>
                )}
              </div>
            </div>
            <span className="text-[7px] font-mono font-semibold text-text-muted mt-2 tracking-tight block">
              Total index Cast: {state.characters?.length || 2} registered
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

function renderStep(state: StoryState, setState: React.Dispatch<React.SetStateAction<StoryState>>, next: () => void, askAssistant: (p: string) => Promise<void>, setHoverHeatLevel?: (lvl: HeatLevel | null) => void, hoverHeatLevel?: HeatLevel | null, isSyncNeeded?: boolean, syncDeskstateToAI?: () => void) {
  const HEAT_DESCRIPTIONS = {
    1: "Slow Burn / Tension Only",
    2: "Mild Intimacy / Suggestive",
    3: "Explicit Permitted",
    4: "Fully Explicit",
    5: "Maximum Intensity"
  };

  switch (state.step) {
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

          <div className="pt-12 text-center">
            <button 
              onClick={() => setState(s => ({ ...s, isDMOnly: !s.isDMOnly }))}
              className={`px-6 py-3 rounded-lg font-mono text-[10px] font-bold tracking-[0.2em] transition-all border uppercase ${
                state.isDMOnly 
                  ? "bg-accent/10 border-accent text-accent shadow-[0_0_20px_rgba(20,184,166,0.2)]" 
                  : "bg-card border-border text-text-dim hover:border-text-muted hover:text-text-muted"
              }`}
            >
              {state.isDMOnly ? "SYSTEM_TRACK: DUNGEON_MIND_CORE" : "SYSTEM_TRACK: FULL_STORY_PACKAGE"}
            </button>
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
          </div>
        </div>
      );

    case 2: // Setting & Tone
      return (
        <div className="space-y-10 py-12">
          <div className="text-center space-y-4">
            <h2 className="text-4xl font-black tracking-tighter uppercase drop-shadow-xl font-sans">World_Matrix</h2>
            <p className="text-text-muted max-w-xl mx-auto font-medium">Define the world rules and atmospheric register.</p>
          </div>

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
      return (
        <div className="space-y-10 py-12">
          <div className="space-y-4">
            <h2 className="text-4xl font-black uppercase tracking-tighter">Art_Style_Schema</h2>
            <p className="text-text-muted font-medium">Establish the visual identity for images and HTML cards.</p>
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
                  <div className="text-[8px] text-label uppercase font-black tracking-widest opacity-40">
                    {idx === 0 ? "Background" : idx === 1 ? "Main Text" : idx === 2 ? "Accent 1" : idx === 3 ? "Accent 2" : "Contrast"}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="p-6 bg-header/20 rounded-xl border border-border inline-block mx-auto mb-10">
            <p className="text-[10px] text-label font-bold uppercase tracking-[0.3em]">
              * Click the cards to open visual color picker
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

          {/* Template Selection Grid */}
          <div className="space-y-5">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-accent rounded-full" />
              <h3 className="text-xs font-black uppercase tracking-[0.3em] text-text-main">Select a Protocol Template</h3>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {GROUNDING_TEMPLATES.map((tpl) => (
                <div 
                  key={tpl.id} 
                  className={`p-6 border rounded-2xl flex flex-col justify-between transition-all relative overflow-hidden group ${
                    state.groundingRules === tpl.rules 
                      ? "border-accent bg-accent/5 shadow-[0_0_20px_rgba(20,184,166,0.15)]" 
                      : "border-border bg-card hover:border-accent/40"
                  }`}
                >
                  <div className="absolute top-0 right-0 p-3 opacity-10">
                    {tpl.icon === "Cpu" && <Cpu className="w-12 h-12" />}
                    {tpl.icon === "ShieldAlert" && <ShieldAlert className="w-12 h-12" />}
                    {tpl.icon === "Terminal" && <Terminal className="w-12 h-12" />}
                    {tpl.icon === "Compass" && <Compass className="w-12 h-12" />}
                    {tpl.icon === "Sparkles" && <Sparkles className="w-12 h-12" />}
                    {tpl.icon === "Zap" && <Zap className="w-12 h-12" />}
                    {tpl.icon === "Shield" && <Shield className="w-12 h-12" />}
                    {tpl.icon === "AlertTriangle" && <AlertTriangle className="w-12 h-12" />}
                  </div>

                  <div className="space-y-3 mb-6">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-header/40 border border-border rounded-lg">
                        {tpl.icon === "Cpu" && <Cpu className="w-4 h-4 text-accent" />}
                        {tpl.icon === "ShieldAlert" && <ShieldAlert className="w-4 h-4 text-accent" />}
                        {tpl.icon === "Terminal" && <Terminal className="w-4 h-4 text-accent" />}
                        {tpl.icon === "Compass" && <Compass className="w-4 h-4 text-accent" />}
                        {tpl.icon === "Sparkles" && <Sparkles className="w-4 h-4 text-accent" />}
                        {tpl.icon === "Zap" && <Zap className="w-4 h-4 text-accent" />}
                        {tpl.icon === "Shield" && <Shield className="w-4 h-4 text-accent" />}
                        {tpl.icon === "AlertTriangle" && <AlertTriangle className="w-4 h-4 text-accent" />}
                      </div>
                      <div>
                        <span className="text-[8px] font-bold uppercase tracking-widest text-accent font-mono">{tpl.genre}</span>
                        <h4 className="text-sm font-black uppercase tracking-tight text-text-main">{tpl.title}</h4>
                      </div>
                    </div>
                    <p className="text-xs text-text-dim leading-relaxed">{tpl.description}</p>
                  </div>

                  <button 
                    onClick={() => setState(s => ({ ...s, groundingRules: tpl.rules }))}
                    className={`w-full py-2.5 rounded-lg border text-[9px] font-black uppercase tracking-widest transition-all ${
                      state.groundingRules === tpl.rules 
                        ? "bg-accent text-bg border-accent shadow-[0_4px_12px_rgba(20,184,166,0.3)]" 
                        : "bg-header/20 border-border text-text-muted hover:border-accent hover:text-accent hover:bg-accent/10"
                    }`}
                  >
                    {state.groundingRules === tpl.rules ? "DEPLOYED_ACTIVE" : "DEPLOY_PROTOCOL"}
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Interactive Workspace Area */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Editor Textarea */}
            <div className="lg:col-span-2 space-y-3">
              <div className="flex justify-between items-center px-1">
                <div className="flex items-center gap-2">
                  <Terminal className="w-3.5 h-3.5 text-accent" />
                  <span className="text-[10px] font-black uppercase tracking-widest text-text-main">SYSTEM_RULES_DOC</span>
                </div>
                {state.groundingRules && (
                  <button 
                    onClick={() => setState(s => ({ ...s, groundingRules: "" }))}
                    className="text-[9px] font-black uppercase tracking-wider text-red-400 hover:underline"
                  >
                    Clear_Buffer
                  </button>
                )}
              </div>
              
              <div className="relative group">
                <textarea 
                  value={state.groundingRules}
                  onChange={(e) => setState(s => ({ ...s, groundingRules: e.target.value }))}
                  className="w-full h-[360px] bg-card border border-border rounded-2xl p-6 focus:border-accent focus:outline-none transition-all font-mono text-xs leading-loose custom-scrollbar shadow-inner"
                  placeholder="[PROTOCOL_01] DO NOT introduce arbitrary magic systems into contemporary realities.
[PROTOCOL_02] INSTEAD, build tension from real-world status structures and physical obstacles.

[PROTOCOL_03] DO NOT ..."
                />
                <div className="absolute bottom-4 right-6 text-[8px] font-mono text-text-muted opacity-30 tracking-widest">
                  {state.groundingRules ? `BUFFER_SIZE::${state.groundingRules.length}_CHARS` : "BUFFER::EMPTY"}
                </div>
              </div>
            </div>

            {/* Logical Contrast Examples */}
            <div className="bg-header/20 border border-border p-6 rounded-3xl space-y-6">
              <div className="space-y-1">
                <span className="text-[8px] font-bold text-accent font-mono uppercase tracking-[0.2em]">DEMONSTRATION</span>
                <h4 className="text-xs font-black uppercase tracking-wider">Continuity Integrity</h4>
              </div>

              <div className="space-y-4">
                {/* Improper Example */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-red-400 text-[9px] font-bold uppercase tracking-wider">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-400" /> BROKEN (No Fences)
                  </div>
                  <p className="text-xs italic text-text-dim leading-relaxed bg-black/20 p-3.5 rounded-xl border border-red-500/10 font-sans">
                    "When the space ranger runs out of ammunition, he closes his eyes, gathers the elements, and casts a solar light shield to block the oncoming turret fire."
                  </p>
                </div>

                {/* Grounded Example */}
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
              <label className="text-[10px] uppercase tracking-[0.2em] font-black text-accent ml-2">Narrative_Summary</label>
              <textarea 
                className="w-full h-48 bg-card border border-border rounded-xl p-6 font-serif text-lg leading-relaxed focus:border-accent transition-all resize-none shadow-inner"
                value={state.concept}
                onChange={(e) => setState(s => ({ ...s, concept: e.target.value }))}
                placeholder="A recursive loop of betrayal set against the backdrop of a dying star..."
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
                onClick={() => askAssistant("Generate the Plot Analysis for the Manifest Card.")}
                className="px-6 py-2 bg-accent/20 border border-accent/40 text-accent rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-accent/30 transition-all flex items-center gap-2"
              >
                <Zap className="w-3 h-3" /> SYNC_PIPELINE
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2">
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

              <div className="pt-6 border-t border-border mt-8">
                <button 
                  onClick={() => askAssistant(`I've updated my colors to ${state.palette.join(', ')}. How do these influence the atmospheric weight of the ${state.settingType} setting?`)}
                  className="w-full py-4 bg-accent/10 border border-accent/20 text-accent rounded-xl text-[10px] font-black uppercase tracking-[0.2em] hover:bg-accent hover:text-black transition-all"
                >
                  Sync Chromatic Shift
                </button>
              </div>
            </div>
          </div>
        </div>
      );

    case 8: // Character Sheets
      return (
        <div className="space-y-10">
          <div className="flex justify-between items-end">
            <div className="space-y-4">
              <h2 className="text-4xl font-black uppercase tracking-tighter">Persona_Matrices</h2>
              <p className="text-text-muted font-medium text-sm">Define the core cast through the technical 6.1 framework.</p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-8">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {[
                { 
                  name: "LYRA_VAHN", 
                  role: "PROTAGONIST", 
                  origin: "Prime_Earth", 
                  status: "Calibrating",
                  stats: { resonance: "88.4%", stability: "High", thermal: "0.2" },
                  tags: ["Technomancer", "Outcast", "Legacy"]
                },
                { 
                  name: "KAELEN_SHADOW", 
                  role: "ANTAGONIST", 
                  origin: "Aetheria", 
                  status: "Stable",
                  stats: { resonance: "94.1%", stability: "Fractured", thermal: "0.8" },
                  tags: ["Void-Touched", "Nobility", "Zealot"]
                }
              ].map((char, i) => (
                <div key={i} className="bg-card border border-border p-8 rounded-3xl relative overflow-hidden group hover:border-accent/40 transition-all">
                  <div className="absolute top-0 left-0 w-1.5 h-full bg-accent opacity-40 group-hover:opacity-100 transition-opacity" />
                  
                  <div className="flex justify-between items-start mb-8">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                         <div className="w-1.5 h-1.5 bg-accent rounded-full shadow-[0_0_8px_rgba(20,184,166,0.5)]" />
                         <span className="text-[9px] font-black uppercase text-accent tracking-[0.3em]">{char.role}</span>
                      </div>
                      <h4 className="text-2xl font-black tracking-tighter uppercase">{char.name}</h4>
                    </div>
                    <div className="px-3 py-1.5 bg-header border border-border rounded-lg flex items-center gap-3">
                      <div className={`w-1.5 h-1.5 rounded-full ${char.status === 'Calibrating' ? 'bg-yellow-400 animate-pulse' : 'bg-accent'}`} />
                      <span className="text-[8px] font-mono font-bold uppercase tracking-widest">{char.status}</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-4 mb-8">
                     {Object.entries(char.stats).map(([key, val]) => (
                       <div key={key} className="space-y-1 bg-header/40 p-3 rounded-xl border border-border/50">
                          <div className="text-[7px] font-black uppercase tracking-widest text-text-dim">{key}</div>
                          <div className="text-[10px] font-mono font-bold text-text-main">{val}</div>
                       </div>
                     ))}
                  </div>

                  <div className="flex flex-wrap gap-2">
                     {char.tags.map(tag => (
                       <span key={tag} className="px-2.5 py-1 bg-white/5 border border-white/5 rounded-full text-[8px] font-bold uppercase tracking-widest text-text-muted">
                         {tag}
                       </span>
                     ))}
                  </div>

                  <div className="mt-8 pt-6 border-t border-border/50 flex justify-between items-center opacity-0 group-hover:opacity-100 transition-opacity">
                     <span className="text-[8px] font-mono text-text-dim">UID::persona_${char.name.toLowerCase()}</span>
                     <button className="text-[8px] font-black uppercase tracking-widest text-accent hover:underline">Edit_Profile</button>
                  </div>
                </div>
              ))}
            </div>

            <div className="p-10 bg-header/20 border border-border rounded-3xl border-dashed flex flex-col items-center justify-center text-center space-y-4">
              <div className="w-16 h-16 bg-accent/10 rounded-full flex items-center justify-center">
                <Users className="w-8 h-8 text-accent opacity-40" />
              </div>
              <div className="space-y-2">
                <h3 className="text-sm font-black uppercase tracking-[0.3em]">Construct_New_Persona</h3>
                <p className="text-xs text-text-dim max-w-sm">Use the pipeline chat on the sideline to define attributes, backstory, and world-resonance for your characters.</p>
              </div>
              <button 
                onClick={() => askAssistant("Let's construct a new character sheet persona.")}
                className="px-6 py-2 bg-accent/20 border border-accent/40 text-accent rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-accent/30 transition-all font-mono"
              >
                INIT_PERSONA_SYNC
              </button>
            </div>
          </div>
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
        </div>
      );
    }

    case 9: // Scenarios
    case 10: // Prompt Plot
    case 13: // First Message
    case 14: // Image Prompts
    case 15: // Compliance & Assembly
      return (
        <div className="space-y-12 py-6 font-sans">
          {/* Header */}
          <div className="space-y-2">
            <h2 className="text-4xl font-black uppercase tracking-tighter flex items-center gap-3">
              {STEPS[state.step].replace(/ /g, '_')} <span className="text-xs bg-accent/20 text-accent px-2.5 py-1 rounded font-mono uppercase tracking-widest">AETHER_STREAM</span>
            </h2>
            <p className="text-text-muted font-medium text-sm">
              {state.step === 9 ? "Design scenario triggers (Witness, Eavesdropper, Stumbler) and three-act narrative hooks." :
               state.step === 10 ? "Output performer instructions and inject the verbatim Architect Protocol sequence." :
               state.step === 13 ? "Establish high-impact entry narrative lines and authored openings for all cast segments." :
               state.step === 14 ? "Generate style-compliant visual prompt triggers and portrait schemas for the engine." :
               "Execute compliance matrix and build the unified compiled master prompt payload."}
            </p>
          </div>

          {/* Locked-in Decisions Summary Panel */}
          <LockedStepsSummary state={state} />

          {/* Prompt / Interactivity Guideline Card for the Active Step */}
          <div className="bg-card hover:border-accent/30 border border-border p-8 rounded-3xl relative overflow-hidden flex flex-col md:flex-row gap-6 items-center shadow-2xl transition-colors">
            <div className="w-16 h-16 bg-accent/10 rounded-full flex items-center justify-center shrink-0">
              {state.step === 9 ? <BookOpen className="w-8 h-8 text-accent opacity-80" /> :
               state.step === 10 ? <Cpu className="w-8 h-8 text-accent opacity-80 animate-pulse" /> :
               state.step === 13 ? <MessageSquare className="w-8 h-8 text-accent opacity-80" /> :
               state.step === 14 ? <ImageIcon className="w-8 h-8 text-accent opacity-80" /> :
               <Sparkles className="w-8 h-8 text-accent opacity-80 animate-bounce" />}
            </div>
            <div className="space-y-2 text-center md:text-left flex-1">
              <span className="text-[8px] font-mono font-black text-accent uppercase tracking-[0.3em] block">
                SIDELINE_COMMUNICATION_PROTOCOL :: ACTIVE
              </span>
              <h3 className="text-lg font-black uppercase tracking-tight">
                {state.step === 9 ? "Orchestrate Playable Scenarios" :
                 state.step === 10 ? "Formulate the Prompt Plot" :
                 state.step === 13 ? "Script Dynamic Authored Openings" :
                 state.step === 14 ? "Calibrate Image Prompts" :
                 "Execute Final Master Build"}
              </h3>
              <p className="text-xs text-text-dim leading-relaxed max-w-2xl">
                {state.step === 9 ? "Use the Collaborator Chat on your right sideline to direct scenario generation. Prompt the AI: 'Construct scenario openings for Lyra' to get styled hooks immediately." :
                 state.step === 10 ? "Send 'Generate performant instructions for prompt map' in the sideline chat to assemble verbatim continuity protocols." :
                 state.step === 13 ? "Instruct the AI on the right sideline: 'Write opening monologue lines for Kaelen Shadow' to draft dialogue buffers." :
                 state.step === 14 ? "Calibrate stable diffusion seeds and descriptions: 'Draft location portrait triggers' on the sideline chat." :
                 "The entire prompt matrix is fully prepped. Type 'Compile final master build payload' on your right sideline to package and preview."}
              </p>
            </div>
            <button 
              onClick={() => {
                const query = state.step === 9 ? "Suggest dynamic scenario hooks matching our locked tone." :
                              state.step === 10 ? "Structure the prompt plot instructions and include Architect Protocols." :
                              state.step === 13 ? "Draft opening first message templates based on our premises." :
                              state.step === 14 ? "Build detailed stable diffusion image prompts for our main cast." :
                              "Assemble and print the finalized prompt payload for copying.";
                askAssistant(query);
              }}
              className="px-6 py-3 bg-accent border border-accent text-black font-black text-[10px] uppercase tracking-widest rounded-xl hover:bg-transparent hover:text-accent transition-all shrink-0 active:scale-95"
            >
              TRIGGER_COHESION
            </button>
          </div>
        </div>
      );

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

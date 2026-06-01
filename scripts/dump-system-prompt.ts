/**
 * Dev utility: dump the SERVER-side portion of the system prompt (the verbatim
 * USCS framework slice injected per UI step) to system-prompt-review.txt.
 *
 * Run from the project root:  npx tsx scripts/dump-system-prompt.ts
 *
 * The FULL system prompt the model receives = this server context + the
 * client-appended wrapper (live deskstate + UI-sync / capture / length
 * protocols) built in src/App.tsx (search: "CURRENT WORKSHOP DESKSTATE").
 */
import fs from "fs";
import path from "path";
import { buildStepContext, uscsLoaded } from "../uscs";

const STEPS = [
  "Mode Selection", "Concept Intake", "Setting & Tone", "Art Style Profile",
  "Palette & Identity", "World Grounding", "Title & Summary", "Plot Card",
  "Character Sheets", "Scenarios", "Prompt Plot", "Guidelines", "Reminders",
  "First Message", "Image Prompts", "Compliance & Assembly",
];

const rule = "#".repeat(100);
let out = `SYSTEM PROMPT REVIEW — server-side USCS injection (uscsLoaded=${uscsLoaded()})\n`;
out += `Generated ${new Date().toISOString()}\n`;
out += `\nThis is ONLY the server portion (uscs.ts -> buildStepContext). The running model\n`;
out += `also receives the client wrapper appended after this: live deskstate + the\n`;
out += `REAL-TIME UI SYNCHRONIZATION COMMANDS / DELIVERABLE CAPTURE / LENGTH MANAGEMENT\n`;
out += `protocols (see src/App.tsx, the systemInstruction template in askAssistant).\n`;

STEPS.forEach((name, i) => {
  out += `\n\n${rule}\n## UI STEP ${i} — ${name}\n${rule}\n\n`;
  out += buildStepContext(i);
});

const outPath = path.join(process.cwd(), "system-prompt-review.txt");
fs.writeFileSync(outPath, out, "utf-8");
console.log(`Wrote ${outPath} (${out.length} chars).`);

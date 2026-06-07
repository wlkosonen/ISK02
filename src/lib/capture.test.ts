import { describe, it, expect } from "vitest";
import { captureDeliverables, isPlaceholderCharName, type Deliverables } from "./capture";

// Fresh empty package per test so captures don't bleed across cases.
function empty(): Deliverables {
  return {
    titleSummary: "", plotCard: "", promptPlot: "", guidelines: "",
    reminders: "", playerPersona: "", scenarios: "", imagePrompts: "",
    characters: [], firstMessages: [],
    dmConfig: { name: "", model: "", statSchema: "", gameRules: "", gameRuleReminder: "", instruction: "", playerGuide: "" },
  };
}

const block = (type: string, body: string) => `<<<USCS_BLOCK ${type}>>>\n${body}\n<<<END USCS_BLOCK>>>`;

describe("captureDeliverables — simple blocks", () => {
  it("captures a single titled block and strips the markers from cleaned text", () => {
    const text = `Here you go!\n\n${block("GUIDELINES", "Always stay in character.")}\n\nLet me know.`;
    const { next, captured, cleaned } = captureDeliverables(text, empty());
    expect(next.guidelines).toBe("Always stay in character.");
    expect(captured).toContain("Guidelines");
    expect(cleaned).not.toMatch(/<<<USCS_BLOCK/);
    expect(cleaned).not.toMatch(/<<<END/);
    expect(cleaned).toContain("Always stay in character."); // content survives
    expect(cleaned).toContain("Here you go!");
  });

  it("ignores an empty block body", () => {
    const { next, captured } = captureDeliverables(block("REMINDERS", "   "), empty());
    expect(next.reminders).toBe("");
    expect(captured).toHaveLength(0);
  });

  it("does NOT capture a truncated block (opening marker, no close)", () => {
    const text = `<<<USCS_BLOCK PROMPT_PLOT>>>\nThe story begins and then the response was cut off mid`;
    const { next, captured } = captureDeliverables(text, empty());
    expect(next.promptPlot).toBe("");
    expect(captured).toHaveLength(0);
  });

  it("latest version wins when a block type appears twice", () => {
    const text = `${block("TITLE_SUMMARY", "First draft")}\n${block("TITLE_SUMMARY", "Final draft")}`;
    const { next } = captureDeliverables(text, empty());
    expect(next.titleSummary).toBe("Final draft");
  });

  it("tolerates an echoed type on the closing marker", () => {
    const text = `<<<USCS_BLOCK GUIDELINES>>>\nRule one.\n<<<END USCS_BLOCK GUIDELINES>>>`;
    const { next } = captureDeliverables(text, empty());
    expect(next.guidelines).toBe("Rule one.");
  });
});

// Real-provider tolerance — mistral-medium was observed (live) to emit two-bracket
// markers, drop the END sentinel, and wrap blocks in ``` code fences as a chat
// lengthens. Capture must recover these rather than silently lose the deliverable.
describe("captureDeliverables — malformed/real-provider tolerance", () => {
  it("captures a two-bracket opener with a proper END marker", () => {
    const text = `<<<USCS_BLOCK SCENARIOS>>\nScenario one.\n<<<END USCS_BLOCK>>`;
    const { next, captured } = captureDeliverables(text, empty());
    expect(next.scenarios).toBe("Scenario one.");
    expect(captured).toContain("Scenarios");
  });

  it("captures an END-less block that the model closed with a ``` fence", () => {
    const text = "```markdown\n<<<USCS_BLOCK GUIDELINES>>\nStay in character.\n```";
    const { next } = captureDeliverables(text, empty());
    expect(next.guidelines).toBe("Stay in character."); // fence stripped, no marker left
  });

  it("captures two back-to-back END-less fenced blocks", () => {
    const text = [
      "```markdown",
      "<<<USCS_BLOCK SCENARIOS>>",
      "Scenario body.",
      "```",
      "```markdown",
      "<<<USCS_BLOCK PLAYER_PERSONA>>",
      "Persona body.",
      "```",
    ].join("\n");
    const { next } = captureDeliverables(text, empty());
    expect(next.scenarios).toBe("Scenario body.");
    expect(next.playerPersona).toBe("Persona body.");
  });

  it("captures an END-less character block bounded by the next opener", () => {
    const text = [
      "<<<USCS_BLOCK CHAR_CARD: Veythas>>",
      "<div>card</div>",
      "<<<USCS_BLOCK CHAR_DESC: Veythas>>>",
      "A fallen sky-knight.",
      "<<<END USCS_BLOCK>>>",
    ].join("\n");
    const { next } = captureDeliverables(text, empty());
    const v = next.characters.find(c => c.name === "Veythas")!;
    expect(v.card).toBe("<div>card</div>");
    expect(v.desc).toBe("A fallen sky-knight.");
  });

  it("still REJECTS a truncated two-bracket block (no END, no closing fence)", () => {
    const text = "<<<USCS_BLOCK PROMPT_PLOT>>\nThe story begins and then it was cut off mid";
    const { next, captured } = captureDeliverables(text, empty());
    expect(next.promptPlot).toBe("");
    expect(captured).toHaveLength(0);
  });
});

describe("captureDeliverables — characters", () => {
  it("captures multiple named characters with desc + card", () => {
    const text = [
      "<<<USCS_BLOCK CHAR_DESC: Mara>>>\nA jaded archivist.\n<<<END USCS_BLOCK>>>",
      "<<<USCS_BLOCK CHAR_CARD: Mara>>>\n<div>card</div>\n<<<END USCS_BLOCK>>>",
      "<<<USCS_BLOCK CHAR_DESC: Toren>>>\nA hot-headed guard.\n<<<END USCS_BLOCK>>>",
    ].join("\n");
    const { next } = captureDeliverables(text, empty());
    expect(next.characters).toHaveLength(2);
    const mara = next.characters.find(c => c.name === "Mara")!;
    expect(mara.desc).toBe("A jaded archivist.");
    expect(mara.card).toBe("<div>card</div>");
    expect(next.characters.find(c => c.name === "Toren")!.desc).toBe("A hot-headed guard.");
  });

  it("stamps the palette on a captured card when provided", () => {
    const palette = ["#111111", "#ffffff", "#14b8a6"];
    const text = "<<<USCS_BLOCK CHAR_CARD: Mara>>>\n<div>card</div>\n<<<END USCS_BLOCK>>>";
    const { next } = captureDeliverables(text, empty(), palette);
    expect(next.characters[0].cardPalette).toEqual(palette);
  });

  it("routes a placeholder-named CHAR_DESC to the in-progress character", () => {
    const start = empty();
    start.characters.push({ name: "Mara", desc: "", card: "" });
    const text = "<<<USCS_BLOCK CHAR_DESC: Name>>>\nThe real description.\n<<<END USCS_BLOCK>>>";
    const { next, captured } = captureDeliverables(text, start);
    expect(next.characters).toHaveLength(1);
    expect(next.characters[0].desc).toBe("The real description.");
    expect(captured).toContain("Mara (description)");
  });

  it("drops a placeholder-named block with a warning when there is nothing to attach to", () => {
    const text = "<<<USCS_BLOCK CHAR_DESC: NAME>>>\nOrphan desc.\n<<<END USCS_BLOCK>>>";
    const { next, captured, warnings } = captureDeliverables(text, empty());
    expect(next.characters).toHaveLength(0); // no ghost "NAME" character
    expect(captured).toHaveLength(0);
    expect(warnings).toHaveLength(1);
  });

  it("updates an existing character rather than duplicating on re-capture", () => {
    const start = empty();
    start.characters.push({ name: "Mara", desc: "old", card: "" });
    const text = "<<<USCS_BLOCK CHAR_DESC: mara>>>\nnew desc\n<<<END USCS_BLOCK>>>"; // case-insensitive match
    const { next } = captureDeliverables(text, start);
    expect(next.characters).toHaveLength(1);
    expect(next.characters[0].desc).toBe("new desc");
  });

  it("does not mutate the input deliverables (returns a fresh object)", () => {
    const start = empty();
    const text = block("GUIDELINES", "x");
    captureDeliverables(text, start);
    expect(start.guidelines).toBe(""); // original untouched
  });
});

describe("captureDeliverables — first messages & DM fields", () => {
  it("numbers unlabelled first messages sequentially", () => {
    const text = [
      "<<<USCS_BLOCK FIRST_MESSAGE>>>\nOpening A\n<<<END USCS_BLOCK>>>",
      "<<<USCS_BLOCK FIRST_MESSAGE>>>\nOpening B\n<<<END USCS_BLOCK>>>",
    ].join("\n");
    const { next } = captureDeliverables(text, empty());
    expect(next.firstMessages.map(f => f.label)).toEqual(["1", "2"]);
    expect(next.firstMessages[1].content).toBe("Opening B");
  });

  it("splits DM_NAME_MODEL on a pipe", () => {
    const text = "<<<USCS_BLOCK DM_NAME_MODEL>>>\nName: Aether DM | Model: isk0-dm-medium\n<<<END USCS_BLOCK>>>";
    const { next } = captureDeliverables(text, empty());
    expect(next.dmConfig.name).toBe("Aether DM");
    expect(next.dmConfig.model).toBe("isk0-dm-medium");
  });

  it("splits DM_NAME_MODEL across two lines", () => {
    const text = "<<<USCS_BLOCK DM_NAME_MODEL>>>\nAether DM\nisk0-dm-heavy\n<<<END USCS_BLOCK>>>";
    const { next } = captureDeliverables(text, empty());
    expect(next.dmConfig.name).toBe("Aether DM");
    expect(next.dmConfig.model).toBe("isk0-dm-heavy");
  });

  it("captures DM stat schema and game rules", () => {
    const text = [
      "<<<USCS_BLOCK DM_STAT_SCHEMA>>>\nHP, Max HP, Alive\n<<<END USCS_BLOCK>>>",
      "<<<USCS_BLOCK DM_GAME_RULES>>>\nRoll d20 + modifier.\n<<<END USCS_BLOCK>>>",
    ].join("\n");
    const { next } = captureDeliverables(text, empty());
    expect(next.dmConfig.statSchema).toBe("HP, Max HP, Alive");
    expect(next.dmConfig.gameRules).toBe("Roll d20 + modifier.");
  });
});

describe("isPlaceholderCharName", () => {
  it("flags placeholders and bracket-wrapped variants", () => {
    for (const n of ["Name", "NAME", "<name>", "character", "TBD", "placeholder", "  n/a  "]) {
      expect(isPlaceholderCharName(n)).toBe(true);
    }
  });
  it("accepts real names", () => {
    for (const n of ["Mara", "Toren", "Dr. Vey"]) {
      expect(isPlaceholderCharName(n)).toBe(false);
    }
  });
});

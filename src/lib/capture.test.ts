import { describe, it, expect } from "vitest";
import { captureDeliverables, withRestorePoints, isPlaceholderCharName, isPlaceholderContent, stripDecorativeMarkdown, normalizeDeliverables, type Deliverables } from "./capture";

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

// Truncation stitching — a block cut off at the token limit, then finished on the
// next Continue turn, must capture as ONE block. Capture runs per-message, so the
// opener (turn 1) and the closing END (turn 2) only pair up via `priorBlock`.
describe("captureDeliverables — Continue stitching", () => {
  it("returns the truncated trailing block as pendingBlock (nothing captured yet)", () => {
    const text = "<<<USCS_BLOCK GUIDELINES>>>\nRule one and then it was cut off mid";
    const { captured, pendingBlock, next } = captureDeliverables(text, empty());
    expect(captured).toHaveLength(0);
    expect(next.guidelines).toBe("");
    expect(pendingBlock).toContain("<<<USCS_BLOCK GUIDELINES>>>");
    expect(pendingBlock).toContain("Rule one and then it was cut off mid");
  });

  it("stitches a split block: prior opener + this turn's END captures as one", () => {
    const prior = "<<<USCS_BLOCK PROMPT_PLOT>>>\nThe story begins in a ruined";
    const cont = "citadel where the last light flickers.\n<<<END USCS_BLOCK>>>";
    const { next, captured, pendingBlock } = captureDeliverables(cont, empty(), undefined, prior);
    expect(captured).toContain("Prompt Plot");
    expect(next.promptPlot).toContain("The story begins in a ruined");
    expect(next.promptPlot).toContain("citadel where the last light flickers.");
    expect(pendingBlock).toBeNull();
  });

  it("carries a still-unfinished block forward (doubly-truncated continuation)", () => {
    const prior = "<<<USCS_BLOCK GUIDELINES>>>\nRule one";
    const cont = "and rule two but STILL cut off";
    const { captured, pendingBlock } = captureDeliverables(cont, empty(), undefined, prior);
    expect(captured).toHaveLength(0);
    expect(pendingBlock).toContain("Rule one");
    expect(pendingBlock).toContain("STILL cut off");
  });

  it("a continuation that re-emits the FULL block still captures the complete version", () => {
    const prior = "<<<USCS_BLOCK REMINDERS>>>\nPartial half";
    const cont = "<<<USCS_BLOCK REMINDERS>>>\nThe complete reminders.\n<<<END USCS_BLOCK>>>";
    const { next, pendingBlock } = captureDeliverables(cont, empty(), undefined, prior);
    expect(next.reminders).toBe("The complete reminders."); // last write wins
    expect(pendingBlock).toBeNull();
  });

  it("never re-displays the prior half — cleaned reflects only this turn", () => {
    const prior = "<<<USCS_BLOCK PROMPT_PLOT>>>\nFIRST_HALF_TEXT";
    const cont = "SECOND_HALF_TEXT\n<<<END USCS_BLOCK>>>";
    const { cleaned } = captureDeliverables(cont, empty(), undefined, prior);
    expect(cleaned).toContain("SECOND_HALF_TEXT");
    expect(cleaned).not.toContain("FIRST_HALF_TEXT");
    expect(cleaned).not.toMatch(/<<<END/);
  });

  it("an orphan END with no prior block captures nothing (no false stitch)", () => {
    const text = "...just trailing prose.\n<<<END USCS_BLOCK>>>";
    const { captured, pendingBlock } = captureDeliverables(text, empty());
    expect(captured).toHaveLength(0);
    expect(pendingBlock).toBeNull();
  });
});

// One-level restore — when a capture overwrites a block, the prior value is
// stashed so a bad AI re-skin can be undone.
describe("withRestorePoints", () => {
  it("records the prior value when a non-empty scalar block is overwritten", () => {
    const old = empty(); old.guidelines = "Good v1.";
    const neu = { ...empty(), guidelines: "Worse v2." };
    const out = withRestorePoints(old, neu);
    expect(out.guidelines).toBe("Worse v2.");
    expect(out.prev?.guidelines).toBe("Good v1.");
  });

  it("does NOT create a restore point on the first write (old was empty)", () => {
    const old = empty();
    const neu = { ...empty(), guidelines: "First version." };
    const out = withRestorePoints(old, neu);
    expect(out.prev?.guidelines).toBeUndefined();
  });

  it("carries an existing restore point forward for an unchanged block", () => {
    const old = empty(); old.reminders = "current"; old.prev = { reminders: "older" };
    const neu = { ...empty(), reminders: "current", prev: { reminders: "older" } };
    const out = withRestorePoints(old, neu);
    expect(out.prev?.reminders).toBe("older"); // untouched, kept
  });

  it("stashes a character's prior desc when overwritten, none for a new character", () => {
    const old = empty(); old.characters = [{ name: "Mara", desc: "old desc", card: "" }];
    const neu = { ...empty(), characters: [
      { name: "Mara", desc: "new desc", card: "" },
      { name: "Toren", desc: "fresh", card: "" },
    ] };
    const out = withRestorePoints(old, neu);
    expect(out.characters[0].prevDesc).toBe("old desc");
    expect(out.characters[1].prevDesc).toBeUndefined(); // brand-new
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

describe("isPlaceholderContent", () => {
  it("flags ellipsis placeholders, bracketed or not", () => {
    for (const p of ["...", "…", "[...]", "[…]", "<...>", "( ... )", "  ...  "]) {
      expect(isPlaceholderContent(p)).toBe(true);
    }
  });
  it("flags TBD-style markers", () => {
    for (const p of ["TBD", "todo", "Placeholder", "n/a", "content here", "to be added"]) {
      expect(isPlaceholderContent(p)).toBe(true);
    }
  });
  it("accepts real content (including content that merely ends with an ellipsis)", () => {
    for (const p of ["Always stay in character.", "She trails off...", "A.", "[PROTOCOL_01] No magic."]) {
      expect(isPlaceholderContent(p)).toBe(false);
    }
  });
});

describe("captureDeliverables — placeholder block guard", () => {
  it("does NOT capture a block whose body is just a placeholder, and warns", () => {
    const { next, captured, warnings } = captureDeliverables(block("GUIDELINES", "[...]"), empty());
    expect(next.guidelines).toBe("");
    expect(captured).toHaveLength(0);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it("does not let a placeholder re-emit clobber an already-captured value", () => {
    const start = { ...empty(), reminders: "Never break the fourth wall." };
    const { next, captured } = captureDeliverables(block("REMINDERS", "..."), start);
    expect(next.reminders).toBe("Never break the fourth wall."); // preserved
    expect(captured).toHaveLength(0);
  });

  it("skips a placeholder CHAR_DESC instead of creating a junk character", () => {
    const { next, warnings } = captureDeliverables(block("CHAR_DESC: Aldric", "[...]"), empty());
    expect(next.characters).toHaveLength(0);
    expect(warnings.length).toBeGreaterThan(0);
  });
});

describe("stripDecorativeMarkdown", () => {
  it("removes paired **bold** and __bold__, keeping the inner text", () => {
    expect(stripDecorativeMarkdown("She is **defiant** and __lonely__.")).toBe("She is defiant and lonely.");
  });
  it("leaves single * italics, list bullets, and unbalanced markers alone", () => {
    expect(stripDecorativeMarkdown("*soft* and a list:\n* one\n* two\nstray ** here")).toBe("*soft* and a list:\n* one\n* two\nstray ** here");
  });
  it("does not span across newlines", () => {
    expect(stripDecorativeMarkdown("**line one\nline two**")).toBe("**line one\nline two**");
  });
  it("is idempotent", () => {
    const once = stripDecorativeMarkdown("**a** **b**");
    expect(stripDecorativeMarkdown(once)).toBe(once);
    expect(once).toBe("a b");
  });
});

describe("captureDeliverables — decorative bold stripping", () => {
  it("strips **bold** from a text block on capture", () => {
    const { next } = captureDeliverables(block("REMINDERS", "**Never** break character."), empty());
    expect(next.reminders).toBe("Never break character.");
  });
  it("strips **bold** from a character description but NOT from the HTML card", () => {
    const desc = captureDeliverables(block("CHAR_DESC: Mara", "**Bold** trait."), empty());
    expect(desc.next.characters[0].desc).toBe("Bold trait.");
    const card = captureDeliverables(block("CHAR_CARD: Mara", "<b>**keep**</b>"), desc.next);
    expect(card.next.characters[0].card).toBe("<b>**keep**</b>"); // HTML card untouched
  });
});

describe("normalizeDeliverables", () => {
  it("strips bold across text fields + char descs but leaves HTML cards", () => {
    const d: Deliverables = {
      ...empty(),
      promptPlot: "**Act 1** begins.",
      guidelines: "Rule **one**.",
      plotCard: "<p>**markup stays**</p>",
      characters: [{ name: "Mara", desc: "**brave**", card: "<b>**stays**</b>" }],
      firstMessages: [{ label: "1", content: "**Hello**." }],
    };
    const n = normalizeDeliverables(d);
    expect(n.promptPlot).toBe("Act 1 begins.");
    expect(n.guidelines).toBe("Rule one.");
    expect(n.plotCard).toBe("<p>**markup stays**</p>");          // HTML untouched
    expect(n.characters[0].desc).toBe("brave");
    expect(n.characters[0].card).toBe("<b>**stays**</b>");        // HTML card untouched
    expect(n.firstMessages[0].content).toBe("Hello.");
  });
});

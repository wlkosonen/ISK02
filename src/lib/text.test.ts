import { describe, it, expect } from "vitest";
import { estimateTokens, stripSyncTags, hexToRgb, recolorHtml, parseSetTags } from "./text";

describe("estimateTokens", () => {
  it("returns 0 for empty / nullish input", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens(undefined as unknown as string)).toBe(0);
    expect(estimateTokens(null as unknown as string)).toBe(0);
  });

  it("returns a positive count for real text", () => {
    expect(estimateTokens("Hello, world!")).toBeGreaterThan(0);
  });

  it("counts more tokens for longer text", () => {
    const short = estimateTokens("one");
    const long = estimateTokens("one two three four five six seven eight nine ten");
    expect(long).toBeGreaterThan(short);
  });

  it("is deterministic for the same input", () => {
    expect(estimateTokens("repeatable")).toBe(estimateTokens("repeatable"));
  });
});

describe("stripSyncTags", () => {
  it("removes a [SYNC_PROCEED] token", () => {
    expect(stripSyncTags("All done here.\n[SYNC_PROCEED]")).toBe("All done here.");
  });

  it("removes [SET_*] tags with payloads", () => {
    expect(stripSyncTags("Locked it in. [SET_MODE: NSFW] [SET_HEAT: 3]")).toBe("Locked it in.");
  });

  it("strips a multi-value SET tag but keeps the prose (leaving the gap where it was)", () => {
    expect(stripSyncTags("Palette set. [SET_PALETTE: #000000, #FFFFFF, #FF0000] Enjoy."))
      .toBe("Palette set.  Enjoy."); // two spaces remain where the tag was removed
  });

  it("is case-insensitive on the tag names", () => {
    expect(stripSyncTags("done [sync_proceed]")).toBe("done");
  });

  it("leaves untagged text untouched (just trimmed)", () => {
    expect(stripSyncTags("  plain text  ")).toBe("plain text");
  });
});

describe("hexToRgb", () => {
  it("parses a 6-digit hex with leading #", () => {
    expect(hexToRgb("#14B8A6")).toEqual([20, 184, 166]);
  });

  it("parses a 6-digit hex without #", () => {
    expect(hexToRgb("14b8a6")).toEqual([20, 184, 166]);
  });

  it("expands a 3-digit shorthand", () => {
    expect(hexToRgb("#f00")).toEqual([255, 0, 0]);
    expect(hexToRgb("0f8")).toEqual([0, 255, 136]);
  });

  it("tolerates surrounding whitespace", () => {
    expect(hexToRgb("  #000000 ")).toEqual([0, 0, 0]);
  });

  it("returns null for non-hex / wrong length / garbage", () => {
    expect(hexToRgb("")).toBeNull();
    expect(hexToRgb("#12")).toBeNull();
    expect(hexToRgb("#1234")).toBeNull();      // 4 digits — not 3 or 6
    expect(hexToRgb("#12345g")).toBeNull();    // non-hex char
    expect(hexToRgb("rgb(0,0,0)")).toBeNull();
  });
});

describe("recolorHtml", () => {
  const FROM = ["#0C0F12", "#E2E8F0", "#14B8A6"];
  const TO = ["#000000", "#FFFFFF", "#FF0000"];

  it("returns html unchanged when palettes are missing", () => {
    expect(recolorHtml("<div>#14B8A6</div>", undefined, TO)).toBe("<div>#14B8A6</div>");
    expect(recolorHtml("", FROM, TO)).toBe("");
  });

  it("swaps a solid hex (case-insensitive)", () => {
    expect(recolorHtml("color:#14b8a6", FROM, TO)).toBe("color:#FF0000");
  });

  it("swaps the rgb() triple form and preserves the alpha in rgba()", () => {
    const html = "border:1px solid rgba(20, 184, 166, 0.3); background:rgb(20,184,166)";
    const out = recolorHtml(html, FROM, TO);
    expect(out).toBe("border:1px solid rgba(255, 0, 0, 0.3); background:rgb(255,0,0)");
  });

  it("swaps a 3-digit shorthand that matches the from-colour", () => {
    // #14B8A6 has no shorthand, but a palette entry like #ffffff does (#fff).
    const out = recolorHtml("<a>#fff</a>", ["#FFFFFF"], ["#000000"]);
    expect(out).toBe("<a>#000000</a>");
  });

  it("leaves off-palette colours untouched", () => {
    expect(recolorHtml("bg:#123456; fg:#14B8A6", FROM, TO)).toBe("bg:#123456; fg:#FF0000");
  });

  it("is a no-op when a slot maps a colour to itself", () => {
    expect(recolorHtml("#14B8A6", ["#14B8A6"], ["#14b8a6"])).toBe("#14B8A6");
  });

  it("does not chain a swap into a later slot (A→B then B→C must not re-hit B)", () => {
    // from[0]=#AAAAAA → to[0]=#BBBBBB, and from[1]=#BBBBBB → to[1]=#CCCCCC.
    // A naive sequential replace would turn the original #AAAAAA into #CCCCCC.
    const out = recolorHtml("#AAAAAA and #BBBBBB", ["#AAAAAA", "#BBBBBB"], ["#BBBBBB", "#CCCCCC"]);
    expect(out).toBe("#BBBBBB and #CCCCCC");
  });
});

describe("parseSetTags", () => {
  it("returns empty patch + no toasts when there are no tags", () => {
    const { updates, toastMsgs } = parseSetTags("Just a normal reply with no sync tags.");
    expect(updates).toEqual({});
    expect(toastMsgs).toEqual([]);
  });

  it("parses MODE and HEAT (uppercasing / numeric)", () => {
    const { updates, toastMsgs } = parseSetTags("[SET_MODE: nsfw] [SET_HEAT: 4]");
    expect(updates.mode).toBe("NSFW");
    expect(updates.heatLevel).toBe(4);
    expect(toastMsgs).toContain("Mode: NSFW");
    expect(toastMsgs).toContain("Heat: 4/5");
  });

  it("trims single-line text tags", () => {
    const { updates } = parseSetTags("[SET_TITLE:   The Ashen Vow  ] [SET_SETTING: Dark Fantasy ]");
    expect(updates.title).toBe("The Ashen Vow");
    expect(updates.settingType).toBe("Dark Fantasy");
  });

  it("title-cases the AESTHETIC value", () => {
    expect(parseSetTags("[SET_AESTHETIC: chaos]").updates.aestheticMode).toBe("Chaos");
    expect(parseSetTags("[SET_AESTHETIC: STRUCTURED]").updates.aestheticMode).toBe("Structured");
  });

  it("captures a multiline SET_RULES payload that contains inner brackets (tag ends the message)", () => {
    // The robust form requires the tag be terminated by end-of-message or another
    // [TAG] — that lookahead is what lets inner "[PROTOCOL_NN]" brackets survive.
    const text = "Here are your protocols.\n[SET_RULES: [PROTOCOL_01] No magic.\n[PROTOCOL_02] Death is permanent.]";
    const { updates, toastMsgs } = parseSetTags(text);
    expect(updates.groundingRules).toBe("[PROTOCOL_01] No magic.\n[PROTOCOL_02] Death is permanent.");
    expect(toastMsgs).toContain("Reality Protocols");
  });

  it("falls back to the simple form (truncating at the first ]) when SET_RULES has no inner brackets and trailing prose", () => {
    const { updates } = parseSetTags("[SET_RULES: Keep it grounded.] Thanks!");
    expect(updates.groundingRules).toBe("Keep it grounded.");
  });

  it("ignores a placeholder SET_RULES payload (model wrote rules as prose, tagged a placeholder)", () => {
    const { updates, toastMsgs } = parseSetTags("Here are the protocols. [SET_RULES: ...]");
    expect(updates.groundingRules).toBeUndefined();
    expect(toastMsgs).not.toContain("Reality Protocols");
  });

  it("stops SET_RULES at the closing ] before the next [TAG]", () => {
    const text = "[SET_RULES: rule one] [SET_TONE: grim]";
    const { updates } = parseSetTags(text);
    expect(updates.groundingRules).toBe("rule one");
    expect(updates.tone).toBe("grim");
  });

  it("accepts a SET_PALETTE of 3+ valid hex colours", () => {
    const { updates, toastMsgs } = parseSetTags("[SET_PALETTE: #0C0F12, #E2E8F0, #14B8A6, #fff]");
    expect(updates.palette).toEqual(["#0C0F12", "#E2E8F0", "#14B8A6", "#fff"]);
    expect(toastMsgs).toContain("Palette Config");
  });

  it("rejects a SET_PALETTE with fewer than 3 valid colours", () => {
    const { updates, toastMsgs } = parseSetTags("[SET_PALETTE: #000000, not-a-hex, #12]");
    expect(updates.palette).toBeUndefined();
    expect(toastMsgs).not.toContain("Palette Config");
  });

  it("parses several tags from one message", () => {
    const text = "Locked it. [SET_MODE: SFW] [SET_TITLE: Quiet Town] [SET_PALETTE: #111111, #222222, #333333]";
    const { updates, toastMsgs } = parseSetTags(text);
    expect(updates.mode).toBe("SFW");
    expect(updates.title).toBe("Quiet Town");
    expect(updates.palette).toEqual(["#111111", "#222222", "#333333"]);
    expect(toastMsgs.length).toBe(3);
  });
});

import { describe, it, expect } from "vitest";
import { makeThinkStripper, mistralTextContent, mistralHasThinking } from "./reasoning";

// Drive the stateful stripper the way a stream does: push each chunk, then flush
// once. The contract is that the concatenation of every push return plus the
// flush return is the fully-stripped output.
function strip(chunks: string[]): string {
  const s = makeThinkStripper();
  let out = "";
  for (const c of chunks) out += s.push(c);
  out += s.flush();
  return out;
}

describe("makeThinkStripper", () => {
  it("passes clean text through unchanged", () => {
    expect(strip(["hello ", "world"])).toBe("hello world");
  });

  it("removes a whole <think> block, keeping the answer", () => {
    expect(strip(["<think>secret reasoning</think>answer"])).toBe("answer");
  });

  it("removes a [THINK] block too", () => {
    expect(strip(["[THINK]secret[/THINK]answer"])).toBe("answer");
  });

  it("keeps text before and after the block", () => {
    expect(strip(["before <think>mid</think> after"])).toBe("before  after");
  });

  it("strips a tag split across stream chunks", () => {
    // The opener and closer each straddle a chunk boundary.
    expect(strip(["before <thi", "nk>secret</thi", "nk> after"])).toBe("before  after");
  });

  it("drops a reasoning block that is the whole reply (no answer left)", () => {
    expect(strip(["<think>all reasoning, no answer</think>"])).toBe("");
  });

  it("drops an unclosed/truncated reasoning block, keeping prior answer", () => {
    expect(strip(["answer before <think>never closed"])).toBe("answer before ");
  });

  it("handles multiple blocks", () => {
    expect(strip(["a<think>x</think>b[THINK]y[/THINK]c"])).toBe("abc");
  });

  it("does not hold back content forever — a small clean push flushes fully", () => {
    // Even if push() holds a partial-tag tail mid-stream, flush() must emit it.
    const s = makeThinkStripper();
    const mid = s.push("hi");
    const end = s.flush();
    expect(mid + end).toBe("hi");
  });
});

describe("mistralTextContent", () => {
  it("passes a plain string through", () => {
    expect(mistralTextContent("just text")).toBe("just text");
  });

  it("keeps only text chunks from a structured array, dropping thinking", () => {
    const content = [
      { type: "thinking", thinking: [{ type: "text", text: "reasoning" }] },
      { type: "text", text: "the answer" },
    ];
    expect(mistralTextContent(content)).toBe("the answer");
  });

  it("concatenates multiple text chunks", () => {
    expect(mistralTextContent([{ type: "text", text: "a" }, { type: "text", text: "b" }])).toBe("ab");
  });

  it("returns empty string for null / non-content", () => {
    expect(mistralTextContent(null)).toBe("");
    expect(mistralTextContent(undefined)).toBe("");
    expect(mistralTextContent(42 as any)).toBe("");
  });
});

describe("mistralHasThinking", () => {
  it("is true when the array carries a thinking chunk", () => {
    expect(mistralHasThinking([{ type: "thinking", thinking: [] }, { type: "text", text: "x" }])).toBe(true);
  });

  it("is false for a text-only array or a string", () => {
    expect(mistralHasThinking([{ type: "text", text: "x" }])).toBe(false);
    expect(mistralHasThinking("plain string")).toBe(false);
  });
});

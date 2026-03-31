import { describe, expect, it } from "vitest";
import { fuzzyScore, fuzzySort } from "./fuzzySearch";

describe("fuzzyScore", () => {
  it("matches characters in order", () => {
    expect(fuzzyScore("abc", "aXbXc")).toBeGreaterThan(0);
  });

  it("returns 0 when characters are missing", () => {
    expect(fuzzyScore("xyz", "abc")).toBe(0);
  });
});

describe("fuzzySort", () => {
  it("filters and sorts by score", () => {
    const items = [{ id: "react" }, { id: "vue" }, { id: "react-query" }];
    const out = fuzzySort(items, "react", (x) => x.id);
    expect(out.map((x) => x.id)).toContain("react");
  });
});

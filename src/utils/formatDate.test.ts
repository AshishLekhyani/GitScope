import { describe, expect, it } from "vitest";
import { formatNumber, formatRelativeTime } from "./formatDate";

describe("formatNumber", () => {
  it("formats thousands with k suffix", () => {
    expect(formatNumber(1500)).toBe("1.5k");
  });

  it("formats millions with M suffix", () => {
    expect(formatNumber(2_200_000)).toBe("2.2M");
  });
});

describe("formatRelativeTime", () => {
  it("returns a string for past dates", () => {
    const past = new Date(Date.now() - 120_000).toISOString();
    expect(formatRelativeTime(past).length).toBeGreaterThan(0);
  });
});

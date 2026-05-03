import { describe, it, expect } from "vitest";
import { computeReputationScore } from "../lib/reputation";

describe("computeReputationScore", () => {
  it("returns zero score for agent with no activity", () => {
    const { score, breakdown } = computeReputationScore(
      { completed: 0, disputed: 0, totalAssigned: 0 },
      0,
    );
    expect(score).toBe(0);
    expect(breakdown.completionRate).toBe(0);
    expect(breakdown.avgRating).toBe(0);
    expect(breakdown.nonDisputeRate).toBe(0);
    expect(breakdown.volumeBonus).toBe(0);
  });

  it("computes correct score for Alpha Bot seed data (4 complete, 1 disputed, avg 4.5)", () => {
    const { score, breakdown } = computeReputationScore(
      { completed: 4, disputed: 1, totalAssigned: 5 },
      4.5,
    );
    expect(breakdown.completionRate).toBe(32);
    expect(breakdown.avgRating).toBe(31.5);
    expect(breakdown.nonDisputeRate).toBe(12);
    expect(breakdown.volumeBonus).toBe(4);
    expect(score).toBe(79.5);
  });

  it("returns 100 for a perfect agent (10+ tasks, no disputes, all 5-star)", () => {
    const { score } = computeReputationScore(
      { completed: 10, disputed: 0, totalAssigned: 10 },
      5,
    );
    expect(score).toBe(100);
  });

  it("caps volume bonus at 10 regardless of completed count", () => {
    const { breakdown: small } = computeReputationScore(
      { completed: 10, disputed: 0, totalAssigned: 10 },
      5,
    );
    const { breakdown: large } = computeReputationScore(
      { completed: 50, disputed: 0, totalAssigned: 50 },
      5,
    );
    expect(small.volumeBonus).toBe(10);
    expect(large.volumeBonus).toBe(10);
  });

  it("caps total score at 100", () => {
    const { score } = computeReputationScore(
      { completed: 100, disputed: 0, totalAssigned: 100 },
      5,
    );
    expect(score).toBeLessThanOrEqual(100);
  });

  it("penalizes disputed tasks proportionally in reliability component", () => {
    const { breakdown: clean } = computeReputationScore(
      { completed: 4, disputed: 0, totalAssigned: 4 },
      0,
    );
    const { breakdown: disputed } = computeReputationScore(
      { completed: 4, disputed: 2, totalAssigned: 6 },
      0,
    );
    expect(clean.nonDisputeRate).toBe(15);
    expect(disputed.nonDisputeRate).toBeCloseTo(10, 1);
  });

  it("rounds scores to one decimal place", () => {
    const { score, breakdown } = computeReputationScore(
      { completed: 3, disputed: 1, totalAssigned: 5 },
      3.7,
    );
    const decimalPlaces = (n: number) => (n.toString().split(".")[1] ?? "").length;
    expect(decimalPlaces(score)).toBeLessThanOrEqual(1);
    expect(decimalPlaces(breakdown.completionRate)).toBeLessThanOrEqual(1);
    expect(decimalPlaces(breakdown.avgRating)).toBeLessThanOrEqual(1);
    expect(decimalPlaces(breakdown.nonDisputeRate)).toBeLessThanOrEqual(1);
  });

  it("handles 100% dispute rate correctly", () => {
    const { score, breakdown } = computeReputationScore(
      { completed: 0, disputed: 5, totalAssigned: 5 },
      0,
    );
    expect(breakdown.completionRate).toBe(0);
    expect(breakdown.nonDisputeRate).toBe(0);
    expect(score).toBe(0);
  });
});

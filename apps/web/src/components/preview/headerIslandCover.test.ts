import { describe, expect, it } from "vite-plus/test";

import { isHeaderIslandCovered } from "./headerIslandCover";

describe("isHeaderIslandCovered", () => {
  const island = { right: 748, bottom: 52 };

  it.each([
    {
      name: "a panel well clear of the island",
      left: 900,
      top: 0,
      covered: false,
      expected: false,
    },
    { name: "an edge that reaches the island", left: 740, top: 0, covered: false, expected: true },
    { name: "a maximized panel", left: 0, top: 0, covered: false, expected: true },
    {
      name: "an edge exactly the clearance away",
      left: 796,
      top: 0,
      covered: false,
      expected: false,
    },
    {
      name: "a panel that starts at the island's bottom",
      left: 0,
      top: 52,
      covered: false,
      expected: false,
    },
    {
      name: "a panel that starts below the island",
      left: 0,
      top: 121,
      covered: false,
      expected: false,
    },
    {
      name: "an edge whose header button would touch the island",
      left: 790,
      top: 0,
      covered: false,
      expected: true,
    },
    {
      name: "a shown island the edge hovers near",
      left: 800,
      top: 0,
      covered: false,
      expected: false,
    },
    {
      name: "a covered island the edge barely left",
      left: 800,
      top: 0,
      covered: true,
      expected: true,
    },
    {
      name: "a covered island the edge left for good",
      left: 820,
      top: 0,
      covered: true,
      expected: false,
    },
  ])("$name", ({ left, top, covered, expected }) => {
    expect(isHeaderIslandCovered({ left, top }, island, covered)).toBe(expected);
  });
});

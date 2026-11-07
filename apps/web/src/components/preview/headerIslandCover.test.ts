import { describe, expect, it } from "vite-plus/test";

import { isHeaderIslandCovered } from "./headerIslandCover";

describe("isHeaderIslandCovered", () => {
  const islandRight = 748;

  it.each([
    { name: "a panel well clear of the island", panelLeft: 900, covered: false, expected: false },
    { name: "an edge that reaches the island", panelLeft: 740, covered: false, expected: true },
    { name: "a maximized panel", panelLeft: 0, covered: false, expected: true },
    {
      name: "an edge whose header button would touch the island",
      panelLeft: 790,
      covered: false,
      expected: true,
    },
    {
      name: "a shown island the edge hovers near",
      panelLeft: 800,
      covered: false,
      expected: false,
    },
    {
      name: "a covered island the edge barely left",
      panelLeft: 800,
      covered: true,
      expected: true,
    },
    {
      name: "a covered island the edge left for good",
      panelLeft: 820,
      covered: true,
      expected: false,
    },
  ])("$name", ({ panelLeft, covered, expected }) => {
    expect(isHeaderIslandCovered(panelLeft, islandRight, covered)).toBe(expected);
  });
});

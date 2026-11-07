import { describe, expect, it } from "vite-plus/test";

import { isHeaderIslandCovered } from "./headerIslandCover";

describe("isHeaderIslandCovered", () => {
  const islandRight = 748;

  it.each([
    { name: "a panel well clear of the island", panelLeft: 900, covered: false, expected: false },
    { name: "an edge that reaches the island", panelLeft: 740, covered: false, expected: true },
    { name: "an edge just short of the island", panelLeft: 752, covered: false, expected: true },
    { name: "a maximized panel", panelLeft: 0, covered: false, expected: true },
    {
      name: "a covered island the edge barely left",
      panelLeft: 760,
      covered: true,
      expected: true,
    },
    {
      name: "a covered island the edge left for good",
      panelLeft: 780,
      covered: true,
      expected: false,
    },
    {
      name: "a shown island the edge hovers near",
      panelLeft: 760,
      covered: false,
      expected: false,
    },
  ])("$name", ({ panelLeft, covered, expected }) => {
    expect(isHeaderIslandCovered(panelLeft, islandRight, covered)).toBe(expected);
  });
});

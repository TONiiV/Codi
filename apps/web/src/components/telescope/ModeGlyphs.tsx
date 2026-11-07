import { useId, type SVGProps } from "react";

import { cn } from "../../lib/utils";

// lucide's telescope and microscope (lucide-react 0.564.0), split into parts that can move.
const LUCIDE_SVG = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;
const GLYPH_CLASS = "lucide pointer-events-none overflow-visible";

export function TelescopeGlyph({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg {...LUCIDE_SVG} className={cn(GLYPH_CLASS, className)} {...props}>
      <g className="origin-[12px_13px] transform-view mode-glyph-run:animate-telescope-sweep">
        <path d="m10.065 12.493-6.18 1.318a.934.934 0 0 1-1.108-.702l-.537-2.15a1.07 1.07 0 0 1 .691-1.265l13.504-4.44" />
        <path d="m13.56 11.747 4.332-.924" />
        <path d="M16.485 5.94a2 2 0 0 1 1.455-2.425l1.09-.272a1 1 0 0 1 1.212.727l1.515 6.06a1 1 0 0 1-.727 1.213l-1.09.272a2 2 0 0 1-2.425-1.455z" />
        <path d="m6.158 8.633 1.114 4.456" />
        <circle
          cx="21"
          cy="7"
          r="1.2"
          fill="currentColor"
          stroke="none"
          className="origin-[21px_7px] opacity-0 transform-view mode-glyph-run:animate-telescope-glint"
        />
      </g>
      <path d="m16 21-3.105-6.21" />
      <path d="m8 21 3.105-6.21" />
      <circle cx="12" cy="13" r="2" />
    </svg>
  );
}

// Token rows streamed in the lens, as [start x, ...widths]; the last row stops part way.
const ROWS = [
  [1, 5, 3, 6, 4],
  [-1, 4, 7, 3, 5, 4],
  [-2, 6, 2, 5, 8, 3],
  [-1, 3, 6, 4, 5, 4],
  [0, 5, 4, 6],
];
const TOKENS = ROWS.flatMap(([start = 0, ...widths], row) =>
  widths.map((width, index) => ({
    x: widths.slice(0, index).reduce((x, previous) => x + previous + 1, start),
    y: 1.8 + row * 4.5,
    width,
    fillOpacity: (row + index) % 3 === 0 ? 0.55 : 0.9,
  })),
).map((token, index) => ({ ...token, style: { animationDelay: `${420 + index * 38}ms` } }));

export function MicroscopeGlyph({ className, ...props }: SVGProps<SVGSVGElement>) {
  const id = useId();
  return (
    <svg {...LUCIDE_SVG} className={cn(GLYPH_CLASS, className)} {...props}>
      <g className="mode-glyph-run:animate-microscope-hide">
        <path d="M6 18h8" />
        <path d="M3 22h18" />
        <path d="M14 22a7 7 0 1 0 0-14h-1" />
        <g className="mode-glyph-run:animate-microscope-tube">
          <path d="M9 14h2" />
          <path d="M9 12a2 2 0 0 1-2-2V6h6v4a2 2 0 0 1-2 2Z" />
          <path d="M12 6V3a1 1 0 0 0-1-1H9a1 1 0 0 0-1 1v3" />
        </g>
      </g>
      <g
        fill="currentColor"
        stroke="none"
        className="origin-[12px_12.5px] opacity-0 transform-view mode-glyph-run:animate-microscope-lens"
      >
        <clipPath id={`${id}-clip`}>
          <circle cx="12" cy="12.5" r="16" />
        </clipPath>
        <circle cx="12" cy="12.5" r="16" fillOpacity={0.12} />
        <g clipPath={`url(#${id}-clip)`}>
          <g className="origin-[12px_12.5px] transform-view mode-glyph-run:animate-microscope-detail">
            {TOKENS.map((token) => (
              <rect
                key={token.style.animationDelay}
                {...token}
                height={2.4}
                rx={1.2}
                className="origin-left opacity-0 transform-fill mode-glyph-run:animate-microscope-token"
              />
            ))}
          </g>
        </g>
        <circle cx="12" cy="12.5" r="16" fill="none" stroke="currentColor" strokeWidth={1.4} />
      </g>
    </svg>
  );
}

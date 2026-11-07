import { useId, type SVGProps } from "react";

import { cn } from "../../lib/utils";

// The `mode-glyph-run` parts play once while the nearest [data-glyph-trigger] is hovered or
// focused, or once on mount inside [data-glyph-play]; at rest nothing animates.

export function TelescopeGlyph({ className, ...props }: SVGProps<SVGSVGElement>) {
  const id = useId();
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={cn("overflow-visible", className)}
      {...props}
    >
      <g transform="rotate(-20 10 12.5)">
        <g className="origin-[10px_12.5px] transform-view mode-glyph-run:animate-telescope-sweep">
          <path d="M1.6 11.6h1.6v1.8H1.6z" />
          <path d="m3.2 11.2 15.4-1.1v4.8l-15.4-1.1z" />
          <path d="M18.6 9.6h2.9v5.8h-2.9z" />
          <path d="M6.8 9.4h4v1.1h-4z" />
          <g className="origin-[21.5px_12.5px] opacity-0 transform-view mode-glyph-run:animate-telescope-flare">
            <radialGradient id={id}>
              <stop offset="0.15" stopColor="currentColor" className="text-zinc-25" />
              <stop offset="0.4" stopColor="currentColor" stopOpacity={0.35} />
              <stop offset="1" stopOpacity={0} />
            </radialGradient>
            <circle cx="21.5" cy="12.5" r="12" fill={`url(#${id})`} />
            <g className="fill-zinc-25 stroke-muted-foreground/50" strokeWidth={0.3}>
              <ellipse cx="21.5" cy="12.5" rx="16" ry="0.6" transform="rotate(36 21.5 12.5)" />
              <circle cx="21.5" cy="12.5" r="1.4" />
            </g>
          </g>
        </g>
      </g>
      <path d="M9.1 13.4h1.8v2.2H9.1z" />
      <path
        d="M10 15.2 5.3 22M10 15.2l4.7 6.8M10 15.2V22"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.3}
        strokeLinecap="round"
      />
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
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={cn("overflow-visible", className)}
      {...props}
    >
      <g className="mode-glyph-run:animate-microscope-hide">
        <g className="mode-glyph-run:animate-microscope-tube">
          <path d="M7.9 1.8h3.2v1.6H7.9z" />
          <path d="M8.4 3.4h2.2V10H8.4z" />
          <path d="M8.9 10h1.2v2.2H8.9z" />
        </g>
        <path d="M10.6 6.6H13v1.6h-2.4z" />
        <path
          d="M15.2 20.2v-6.4c0-2.6-1-4.6-2.6-5.8"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.9}
          strokeLinecap="round"
        />
        <path d="M5.5 15.6h9.5v1.1H5.5z" />
        <rect x="5" y="20" width="14" height="2" rx="1" />
      </g>
      <g className="origin-[12px_12.5px] opacity-0 transform-view mode-glyph-run:animate-microscope-lens">
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

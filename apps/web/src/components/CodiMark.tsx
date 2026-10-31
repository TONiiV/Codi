import type { SVGProps } from "react";

/** Serif C followed by a block cursor; the same mark the app icons carry. */
export function CodiMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox="16 34 95 60" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M 64.47 40.36 A 30 30 0 1 0 67.58 84.84 L 60.77 79.11 A 18.5 25.1 0 1 1 58.85 45.94 Z"
        fill="currentColor"
      />
      <rect fill="currentColor" height="46" width="27" x="84" y="48" />
    </svg>
  );
}

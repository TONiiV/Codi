import { cn } from "../lib/utils";

/** Fold mark plus the vector wordmark; the lettering follows the current text color. */
export function CodiLockup({ className }: { readonly className?: string }) {
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5", className)}>
      <img src="/brand/mark.png" alt="" className="size-6 shrink-0" />
      <span
        role="img"
        aria-label="Codi"
        className="block h-[18px] w-[52px] shrink-0 bg-current"
        style={{ mask: 'url("/brand/wordmark.svg") center / contain no-repeat' }}
      />
    </span>
  );
}

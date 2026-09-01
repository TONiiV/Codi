import type { ReactNode } from "react";
import { STATUS_TONE } from "../mock/providers";
import type { AgentStatus } from "../mock/types";

export function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

/**
 * The core motif: a small all-caps latin eyebrow, a large bold Chinese
 * headline, a small muted Chinese subtitle. Used at every level of the app so
 * the page always tells you where you are before it tells you anything else.
 */
export function SectionHead({
  eyebrow,
  headline,
  subtitle,
  size = "lg",
  right,
}: {
  eyebrow: string;
  headline: ReactNode;
  subtitle?: ReactNode;
  size?: "lg" | "md" | "sm";
  right?: ReactNode;
}) {
  const headlineSize =
    size === "lg" ? "text-[34px]" : size === "md" ? "text-[23px]" : "text-[17px]";
  return (
    <div className="flex items-end justify-between gap-8">
      <div className="min-w-0">
        <div className="eyebrow text-faint">{eyebrow}</div>
        <h2 className={cx("headline mt-3 text-ink", headlineSize)}>{headline}</h2>
        {subtitle ? (
          <p className="mt-2 max-w-[62ch] text-[13.5px] leading-[1.75] text-muted">{subtitle}</p>
        ) : null}
      </div>
      {right ? <div className="shrink-0 pb-1">{right}</div> : null}
    </div>
  );
}

export function Card({
  children,
  className,
  padded = true,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <div
      className={cx(
        "rounded-[14px] border border-rule bg-card",
        padded && "p-6",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Big-number tile. The number is the content; the labels are annotation. */
export function StatTile({
  eyebrow,
  value,
  unit,
  note,
  tone,
}: {
  eyebrow: string;
  value: string;
  unit?: string;
  note?: string;
  tone?: string;
}) {
  return (
    <div className="flex min-h-[124px] flex-col justify-between rounded-[14px] border border-rule bg-card p-5">
      <div className="eyebrow text-faint">{eyebrow}</div>
      <div>
        <div className={cx("num flex items-baseline gap-1", tone ?? "text-ink")}>
          <span className="text-[40px] leading-none font-semibold">{value}</span>
          {unit ? <span className="text-[13px] font-medium text-muted">{unit}</span> : null}
        </div>
        {note ? <div className="mt-2 text-[12px] text-muted">{note}</div> : null}
      </div>
    </div>
  );
}

export function Pill({
  active,
  children,
  onClick,
  size = "md",
  title,
}: {
  active?: boolean;
  children: ReactNode;
  onClick?: () => void;
  size?: "sm" | "md";
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cx(
        "rounded-full border transition-colors",
        size === "sm" ? "px-3 py-1 text-[12px]" : "px-4 py-1.5 text-[13px]",
        active
          ? "border-ink bg-ink text-paper"
          : "border-rule bg-card text-ink-2 hover:border-rule-strong hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

export function Avatar({
  glyph,
  size = 32,
  tone = "light",
  dim,
}: {
  glyph: string;
  size?: number;
  tone?: "light" | "dark";
  dim?: boolean;
}) {
  return (
    <span
      style={{ width: size, height: size, fontSize: Math.round(size * 0.44) }}
      className={cx(
        "inline-flex shrink-0 items-center justify-center rounded-[7px] font-medium select-none",
        tone === "dark"
          ? "bg-shell-ink text-shell"
          : "border border-rule-strong bg-paper-sunk text-ink",
        dim && "opacity-45",
      )}
    >
      {glyph}
    </span>
  );
}

export function StatusDot({ status }: { status: AgentStatus }) {
  return (
    <span
      className={cx(
        "inline-block size-[6px] rounded-full bg-current",
        STATUS_TONE[status],
        status === "idle" && "opacity-60",
      )}
    />
  );
}

/** Thin horizontal rule used to separate editorial blocks. */
export function Rule({ className }: { className?: string }) {
  return <div className={cx("h-px w-full bg-rule", className)} />;
}

export function Meter({ value, tone }: { value: number; tone?: string }) {
  return (
    <div className="h-[3px] w-full overflow-hidden rounded-full bg-paper-sunk">
      <div
        className={cx("h-full rounded-full", tone ?? "bg-ink")}
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}

/** Native select styled down to a hairline so it disappears into the page. */
export function Selector<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <label className="group inline-flex items-center gap-1.5 rounded-full border border-rule bg-card px-3 py-1 transition-colors hover:border-rule-strong">
      <span className="eyebrow text-faint">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
        className="cursor-pointer appearance-none bg-transparent pr-3 text-[12.5px] font-medium text-ink outline-none"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='5' viewBox='0 0 8 5'%3E%3Cpath d='M1 1l3 3 3-3' fill='none' stroke='%238e877d' stroke-width='1.2' stroke-linecap='round'/%3E%3C/svg%3E\")",
          backgroundRepeat: "no-repeat",
          backgroundPosition: "right center",
        }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function EmptyNote({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-[14px] border border-dashed border-rule px-6 py-10 text-center text-[13px] text-muted">
      {children}
    </div>
  );
}

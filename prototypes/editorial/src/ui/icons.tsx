type IconProps = { className?: string };

/** Hairline line-art at 1.4 stroke; everything inherits `currentColor`. */
function Svg({ className, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function IconToday(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4" />
    </Svg>
  );
}

export function IconAgents(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="7" cy="7" r="2.6" />
      <circle cx="17" cy="7" r="2.6" />
      <circle cx="12" cy="17" r="2.6" />
      <path d="M9.4 8.4L14.6 8.4M8.4 9.2l2.4 5.4M15.6 9.2l-2.4 5.4" />
    </Svg>
  );
}

export function IconProjects(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 6.5h7M4 12h16M4 17.5h11" />
      <circle cx="17" cy="6.5" r="1.6" />
      <circle cx="19" cy="17.5" r="1.6" />
    </Svg>
  );
}

export function IconCalendar(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
      <path d="M3.5 9.5h17M8 3.5v3M16 3.5v3M8 13.5h3M8 16.5h6" />
    </Svg>
  );
}

export function IconSearch(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="11" cy="11" r="6" />
      <path d="M15.5 15.5L20 20" />
    </Svg>
  );
}

export function IconSpark(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9z" />
      <path d="M18.5 16.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" />
    </Svg>
  );
}

export function IconChevron({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M9 5.5L15.5 12L9 18.5" />
    </Svg>
  );
}

export function IconSend(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4.5 12h13M12 6.5l5.5 5.5L12 17.5" />
    </Svg>
  );
}

export function IconAt(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="3.4" />
      <path d="M15.4 9.6v3.9a2.6 2.6 0 005.2 0V12A8.5 8.5 0 1012 20.5h3" />
    </Svg>
  );
}

export function IconClose(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 6l12 12M18 6L6 18" />
    </Svg>
  );
}

export function IconArrowDown(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 5v14M6.5 13.5L12 19l5.5-5.5" />
    </Svg>
  );
}

/**
 * The hero illustration: a line-art desk, drawn once and never animated.
 * Deliberately sparse so it reads as a magazine spot illustration.
 */
export function DeskIllustration({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 280 200"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.15}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {/* desk surface */}
      <path d="M14 158h252" />
      <path d="M40 158v30M240 158v30" />
      {/* monitor */}
      <rect x="86" y="52" width="108" height="72" rx="4" />
      <path d="M86 68h108" />
      <circle cx="94" cy="60" r="1.6" />
      <circle cx="101" cy="60" r="1.6" />
      <path d="M100 84h56M100 94h74M100 104h40M164 104h20" />
      <path d="M132 124v20h16v-20" />
      <path d="M116 158h48" />
      {/* keyboard */}
      <rect x="96" y="146" width="88" height="10" rx="2.5" />
      {/* mug */}
      <path d="M212 132h26v18a8 8 0 01-8 8h-10a8 8 0 01-8-8z" />
      <path d="M238 137h6a5 5 0 010 10h-6" />
      <path d="M218 124c0-4 4-4 4-8M228 124c0-4 4-4 4-8" />
      {/* plant */}
      <path d="M40 158v-18h26v18" />
      <path d="M53 140c0-14-8-22-16-24 2 12 8 20 16 24z" />
      <path d="M53 140c0-16 8-24 17-26-2 14-9 22-17 26z" />
      <path d="M53 140v-30" />
      {/* papers */}
      <path d="M196 152l30-4 4 10-30 4z" />
      <path d="M202 152l24-3" />
    </svg>
  );
}

import { useEffect, useState } from "react";

/**
 * Ticks at `intervalMs` while the calling component is mounted. Used only for
 * elapsed-time readouts so nothing repaints when the panel is not on screen.
 */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

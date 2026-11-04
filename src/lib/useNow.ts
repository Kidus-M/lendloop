"use client";

import { useEffect, useState } from "react";

/**
 * The current time, refreshed each minute. Convex re-renders when data changes
 * but not when time passes, and this keeps "overdue" and "2 days ago" correct
 * on a page that stays open.
 */
export function useNow(intervalMs: number = 60_000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);

  return now;
}

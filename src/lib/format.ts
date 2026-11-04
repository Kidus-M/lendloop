const DATE = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

const RELATIVE = new Intl.RelativeTimeFormat("en-US", { numeric: "auto" });

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
];

export function formatDate(isoDate: string): string {
  return DATE.format(new Date(`${isoDate}T00:00:00Z`));
}

export function formatRange(startDate: string, endDate: string): string {
  if (startDate === endDate) return formatDate(startDate);
  return `${formatDate(startDate)} to ${formatDate(endDate)}`;
}

/** "2 days ago", the format the brief's activity example uses. */
export function timeAgo(timestamp: number, now: number): string {
  const elapsed = timestamp - now;
  for (const [unit, size] of UNITS) {
    if (Math.abs(elapsed) >= size) {
      return RELATIVE.format(Math.trunc(elapsed / size), unit);
    }
  }
  return "just now";
}

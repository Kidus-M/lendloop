import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval("sweep outbox", { minutes: 5 }, internal.outbox.sweep);
crons.interval(
  "sync tool availability",
  { hours: 1 },
  internal.maintenance.syncAvailability,
);
crons.daily(
  "purge expired records",
  { hourUTC: 3, minuteUTC: 0 },
  internal.maintenance.purgeExpired,
);

export default crons;

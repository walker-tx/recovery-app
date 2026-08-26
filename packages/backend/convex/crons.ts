import { cronJobs } from "convex/server";

import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "clean up expired auth data",
  { minutes: 15 },
  internal.workosAuthInternal.cleanupExpiredAuthData,
  {},
);

export default crons;

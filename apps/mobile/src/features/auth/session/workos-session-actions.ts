import { api } from "@recovery/backend/convex/_generated/api.js";
import type { ConvexHttpClient } from "convex/browser";

import type { WorkOSSessionActions } from "./workos-session-state.ts";

export function createWorkOSSessionActions(
  client: ConvexHttpClient,
): WorkOSSessionActions {
  return {
    signIn: (input) => client.action(api.workosAuth.signIn, input),
    completeSignup: (input) => client.action(api.workosAuth.completeSignup, input),
    refreshSession: (input) => client.action(api.workosAuth.refreshSession, input),
    signOutSession: (input) => client.action(api.workosAuth.signOutSession, input),
  };
}

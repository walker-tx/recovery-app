import type { UserIdentity } from "convex/server";
import { ConvexError } from "convex/values";
import { resolveWorkOSExpectations, workOSEnvironment } from "./workosAuthConfig";

type AuthContext = {
  auth: {
    getUserIdentity(): Promise<UserIdentity | null>;
  };
};

export async function requireWorkOSIdentity(ctx: AuthContext) {
  const trust = resolveWorkOSExpectations(workOSEnvironment());
  // Convex customJwt applicationID enforces local aud before this identity exists.
  // UserIdentity does not declare an audience field; do not invent a claim mapping.
  const identity = await ctx.auth.getUserIdentity();
  if (
    identity === null ||
    (typeof identity.subject !== "string" || identity.subject.trim() === "") ||
    identity.client_id !== trust.clientId ||
    identity.issuer !== trust.issuer
  ) {
    throw new ConvexError({ code: "UNAUTHENTICATED" });
  }

  return { subject: identity.subject };
}

import type { UserIdentity } from "convex/server";
import { ConvexError } from "convex/values";

type AuthContext = {
  auth: {
    getUserIdentity(): Promise<UserIdentity | null>;
  };
};

const WORKOS_CLIENT_ID_PATTERN = /^client_[A-Za-z0-9]+$/;

export async function requireWorkOSIdentity(ctx: AuthContext) {
  const clientId = process.env.WORKOS_CLIENT_ID;
  if (clientId === undefined || !WORKOS_CLIENT_ID_PATTERN.test(clientId)) {
    throw new Error("A valid WORKOS_CLIENT_ID is required");
  }

  const identity = await ctx.auth.getUserIdentity();
  const expectedIssuer = `https://api.workos.com/user_management/${clientId}`;
  if (
    identity === null ||
    identity.subject === "" ||
    identity.client_id !== clientId ||
    identity.issuer !== expectedIssuer
  ) {
    throw new ConvexError({ code: "UNAUTHENTICATED" });
  }

  return { subject: identity.subject };
}

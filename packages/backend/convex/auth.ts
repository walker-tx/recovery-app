import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";

import { getPasswordProfile } from "./authPolicy";

const MIN_PASSWORD_LENGTH = 10;

const passwordProvider = Password({
  profile: getPasswordProfile,
  validatePasswordRequirements(password) {
    if (password.length < MIN_PASSWORD_LENGTH) {
      throw new Error("Invalid password");
    }
  },
});

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [passwordProvider],
});

import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";

const MIN_PASSWORD_LENGTH = 10;

const passwordProvider = Password({
  profile(params) {
    if (
      params.flow !== "signIn" ||
      typeof params.email !== "string" ||
      typeof params.password !== "string" ||
      params.password.length < MIN_PASSWORD_LENGTH
    ) {
      throw new Error("Invalid credentials");
    }

    return { email: params.email.trim().toLowerCase() };
  },
  validatePasswordRequirements(password) {
    if (password.length < MIN_PASSWORD_LENGTH) {
      throw new Error("Invalid password");
    }
  },
});

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [passwordProvider],
});

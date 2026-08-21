type SignInValidation = {
  email?: string;
  password?: string;
};

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function getSignInValidation(
  email: string,
  password: string,
): SignInValidation {
  const errors: SignInValidation = {};
  const normalizedEmail = normalizeEmail(email);

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    errors.email = "Enter a valid email address.";
  }
  if (password.length === 0) {
    errors.password = "Enter your password.";
  }

  return errors;
}

export function getFirstInvalidSignInField(errors: SignInValidation) {
  if (errors.email) return "email" as const;
  if (errors.password) return "password" as const;
  return null;
}

export function toSafeSignInError(_error: unknown) {
  return "We couldn't sign you in. Check your email and password, then try again.";
}

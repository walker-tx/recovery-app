export const MIN_PASSWORD_LENGTH = 10;

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
  if (password.length < MIN_PASSWORD_LENGTH) {
    errors.password = `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }

  return errors;
}

export function toSafeSignInError(_error: unknown) {
  return "We couldn't sign you in. Check your email and password, then try again.";
}

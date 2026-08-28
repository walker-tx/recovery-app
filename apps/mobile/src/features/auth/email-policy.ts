export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function getEmailError(email: string) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(email))) {
    return "Enter a valid email address.";
  }
  return undefined;
}

import { getEmailError } from "../email-policy.ts";

export const MIN_PASSWORD_LENGTH = 10;
export const RESEND_COOLDOWN_MS = 60_000;

type SignupValidation = { email?: string; password?: string; confirmation?: string };

export function getSignupValidation(email: string, password: string, confirmation: string): SignupValidation {
  const errors: SignupValidation = {};
  const emailError = getEmailError(email);
  if (emailError) errors.email = emailError;
  if (password.length < MIN_PASSWORD_LENGTH) errors.password = `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (confirmation !== password) errors.confirmation = "Passwords do not match.";
  return errors;
}

export function getFirstInvalidSignupField(errors: SignupValidation) {
  if (errors.email) return "email" as const;
  if (errors.password) return "password" as const;
  if (errors.confirmation) return "confirmation" as const;
  return null;
}

export function getVerificationCodeError(code: string) {
  return /^\d{6}$/.test(code) ? undefined : "Enter the six-digit code.";
}

export function resendSecondsRemaining(cooldownUntil: number | null, now: number) {
  if (cooldownUntil === null) return 0;
  return Math.max(0, Math.ceil((cooldownUntil - now) / 1_000));
}

export type SignupState = {
  email: string; password: string; confirmation: string; formError: string | null; isPending: boolean; cooldownUntil: number | null;
};
export const initialSignupState: SignupState = { email: "", password: "", confirmation: "", formError: null, isPending: false, cooldownUntil: null };
export type SignupAction =
  | { type: "emailChanged"; value: string } | { type: "passwordChanged"; value: string } | { type: "confirmationChanged"; value: string }
  | { type: "submissionStarted" } | { type: "submissionAccepted"; acceptedAt: number } | { type: "submissionFailed"; message: string };
export function reduceSignupState(state: SignupState, action: SignupAction): SignupState {
  switch (action.type) {
    case "emailChanged": return { ...state, email: action.value, formError: null };
    case "passwordChanged": return { ...state, password: action.value, formError: null };
    case "confirmationChanged": return { ...state, confirmation: action.value, formError: null };
    case "submissionStarted": return { ...state, isPending: true, formError: null };
    case "submissionAccepted": return { ...state, isPending: false, cooldownUntil: action.acceptedAt + RESEND_COOLDOWN_MS };
    case "submissionFailed": return { ...state, isPending: false, formError: action.message };
  }
}

export type VerificationState = { code: string; formError: string | null; isPending: boolean };
export const initialVerificationState: VerificationState = { code: "", formError: null, isPending: false };
export type VerificationAction = { type: "codeChanged"; value: string } | { type: "submissionStarted" } | { type: "submissionSucceeded" } | { type: "submissionFailed"; message: string };
export function reduceVerificationState(state: VerificationState, action: VerificationAction): VerificationState {
  switch (action.type) {
    case "codeChanged": return { ...state, code: action.value, formError: null };
    case "submissionStarted": return { ...state, isPending: true, formError: null };
    case "submissionSucceeded": return { ...state, isPending: false };
    case "submissionFailed": return { ...state, isPending: false, formError: action.message };
  }
}

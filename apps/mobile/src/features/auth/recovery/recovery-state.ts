import { getEmailError } from "../email-policy.ts";
import { MIN_PASSWORD_LENGTH, RESEND_COOLDOWN_MS, resendSecondsRemaining } from "../signup/signup-state.ts";

type RecoveryValidation = { email?: string };
export function getRecoveryValidation(email: string): RecoveryValidation {
  const emailError = getEmailError(email);
  return emailError ? { email: emailError } : {};
}

type ResetValidation = { token?: string; password?: string; confirmation?: string };
export function getResetValidation(token: string, password: string, confirmation: string): ResetValidation {
  const errors: ResetValidation = {};
  if (token.trim().length === 0) errors.token = "Enter the reset token from your recovery email.";
  if (password.length < MIN_PASSWORD_LENGTH) errors.password = `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (confirmation !== password) errors.confirmation = "Passwords do not match.";
  return errors;
}

export function getFirstInvalidResetField(errors: ResetValidation) {
  if (errors.token) return "token" as const;
  if (errors.password) return "password" as const;
  if (errors.confirmation) return "confirmation" as const;
  return null;
}

export const recoveryResendSecondsRemaining = resendSecondsRemaining;

export type RecoveryState = { email: string; submittedEmail: string | null; formError: string | null; isPending: boolean; cooldownUntil: number | null };
export const initialRecoveryState: RecoveryState = { email: "", submittedEmail: null, formError: null, isPending: false, cooldownUntil: null };
export type RecoveryAction = { type: "emailChanged"; value: string } | { type: "submissionStarted" } | { type: "submissionSucceeded"; acceptedAt: number; submittedEmail: string } | { type: "submissionFailed"; message: string };
export function reduceRecoveryState(state: RecoveryState, action: RecoveryAction): RecoveryState {
  switch (action.type) {
    case "emailChanged": return { ...state, email: action.value, formError: null };
    case "submissionStarted": return { ...state, isPending: true, formError: null };
    case "submissionSucceeded": return { ...state, submittedEmail: action.submittedEmail, isPending: false, cooldownUntil: action.acceptedAt + RESEND_COOLDOWN_MS };
    case "submissionFailed": return { ...state, isPending: false, formError: action.message };
  }
}

export type ResetState = { token: string; password: string; confirmation: string; formError: string | null; isPending: boolean };
export const initialResetState: ResetState = { token: "", password: "", confirmation: "", formError: null, isPending: false };
export type ResetAction =
  | { type: "tokenChanged"; value: string } | { type: "passwordChanged"; value: string } | { type: "confirmationChanged"; value: string }
  | { type: "submissionStarted" } | { type: "submissionSucceeded" } | { type: "submissionFailed"; message: string };
export function reduceResetState(state: ResetState, action: ResetAction): ResetState {
  switch (action.type) {
    case "tokenChanged": return { ...state, token: action.value, formError: null };
    case "passwordChanged": return { ...state, password: action.value, formError: null };
    case "confirmationChanged": return { ...state, confirmation: action.value, formError: null };
    case "submissionStarted": return { ...state, isPending: true, formError: null };
    case "submissionSucceeded": return { ...state, isPending: false };
    case "submissionFailed": return { ...state, isPending: false, formError: action.message };
  }
}

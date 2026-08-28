export type SignupFlowState = { intentId: string | null; submittedEmail: string | null };
export type SignupFlowEvent =
  | { type: "started"; intentId: string; submittedEmail: string }
  | { type: "completed" }
  | { type: "backToWelcome" };

export function createInitialSignupFlowState(): SignupFlowState {
  return { intentId: null, submittedEmail: null };
}

export function signupFlowReducer(
  state: SignupFlowState,
  event: SignupFlowEvent,
): SignupFlowState {
  switch (event.type) {
    case "started":
      return { intentId: event.intentId, submittedEmail: event.submittedEmail };
    case "completed":
    case "backToWelcome":
      return createInitialSignupFlowState();
    default:
      return state;
  }
}

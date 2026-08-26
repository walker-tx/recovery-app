export type SignupFlowState = { intentId: string | null };
export type SignupFlowEvent =
  | { type: "started"; intentId: string }
  | { type: "completed" }
  | { type: "backToWelcome" };

export function createInitialSignupFlowState(): SignupFlowState {
  return { intentId: null };
}

export function signupFlowReducer(
  state: SignupFlowState,
  event: SignupFlowEvent,
): SignupFlowState {
  switch (event.type) {
    case "started":
      return { intentId: event.intentId };
    case "completed":
    case "backToWelcome":
      return createInitialSignupFlowState();
    default:
      return state;
  }
}

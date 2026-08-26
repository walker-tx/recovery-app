import { createContext, createElement, useCallback, useContext, useMemo, useReducer, type ReactNode } from "react";

export type SignupFlowState = { intentId: string | null };
export type SignupFlowEvent =
  | { type: "started"; intentId: string }
  | { type: "completed" }
  | { type: "backToWelcome" };

export const initialSignupFlowState: SignupFlowState = { intentId: null };

export function signupFlowReducer(
  state: SignupFlowState,
  event: SignupFlowEvent,
): SignupFlowState {
  switch (event.type) {
    case "started":
      return { intentId: event.intentId };
    case "completed":
    case "backToWelcome":
      return initialSignupFlowState;
  }
}

type SignupFlowContextValue = SignupFlowState & {
  beginVerification(intentId: string): void;
  completeSignupFlow(): void;
  backToWelcome(): void;
};

const SignupFlowContext = createContext<SignupFlowContextValue | null>(null);

export function SignupFlowProvider({ children }: { children?: ReactNode }) {
  const [state, dispatch] = useReducer(signupFlowReducer, initialSignupFlowState);
  const beginVerification = useCallback((intentId: string) => {
    dispatch({ type: "started", intentId });
  }, []);
  const completeSignupFlow = useCallback(() => dispatch({ type: "completed" }), []);
  const backToWelcome = useCallback(() => dispatch({ type: "backToWelcome" }), []);
  const value = useMemo(
    () => ({ ...state, beginVerification, completeSignupFlow, backToWelcome }),
    [state, beginVerification, completeSignupFlow, backToWelcome],
  );

  return createElement(SignupFlowContext.Provider, { value }, children);
}

export function useSignupFlow(): SignupFlowContextValue {
  const value = useContext(SignupFlowContext);
  if (value === null) throw new Error("useSignupFlow must be used within SignupFlowProvider");
  return value;
}

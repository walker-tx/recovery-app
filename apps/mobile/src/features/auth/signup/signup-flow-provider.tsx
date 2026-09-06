import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  type ReactNode,
} from "react";

import {
  createInitialSignupFlowState,
  signupFlowReducer,
  type SignupFlowState,
} from "./signup-flow-state.ts";

type SignupFlowContextValue = SignupFlowState & {
  beginVerification(intentId: string, submittedEmail: string): void;
  completeSignupFlow(): void;
  backToWelcome(): void;
};

const SignupFlowContext = createContext<SignupFlowContextValue | null>(null);

export function SignupFlowProvider({ children }: { children?: ReactNode }) {
  const [state, dispatch] = useReducer(
    signupFlowReducer,
    undefined,
    createInitialSignupFlowState,
  );
  const beginVerification = useCallback(
    (intentId: string, submittedEmail: string) => {
      dispatch({ type: "started", intentId, submittedEmail });
    },
    [],
  );
  const completeSignupFlow = useCallback(
    () => dispatch({ type: "completed" }),
    [],
  );
  const backToWelcome = useCallback(
    () => dispatch({ type: "backToWelcome" }),
    [],
  );
  const value = useMemo(
    () => ({ ...state, beginVerification, completeSignupFlow, backToWelcome }),
    [state, beginVerification, completeSignupFlow, backToWelcome],
  );

  return createElement(SignupFlowContext.Provider, { value }, children);
}

export function useSignupFlow(): SignupFlowContextValue {
  const value = useContext(SignupFlowContext);
  if (value === null) {
    throw new Error("useSignupFlow must be used within SignupFlowProvider");
  }
  return value;
}

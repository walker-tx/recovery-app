export type SignInState = {
  email: string;
  password: string;
  formError: string | null;
};

export type SignInAction =
  | { type: "emailChanged"; value: string }
  | { type: "passwordChanged"; value: string }
  | { type: "submissionStarted" }
  | { type: "authenticationFailed"; message: string };

export const initialSignInState: SignInState = {
  email: "",
  password: "",
  formError: null,
};

export function reduceSignInState(
  state: SignInState,
  action: SignInAction,
): SignInState {
  switch (action.type) {
    case "emailChanged":
      return { ...state, email: action.value, formError: null };
    case "passwordChanged":
      return { ...state, password: action.value, formError: null };
    case "submissionStarted":
      return { ...state, formError: null };
    case "authenticationFailed":
      return { ...state, formError: action.message };
  }
}

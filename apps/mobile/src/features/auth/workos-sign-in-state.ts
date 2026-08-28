export type WorkOSSignInState = {
  email: string;
  password: string;
  formError: string | null;
};

export type WorkOSSignInAction =
  | { type: "emailChanged"; value: string }
  | { type: "passwordChanged"; value: string }
  | { type: "submissionStarted" }
  | { type: "authenticationFailed"; message: string };

export const initialWorkOSSignInState: WorkOSSignInState = {
  email: "",
  password: "",
  formError: null,
};

export function reduceWorkOSSignInState(
  state: WorkOSSignInState,
  action: WorkOSSignInAction,
): WorkOSSignInState {
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

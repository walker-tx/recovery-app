type PasswordProfileParams = {
  email?: unknown;
  flow?: unknown;
  password?: unknown;
};

export function getPasswordProfile(params: PasswordProfileParams) {
  if (
    params.flow !== "signIn" ||
    typeof params.email !== "string" ||
    typeof params.password !== "string"
  ) {
    throw new Error("Invalid credentials");
  }

  return { email: params.email.trim().toLowerCase() };
}

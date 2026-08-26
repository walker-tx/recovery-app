export type WorkOSGatewayUser = {
  id: string;
  email: string;
  emailVerified: boolean;
};

export type WorkOSUserClassification =
  | { kind: "new" }
  | { kind: "password"; user: WorkOSGatewayUser }
  | { kind: "unverifiedPassword"; user: WorkOSGatewayUser }
  | { kind: "googleOnly"; user: WorkOSGatewayUser }
  | { kind: "appleOnly"; user: WorkOSGatewayUser }
  | { kind: "unknownRecovery"; user: WorkOSGatewayUser };

export type WorkOSGatewaySession = {
  user: WorkOSGatewayUser;
  sessionId: string;
  accessToken: string;
  refreshToken: string;
};

export type WorkOSEmailVerification = {
  id: string;
  userId: string;
  code: string;
  expiresAt: string;
};

export type WorkOSPasswordReset = {
  id: string;
  userId: string;
  token: string;
  expiresAt: string;
};

export interface WorkOSGateway {
  lookupUserByEmail(email: string): Promise<WorkOSUserClassification>;
  createPasswordUser(input: { email: string; password: string }): Promise<WorkOSGatewayUser>;
  authenticatePassword(input: {
    email: string;
    password: string;
  }): Promise<WorkOSGatewaySession>;
  getEmailVerification(id: string): Promise<WorkOSEmailVerification>;
  completeEmailVerification(input: { userId: string; code: string }): Promise<WorkOSGatewayUser>;
  createPasswordReset(email: string): Promise<WorkOSPasswordReset>;
  completePasswordReset(input: { token: string; newPassword: string }): Promise<WorkOSGatewayUser>;
  refreshSession(refreshToken: string): Promise<WorkOSGatewaySession>;
  revokeSession(sessionId: string): Promise<void>;
  getUserById(userId: string): Promise<WorkOSGatewayUser>;
}

export type WorkOSGatewayOperation = keyof WorkOSGateway;

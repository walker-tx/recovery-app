import type { ExecFileOptions } from "node:child_process";

export interface MockTargetSelection {
  readonly worktree: string;
  readonly stackId: string;
  readonly providerGeneration: string;
  /** Derived from immutable registry stackId and the stable OS-user socket rule. */
  readonly adminSocket: string;
  readonly providerState: "running" | "stopped" | "starting";
  readonly inbox: { readonly baseUrl: string; readonly epoch: string } | null;
  /** Internal registry ownership snapshot. Never serialize as CLI output. */
  readonly record: unknown;
}
export function selectMockTarget(options?: {
  worktree?: string;
  cwd?: string;
  signal?: AbortSignal;
}): Promise<MockTargetSelection>;
export function verifyMockTarget(
  selection: MockTargetSelection,
  options?: {
    inbox?: boolean;
    signal?: AbortSignal;
  },
): Promise<MockTargetSelection>;

export interface MockProcessTuple {
  readonly pid: number;
  readonly startedAt: string;
  readonly worktree: string;
}
export type MockTargetExec = (
  command: string,
  args: string[],
  options: ExecFileOptions,
) => Promise<{ stdout: string; stderr?: string }>;
/** Disposable test seams; production defaults use registry authority and OS evidence. */
export function createMockTarget(adapters?: {
  exec?: MockTargetExec;
  createInspector?: (options: { exec: MockTargetExec }) => Promise<{
    inspect(
      pid: number,
      options?: { signal?: AbortSignal },
    ): Promise<MockProcessTuple | null>;
    close(): Promise<void>;
  }>;
  inspectSocket?: (socket: string) => Promise<boolean>;
  inspectListener?: (options: {
    pid: number;
    port: number;
    signal: AbortSignal;
    exec: MockTargetExec;
  }) => Promise<boolean>;
}): {
  selectMockTarget: typeof selectMockTarget;
  verifyMockTarget: typeof verifyMockTarget;
};

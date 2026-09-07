import type { ExecFileOptions } from "node:child_process";

export interface MockTargetSelection {
  readonly worktree: string;
  readonly stackId: string;
  readonly providerGeneration: string;
  /** Derived from immutable registry stackId and the stable OS-user socket rule. */
  readonly adminSocket: string;
  readonly providerState: "running" | "stopped" | "starting";
  /** Discovered address only; verifyMockTarget({ inbox: true }) proves listener ownership. */
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
/** Only fixed check tags and allowlisted comparisons; no observed identities. */
export type MockTargetFailureEvent = Readonly<
  | { site: "socket.directory" | "socket.entry" }
  | {
      site: "listener.field";
      pidEqual: boolean;
      addressEqual: boolean;
      pidField: boolean;
      port: number;
    }
  | { site: "listener.count"; listeners: number; port: number }
  | {
      site: "selection.continuity";
      recordEqual: boolean;
      worktreeEqual: boolean;
      stackIdEqual: boolean;
      generationEqual: boolean;
      socketEqual: boolean;
    }
  | {
      site: "process.tuple";
      service: "provider" | "mailpitHttp" | "mailpitSmtp";
      pidEqual: boolean;
      startedAtEqual: boolean;
      worktreeEqual: boolean;
      /** Full deep strict equality, not just scalar or shape equality. */ deepEqual: false;
    }
  | { site: "provider.socket"; providerPresent: false; socketPresent: true }
  | { site: "mailpit.pair"; httpPresent: boolean; smtpPresent: boolean }
  | { site: "listener.result"; owned: false }
  | { site: "mailpit.recheck" | "inbox.continuity"; equal: false }
  | {
      site: "service.state";
      providerRunning: boolean;
      inboxRequired: boolean;
      inboxPresent: boolean;
    }
  | {
      site:
        | "worktree.resolve"
        | "worktree.git"
        | "registry.read"
        | "inspector.create"
        | "process.inspect.provider"
        | "process.inspect.mailpitHttp"
        | "process.inspect.mailpitSmtp"
        | "socket.inspect"
        | "listener.inspect";
      aborted: boolean;
      targetMismatch: boolean;
      /** Allowlisted listener failure metadata only; never native error text. */
      nativeFailureKind?:
        | "ENOENT"
        | "EACCES"
        | "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"
        | "ABORT_ERR"
        | "nonzero-exit"
        | "other";
      exitOne?: boolean;
      killed?: boolean;
      signaled?: boolean;
    }
>;
/** Disposable test seams; production defaults use registry authority and OS evidence. */
export function createMockTarget(adapters?: {
  observeFailure?: (event: MockTargetFailureEvent) => void;
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

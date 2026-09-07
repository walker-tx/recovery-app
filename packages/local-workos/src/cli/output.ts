import { Effect, Schema } from "effect";

export type Target = {
  worktree: string;
  stackId: string;
  providerGeneration: string;
  identityVerified: boolean;
};
export type Outcome = "not-applied" | "unknown" | "not-applicable";
export class MockError extends Schema.TaggedError<MockError>()("MockError", {
  code: Schema.String,
  message: Schema.String,
  outcome: Schema.Literals(["not-applied", "unknown", "not-applicable"]),
  exitCode: Schema.Number,
}) {}
const messages: Record<string, string> = {
  INVALID_INPUT: "Invalid invocation. Check command help and supported fields.",
  TARGET_MISMATCH:
    "The selected target could not be verified or does not match the expected identity.",
  CONFIRMATION_REQUIRED:
    "Supply the expected stack and provider generation; deletion also requires the current email.",
  NOT_FOUND: "The requested resource was not found in the selected target.",
  INTERNAL_ERROR: "The operation failed.",
  UNAVAILABLE: "The selected service is unavailable.",
  DEADLINE: "The invocation deadline expired.",
  INTERRUPTED: "The invocation was interrupted.",
  INVALID_RESPONSE: "The service response could not be validated.",
  OUTPUT_FAILED: "The output stream failed.",
};
export const failure = (
  code: string,
  outcome: Outcome = "not-applied",
  exitCode?: number,
) =>
  new MockError({
    code: code in messages ? code : "INTERNAL_ERROR",
    message: messages[code] ?? messages.INTERNAL_ERROR,
    outcome,
    exitCode:
      exitCode ??
      (outcome === "unknown"
        ? 5
        : code === "INVALID_INPUT"
          ? 2
          : ["TARGET_MISMATCH", "CONFIRMATION_REQUIRED"].includes(code)
            ? 3
            : ["UNAVAILABLE", "DEADLINE"].includes(code)
              ? 4
              : 1),
  });
export const escapeHuman = (value: string) =>
  value.replace(
    /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu,
    (character) => `\\u{${character.codePointAt(0)!.toString(16)}}`,
  );
export const successEnvelope = (target: Target | null, data: unknown) => ({
  schemaVersion: 1,
  ok: true,
  target,
  data,
});
export const errorEnvelope = (target: Target | null, error: MockError) => ({
  schemaVersion: 1,
  ok: false,
  target,
  error: {
    code: error.code,
    message: error.message,
    outcome: error.outcome,
    nextAction:
      error.outcome === "unknown"
        ? "Inspect selected target state before retrying; do not assume the mutation failed."
        : "Check mock --help and the selected stack status.",
  },
});
export const writeOutput = Effect.fn("mock.writeOutput")(function* (
  stream: NodeJS.WritableStream,
  value: unknown,
  json: boolean,
) {
  const encoded = yield* Schema.encodeEffect(
    Schema.fromJsonString(Schema.Unknown, { space: json ? undefined : 2 }),
  )(value).pipe(Effect.mapError(() => failure("OUTPUT_FAILED")));
  const text = json ? encoded : encoded.split("\n").map(escapeHuman).join("\n");
  return yield* Effect.callback<void, MockError>((resume) => {
    const onError = () => resume(Effect.fail(failure("OUTPUT_FAILED")));
    stream.once("error", onError);
    stream.write(text + "\n", (error) =>
      resume(error ? Effect.fail(failure("OUTPUT_FAILED")) : Effect.void),
    );
    return Effect.sync(() => {
      stream.off("error", onError);
    });
  });
});

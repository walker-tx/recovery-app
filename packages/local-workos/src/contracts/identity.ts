import * as NodePath from "@effect/platform-node/NodePath";
import { Layer, Context, Effect, Path, Schema } from "effect";

// NodePath.layer is a resource-free synchronous layer using the host path implementation.
const hostPath = Context.get(
  Effect.runSync(Effect.scoped(Layer.build(NodePath.layer))),
  Path.Path,
);

export const LocalWorkOSApiKey = Schema.String.check(
  Schema.isPattern(/^sk_test_local_[0-9a-f]{64}$/),
  Schema.isLengthBetween(78, 78),
).pipe(Schema.brand("LocalWorkOSApiKey"));
const IdentityUuid = Schema.String.check(
  Schema.isPattern(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  ),
  Schema.isLengthBetween(36, 36),
);
export const ProviderGeneration = IdentityUuid.pipe(
  Schema.brand("ProviderGeneration"),
);
export const AdminStackId = IdentityUuid;
export const AdminWorktree = Schema.String.check(
  Schema.makeFilter(
    (path) =>
      hostPath.isAbsolute(path) &&
      hostPath.normalize(path) === path &&
      !path.includes("\0") &&
      Buffer.byteLength(path, "utf8") <= 4096,
  ),
);
export const ClientId = Schema.String.check(
  Schema.isPattern(/^client_local[0-9a-f]{32}$/),
  Schema.isLengthBetween(44, 44),
).pipe(Schema.brand("ClientId"));

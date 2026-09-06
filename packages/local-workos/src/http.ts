import { createHash, timingSafeEqual } from "node:crypto";
import { Effect, Scope, FileSystem, Layer, Schema } from "effect";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import { HttpServerRequest } from "effect/unstable/http/HttpServerRequest";
import { MaxBodySize } from "effect/unstable/http/HttpIncomingMessage";
import * as Response from "effect/unstable/http/HttpServerResponse";
import {
  HttpApi,
  HttpApiGroup,
  HttpApiEndpoint,
  HttpApiBuilder,
} from "effect/unstable/httpapi";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
export const equal = (a: string, b: string) =>
  timingSafeEqual(Buffer.from(digest(a)), Buffer.from(digest(b)));
export class HttpError extends Error {
  readonly status: number;
  readonly body: object;
  constructor(status: number, body: object) {
    super("Provider request rejected");
    this.status = status;
    this.body = body;
  }
}
export const reject = (status: number, code: string): never => {
  throw new HttpError(status, { code, message: code });
};

const UserSchema = Schema.Struct({
  id: Schema.String,
  email: Schema.String,
  email_verified: Schema.Boolean,
  first_name: Schema.NullOr(Schema.String),
  last_name: Schema.NullOr(Schema.String),
  created_at: Schema.String,
  updated_at: Schema.String,
  object: Schema.Literal("user"),
  profile_picture_url: Schema.Null,
  external_id: Schema.Null,
  metadata: Schema.JsonObject,
});
export type User = typeof UserSchema.Type;
const AuthenticationSchema = Schema.Struct({
  user: UserSchema,
  access_token: Schema.String,
  refresh_token: Schema.String,
  authentication_method: Schema.Literal("Password"),
  organization_id: Schema.Null,
});
export type Authentication = typeof AuthenticationSchema.Type;
const UserListSchema = Schema.Struct({
  object: Schema.Literal("list"),
  data: Schema.Array(UserSchema),
  list_metadata: Schema.Struct({
    before: Schema.Null,
    after: Schema.NullOr(Schema.String),
  }),
});
export type UserList = typeof UserListSchema.Type;
const IdentitiesSchema = Schema.Array(
  Schema.Struct({
    object: Schema.Literal("identity"),
    id: Schema.String,
    type: Schema.Literals(["GoogleOAuth", "AppleOAuth"]),
    provider: Schema.Literals(["GoogleOAuth", "AppleOAuth"]),
  }),
);
export type Identities = typeof IdentitiesSchema.Type;
const JwksSchema = Schema.Struct({
  keys: Schema.Array(
    Schema.Struct({
      kty: Schema.Literal("RSA"),
      n: Schema.String,
      e: Schema.String,
      kid: Schema.String,
      alg: Schema.Literal("RS256"),
      use: Schema.Literal("sig"),
    }),
  ),
});
export type Jwks = typeof JwksSchema.Type;
const MAX_BODY_BYTES = 16 * 1024;
function requireBearer(authorization: string | undefined, apiKey: string) {
  if (!authorization || !equal(authorization, `Bearer ${apiKey}`)) {
    reject(401, "unauthorized");
  }
}
// Compare only static segments using the selected endpoint's own declaration.
// Router decoding must not make an encoded public path publicly accessible.
function matchesRawPath(rawUrl: string, pattern: string) {
  const segments = new URL(rawUrl, "http://127.0.0.1").pathname.split("/");
  const expected = pattern.split("/");
  return (
    segments.length === expected.length &&
    expected.every(
      (part, index) => part.startsWith(":") || part === segments[index],
    )
  );
}
function rawUserId(rawUrl: string) {
  return new URL(rawUrl, "http://127.0.0.1").pathname.split("/")[3];
}
function makeApi(clientId: string) {
  // WorkOS has multiple non-tagged error envelopes and validation precedence.
  // Raw handlers retain request validation precedence and avoid default payload
  // decode errors containing credentials. Plain successes still use native encoding.
  return HttpApi.make("localWorkOS").add(
    HttpApiGroup.make("workos").add(
      HttpApiEndpoint.get("instanceInfo", "/instance-info", {
        success: Schema.Struct({
          providerGeneration: Schema.String,
          issuer: Schema.String,
          clientId: Schema.String,
          port: Schema.Number,
        }),
      }),
      HttpApiEndpoint.get("jwks", `/sso/jwks/${clientId}`, {
        success: JwksSchema,
      }),
      HttpApiEndpoint.post("authenticate", "/user_management/authenticate", {
        payload: Schema.Unknown,
        success: AuthenticationSchema,
      }),
      HttpApiEndpoint.post("createUser", "/user_management/users", {
        payload: Schema.Unknown,
        success: UserSchema,
      }),
      HttpApiEndpoint.get("listUsers", "/user_management/users", {
        success: UserListSchema,
      }),
      HttpApiEndpoint.get("getUser", "/user_management/users/:id", {
        params: { id: Schema.String },
        success: UserSchema,
      }),
      HttpApiEndpoint.get(
        "getIdentities",
        "/user_management/users/:id/identities",
        { params: { id: Schema.String }, success: IdentitiesSchema },
      ),
    ),
  );
}
function workosResponse<A>(
  apiKey: string,
  run: (
    body: Record<string, unknown>,
    request: HttpServerRequest,
  ) => A | Promise<A>,
  options: {
    access?: "bearer";
    path?: string;
  } = {},
) {
  return Effect.gen(function* () {
    const request = yield* HttpServerRequest;
    if (Number(request.headers["content-length"] ?? 0) > MAX_BODY_BYTES)
      return Response.jsonUnsafe({ code: "invalid_request" }, { status: 413 });
    const body = request.method === "POST" ? yield* request.json : {};
    return yield* Effect.promise(async () => {
      try {
        if (body === null || typeof body !== "object" || Array.isArray(body))
          return Response.jsonUnsafe(
            { code: "invalid_request" },
            { status: 422 },
          );
        if (options.access === "bearer")
          requireBearer(request.headers.authorization, apiKey);
        if (options.path && !matchesRawPath(request.url, options.path)) {
          requireBearer(request.headers.authorization, apiKey);
          return reject(404, "unsupported_operation");
        }
        // Raw handlers skip payload decoding, but plain successes are schema-encoded.
        return await run(body as Record<string, unknown>, request);
      } catch (e) {
        return Response.jsonUnsafe(
          e instanceof HttpError ? e.body : { code: "internal_error" },
          { status: e instanceof HttpError ? e.status : 500 },
        );
      }
    });
  }).pipe(
    Effect.catchCause(() =>
      Effect.succeed(
        Response.jsonUnsafe({ code: "invalid_request" }, { status: 422 }),
      ),
    ),
  );
}

// Concrete HTTP boundary; database and server lifecycle remain in provider.ts.
export async function makeHttpApp(
  options: {
    apiKey: string;
    clientId: string;
    issuer: string;
    providerGeneration: string;
    port: number;
    authenticate: (body: Record<string, unknown>) => Promise<Authentication>;
    createUser: (body: Record<string, unknown>) => Promise<User>;
    listUsers: (url: string) => Promise<UserList>;
    getUser: (id: string) => User;
    getIdentities: (id: string) => Identities;
    jwks: Jwks;
  },
  scope: Scope.Scope,
) {
  const {
    apiKey,
    clientId,
    issuer,
    providerGeneration,
    port,
    authenticate,
    createUser,
    listUsers,
    getUser,
    getIdentities,
    jwks,
  } = options;
  const api = makeApi(clientId);
  const handlers = HttpApiBuilder.group(api, "workos", (handlers) =>
    handlers
      .handleRaw("instanceInfo", ({ endpoint }) =>
        workosResponse(
          apiKey,
          () => ({
            providerGeneration,
            issuer,
            clientId,
            port,
          }),
          { path: endpoint.path },
        ),
      )
      .handleRaw("jwks", ({ endpoint }) =>
        workosResponse(apiKey, () => jwks, { path: endpoint.path }),
      )
      .handleRaw("authenticate", ({ endpoint }) =>
        workosResponse(apiKey, authenticate, { path: endpoint.path }),
      )
      .handleRaw("createUser", ({ endpoint }) =>
        workosResponse(apiKey, createUser, {
          access: "bearer",
          path: endpoint.path,
        }),
      )
      .handleRaw("listUsers", ({ endpoint }) =>
        workosResponse(apiKey, (_, request) => listUsers(request.url), {
          access: "bearer",
          path: endpoint.path,
        }),
      )
      .handleRaw("getUser", ({ endpoint }) =>
        workosResponse(
          apiKey,
          (_, request) => getUser(rawUserId(request.url)),
          { access: "bearer", path: endpoint.path },
        ),
      )
      .handleRaw("getIdentities", ({ endpoint }) =>
        workosResponse(
          apiKey,
          (_, request) => getIdentities(rawUserId(request.url)),
          { access: "bearer", path: endpoint.path },
        ),
      ),
  );
  const routed = await Effect.runPromise(
    HttpRouter.toHttpEffect(
      HttpApiBuilder.layer(api).pipe(
        Layer.provide(handlers),
        Layer.provide(NodeHttpServer.layerHttpServices),
      ),
    ).pipe(
      Effect.provideService(HttpRouter.RouterConfig, {
        caseSensitive: true,
        ignoreTrailingSlash: false,
        ignoreDuplicateSlashes: false,
        // At least the Node HTTP request-header budget; no new 100-byte ID cutoff.
        maxParamLength: 16384,
      }),
      Effect.provideService(Scope.Scope, scope),
    ),
  );
  const unsupported = workosResponse(
    apiKey,
    () => reject(404, "unsupported_operation"),
    { access: "bearer" },
  );
  const app = Effect.gen(function* () {
    const request = yield* HttpServerRequest;
    // HttpRouter otherwise implicitly serves GET endpoints for HEAD.
    if (request.method !== "GET" && request.method !== "POST")
      return yield* unsupported;
    return yield* routed.pipe(
      Effect.catch((error) =>
        error.reason._tag === "RouteNotFound"
          ? unsupported
          : Effect.succeed(
              Response.jsonUnsafe({ code: "internal_error" }, { status: 500 }),
            ),
      ),
    );
  }).pipe(
    Effect.catchCause(() =>
      Effect.succeed(
        Response.jsonUnsafe({ code: "internal_error" }, { status: 500 }),
      ),
    ),
  );

  return app.pipe(
    Effect.provideService(MaxBodySize, FileSystem.Size(MAX_BODY_BYTES)),
  );
}

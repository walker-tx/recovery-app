import {
  Effect,
  Scope,
  FileSystem,
  Layer,
  Schema,
  Redacted,
  Cause,
} from "effect";
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
import {
  RequestRejected,
  VerificationRequired,
  type RequestFailure,
  equal,
  PasswordAuthenticationRequestSchema,
  CreateUserRequestSchema,
  UserSchema,
  AuthenticationSchema,
  UserListSchema,
  IdentitiesSchema,
  JwksSchema,
} from "./contracts.ts";
export * from "./contracts.ts";
import { WorkOSService } from "./workos-service.ts";
const MAX_BODY_BYTES = 16 * 1024;
function requireBearer(authorization: string | undefined, apiKey: string) {
  return authorization && equal(authorization, `Bearer ${apiKey}`)
    ? Effect.void
    : Effect.fail(new RequestRejected({ reason: "unauthorized" }));
}
function domainResponse(error: RequestFailure) {
  if (error instanceof VerificationRequired)
    return Response.jsonUnsafe(
      {
        code: "email_verification_required",
        message: "Email verification required",
        email_verification_id: error.id,
        pending_authentication_token: Redacted.value(error.pending),
      },
      { status: 400 },
    );
  if (error.reason === "invalid_grant")
    return Response.jsonUnsafe(
      { error: "invalid_grant", error_description: "Invalid credentials" },
      { status: 400 },
    );
  if (error.reason === "invalid_request")
    return Response.jsonUnsafe({ code: "invalid_request" }, { status: 422 });
  const status = {
    unauthorized: 401,
    unsupported_operation: 404,
    invalid_client: 401,
    unsupported_grant_type: 400,
    invalid_user: 422,
    email_exists: 409,
    unsupported_pagination: 422,
    invalid_cursor: 422,
    invalid_limit: 422,
    not_found: 404,
  }[error.reason];
  return Response.jsonUnsafe(
    { code: error.reason, message: error.reason },
    { status },
  );
}
const sanitizeDefects = <A, R>(effect: Effect.Effect<A, never, R>) =>
  effect.pipe(
    Effect.catchCause((cause) =>
      Cause.hasInterrupts(cause)
        ? Effect.failCause(cause)
        : Effect.succeed(
            Response.jsonUnsafe({ code: "internal_error" }, { status: 500 }),
          ),
    ),
  );
// Node's origin-form request target is already a raw path, not a URL to resolve.
// Strip only the query: WHATWG URL parsing would remove literal/encoded dots.
function rawPathname(rawUrl: string) {
  const query = rawUrl.indexOf("?");
  return query === -1 ? rawUrl : rawUrl.slice(0, query);
}
// Compare only static segments using the selected endpoint's own declaration.
// Router decoding must not make an encoded public path publicly accessible.
function matchesRawPath(rawUrl: string, pattern: string) {
  const segments = rawPathname(rawUrl).split("/");
  const expected = pattern.split("/");
  return (
    segments.length === expected.length &&
    expected.every(
      (part, index) => part.startsWith(":") || part === segments[index],
    )
  );
}
function rawUserId(rawUrl: string) {
  return rawPathname(rawUrl).split("/")[3];
}

// WorkOS has multiple non-tagged error envelopes and validation precedence.
// Raw handlers retain request validation precedence and avoid default payload
// decode errors containing credentials. Plain successes still use native encoding.
const api = HttpApi.make("localWorkOS").add(
  HttpApiGroup.make("workos").add(
    HttpApiEndpoint.get("instanceInfo", "/instance-info", {
      success: Schema.Struct({
        providerGeneration: Schema.String,
        issuer: Schema.String,
        clientId: Schema.String,
        port: Schema.Number,
      }),
    }),
    HttpApiEndpoint.get("jwks", "/sso/jwks/:clientId", {
      params: { clientId: Schema.String },
      success: JwksSchema,
    }),
    HttpApiEndpoint.post("authenticate", "/user_management/authenticate", {
      payload: PasswordAuthenticationRequestSchema,
      success: AuthenticationSchema,
    }),
    HttpApiEndpoint.post("createUser", "/user_management/users", {
      payload: CreateUserRequestSchema,
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
function workosResponse<A>(
  apiKey: Redacted.Redacted<string>,
  run: (
    body: Record<string, unknown>,
    request: HttpServerRequest,
  ) => Effect.Effect<A, RequestFailure>,
  options: {
    access?: "bearer";
    path?: string;
  } = {},
) {
  return Effect.gen(function* () {
    const request = yield* HttpServerRequest;
    if (Number(request.headers["content-length"] ?? 0) > MAX_BODY_BYTES)
      return Response.jsonUnsafe({ code: "invalid_request" }, { status: 413 });
    const raw =
      request.method === "POST"
        ? yield* request.json.pipe(
            Effect.mapError(
              () => new RequestRejected({ reason: "invalid_request" }),
            ),
          )
        : {};
    const body = yield* Schema.decodeUnknownEffect(
      Schema.Record(Schema.String, Schema.Unknown),
    )(raw).pipe(
      Effect.mapError(() => new RequestRejected({ reason: "invalid_request" })),
    );
    if (options.access === "bearer")
      yield* requireBearer(
        request.headers.authorization,
        Redacted.value(apiKey),
      );
    if (options.path && !matchesRawPath(request.url, options.path)) {
      yield* requireBearer(
        request.headers.authorization,
        Redacted.value(apiKey),
      );
      return yield* Effect.fail(
        new RequestRejected({ reason: "unsupported_operation" }),
      );
    }
    return yield* run(body, request);
  }).pipe(
    Effect.catch((error) => Effect.succeed(domainResponse(error))),
    sanitizeDefects,
  );
}

// Concrete HTTP boundary; database and server lifecycle remain in provider.ts.
export function makeHttpApp(scope: Scope.Scope) {
  return Effect.gen(function* () {
    const {
      apiKey,
      instanceInfo,
      authenticate,
      createUser,
      listUsers,
      getUser,
      getIdentities,
      jwks,
    } = yield* WorkOSService;
    const { clientId } = yield* instanceInfo;
    const handlers = HttpApiBuilder.group(api, "workos", (handlers) =>
      handlers
        .handleRaw("instanceInfo", ({ endpoint }) =>
          workosResponse(apiKey, () => instanceInfo, { path: endpoint.path }),
        )
        .handleRaw("jwks", ({ params }) =>
          workosResponse(
            apiKey,
            () =>
              params.clientId === clientId
                ? jwks
                : Effect.fail(
                    new RequestRejected({ reason: "unsupported_operation" }),
                  ),
            { path: `/sso/jwks/${clientId}` },
          ),
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
    const routed = yield* HttpRouter.toHttpEffect(
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
    );
    const unsupported = workosResponse(
      apiKey,
      () =>
        Effect.fail(new RequestRejected({ reason: "unsupported_operation" })),
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
            : Effect.die(error),
        ),
      );
    }).pipe(sanitizeDefects);

    return app.pipe(
      Effect.provideService(MaxBodySize, FileSystem.Size(MAX_BODY_BYTES)),
    );
  });
}

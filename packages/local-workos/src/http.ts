import { httpClientId } from "./config.ts";
import { Effect, Scope, FileSystem, Layer, Schema, Redacted } from "effect";
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
  HttpError,
  reject,
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
}
function workosResponse<A>(
  apiKey: Redacted.Redacted<string>,
  run: (
    body: Record<string, unknown>,
    request: HttpServerRequest,
  ) => Effect.Effect<A, HttpError>,
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
    return yield* Effect.gen(function* () {
      if (body === null || typeof body !== "object" || Array.isArray(body))
        return Response.jsonUnsafe(
          { code: "invalid_request" },
          { status: 422 },
        );
      yield* Effect.try({
        try: () => {
          if (options.access === "bearer")
            requireBearer(
              request.headers.authorization,
              Redacted.value(apiKey),
            );
          if (options.path && !matchesRawPath(request.url, options.path)) {
            requireBearer(
              request.headers.authorization,
              Redacted.value(apiKey),
            );
            reject(404, "unsupported_operation");
          }
        },
        catch: (error) =>
          error instanceof HttpError
            ? error
            : new HttpError(500, { code: "internal_error" }),
      });
      return yield* run(body as Record<string, unknown>, request);
    }).pipe(
      Effect.catch((error) =>
        Effect.succeed(
          Response.jsonUnsafe(error.body, { status: error.status }),
        ),
      ),
    );
  }).pipe(
    Effect.catchCause(() =>
      Effect.succeed(
        Response.jsonUnsafe({ code: "invalid_request" }, { status: 422 }),
      ),
    ),
  );
}

// Concrete HTTP boundary; database and server lifecycle remain in provider.ts.
export function makeHttpApp(scope: Scope.Scope) {
  return Effect.gen(function* () {
    const clientId = yield* httpClientId;
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
    const api = makeApi(clientId);
    const handlers = HttpApiBuilder.group(api, "workos", (handlers) =>
      handlers
        .handleRaw("instanceInfo", ({ endpoint }) =>
          workosResponse(apiKey, () => instanceInfo, { path: endpoint.path }),
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
        Effect.fail(
          new HttpError(404, {
            code: "unsupported_operation",
            message: "unsupported_operation",
          }),
        ),
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
                Response.jsonUnsafe(
                  { code: "internal_error" },
                  { status: 500 },
                ),
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
  });
}

import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
} from "effect/unstable/http";
import { Schema } from "effect";
import { Predicate } from "effect";
import {
  HttpServerRequest,
  fromWeb,
} from "effect/unstable/http/HttpServerRequest";
import { toWeb } from "effect/unstable/http/HttpServerResponse";
import { it } from "@effect/vitest";
import {
  Effect,
  Layer,
  Redacted,
  Scope,
  Exit,
  Cause,
  Fiber,
  Deferred,
} from "effect";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import { createServer } from "node:http";
import assert from "node:assert/strict";
import { makeHttpApp } from "../../src/server/workos-http.ts";
import {
  RequestRejected,
  VerificationRequired,
} from "../../src/contracts/workos.ts";
import { WorkOSService } from "../../src/server/workos-service.ts";

it.effect(
  "injects a fake service layer without a database and preserves HTTP guards/errors",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        let creates = 0;
        let finalized = false;
        const waiting = yield* Deferred.make<void>();
        const apiKey = `sk_test_local_${"07".repeat(32)}`;
        const info = {
          clientId: "client_fake",
          issuer: "https://fake.invalid",
          providerGeneration: "fake",
          port: 0,
        };
        const unavailable = Effect.fail(
          new RequestRejected({ reason: "not_found" }),
        );
        const layer = Layer.succeed(
          WorkOSService,
          WorkOSService.of({
            apiKey: Redacted.make(apiKey),
            instanceInfo: Effect.succeed(info),
            jwks: Effect.succeed({ keys: [] }),
            authenticate: () => unavailable,
            createUser: (body) =>
              Effect.suspend(() => {
                if (body.mode === "wait") {
                  return Deferred.succeed(waiting, undefined).pipe(
                    Effect.andThen(Effect.never),
                    Effect.ensuring(
                      Effect.sync(() => {
                        finalized = true;
                      }),
                    ),
                  );
                }
                if (body.mode === "defect") {
                  return Effect.die(new Error("SECRET_DEFECT_PAYLOAD"));
                }
                if (body.mode === "interrupt") {
                  return Effect.interrupt;
                }
                creates++;
                return Effect.fail(
                  new RequestRejected({ reason: "email_exists" }),
                );
              }),
            listUsers: () =>
              Effect.succeed({
                object: "list",
                data: [],
                list_metadata: { before: null, after: null },
              }),
            getUser: () => unavailable,
            getIdentities: () => unavailable,
            getEmailVerification: () => unavailable,
            createPasswordReset: () => unavailable,
            resetPassword: () => unavailable,
            revokeSession: () => unavailable,
            deleteUser: () => unavailable,
          }),
        );
        const scope = yield* Scope.Scope;
        // oxlint-disable-next-line effecttsgo/strict-effect-provide -- This test entry point composes its isolated stub service layer.
        const app = yield* makeHttpApp(scope).pipe(Effect.provide(layer));
        const direct = (mode: string) =>
          app.pipe(
            Effect.provideService(
              HttpServerRequest,
              fromWeb(
                new Request("http://127.0.0.1/user_management/users", {
                  method: "POST",
                  headers: { authorization: `Bearer ${apiKey}` },
                  body: Schema.encodeSync(
                    Schema.fromJsonString(Schema.Unknown),
                  )({ mode }),
                }),
              ),
            ),
          );
        const defect = yield* direct("defect");
        assert.equal(defect.status, 500);
        const defectBody = yield* Effect.promise(() => toWeb(defect).json());
        assert.deepEqual(defectBody, { code: "internal_error" });
        const interrupted = yield* Effect.exit(direct("interrupt"));
        assert.ok(Exit.isFailure(interrupted));
        if (Exit.isFailure(interrupted)) {
          assert.ok(Cause.hasInterruptsOnly(interrupted.cause));
        }
        const waitingRequest = yield* direct("wait").pipe(Effect.forkScoped);
        yield* Deferred.await(waiting);
        yield* Fiber.interrupt(waitingRequest);
        assert.equal(finalized, true);
        const server = yield* NodeHttpServer.make(createServer, {
          host: "127.0.0.1",
          port: 0,
        });
        yield* server.serve(app);
        assert.ok(Predicate.isTagged(server.address, "TcpAddress"));
        if (!Predicate.isTagged(server.address, "TcpAddress")) {
          throw new Error("Expected TCP server");
        }
        const base = `http://127.0.0.1:${server.address.port}`;
        yield* Effect.gen(function* () {
          const instance = yield* HttpClient.get(`${base}/instance-info`);
          assert.equal(instance.status, 200);
          assert.deepEqual(yield* instance.json, info);
          const denied = yield* HttpClient.post(
            `${base}/user_management/users`,
            {
              body: HttpClientRequest.bodyText("{}")(
                HttpClientRequest.post("/"),
              ).body,
            },
          );
          assert.equal(denied.status, 401);
          assert.equal(creates, 0);
          const conflict = yield* HttpClient.post(
            `${base}/user_management/users`,
            {
              headers: { authorization: `Bearer ${apiKey}` },
              body: HttpClientRequest.bodyText("{}")(
                HttpClientRequest.post("/"),
              ).body,
            },
          );
          assert.equal(conflict.status, 409);
          assert.deepEqual(yield* conflict.json, {
            code: "email_exists",
            message: "email_exists",
          });
          assert.equal(creates, 1);
          const list = yield* HttpClient.get(`${base}/user_management/users`, {
            headers: { authorization: `Bearer ${apiKey}` },
          });
          assert.equal(list.status, 200);
          assert.deepEqual(yield* list.json, {
            object: "list",
            data: [],
            list_metadata: { before: null, after: null },
          });
          // oxlint-disable-next-line effecttsgo/strict-effect-provide -- Test entry point supplies its isolated HTTP client layer.
        }).pipe(Effect.provide(FetchHttpClient.layer));
      }),
    ),
);

it.effect(
  "tagged verification failure does not serialize its pending credential",
  () =>
    Effect.gen(function* () {
      const error = new VerificationRequired({
        id: "verification_fixture",
        pending: Redacted.make("SECRET_PENDING_CREDENTIAL"),
      });
      assert.ok(
        !(yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(
          error,
        )).includes("SECRET_PENDING_CREDENTIAL"),
      );
      assert.ok(Predicate.isTagged(error, "VerificationRequired"));
      assert.ok(
        Predicate.isTagged(
          new RequestRejected({ reason: "invalid_client" }),
          "RequestRejected",
        ),
      );
    }),
);

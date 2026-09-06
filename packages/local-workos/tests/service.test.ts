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
import { makeHttpApp } from "../src/http.ts";
import { RequestRejected, VerificationRequired } from "../src/contracts.ts";
import { WorkOSService } from "../src/workos-service.ts";

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
                if (body.mode === "wait")
                  return Deferred.succeed(waiting, undefined).pipe(
                    Effect.andThen(Effect.never),
                    Effect.ensuring(
                      Effect.sync(() => {
                        finalized = true;
                      }),
                    ),
                  );
                if (body.mode === "defect")
                  return Effect.die(new Error("SECRET_DEFECT_PAYLOAD"));
                if (body.mode === "interrupt") return Effect.interrupt;
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
          }),
        );
        const scope = yield* Scope.Scope;
        const app = yield* makeHttpApp(scope).pipe(Effect.provide(layer));
        const direct = (mode: string) =>
          app.pipe(
            Effect.provideService(
              HttpServerRequest,
              fromWeb(
                new Request("http://127.0.0.1/user_management/users", {
                  method: "POST",
                  headers: { authorization: `Bearer ${apiKey}` },
                  body: JSON.stringify({ mode }),
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
        if (Exit.isFailure(interrupted))
          assert.ok(Cause.hasInterruptsOnly(interrupted.cause));
        const waitingRequest = yield* direct("wait").pipe(Effect.forkScoped);
        yield* Deferred.await(waiting);
        yield* Fiber.interrupt(waitingRequest);
        assert.equal(finalized, true);
        const server = yield* NodeHttpServer.make(createServer, {
          host: "127.0.0.1",
          port: 0,
        });
        yield* server.serve(app);
        assert.equal(server.address._tag, "TcpAddress");
        if (server.address._tag !== "TcpAddress")
          throw new Error("Expected TCP server");
        const base = `http://127.0.0.1:${server.address.port}`;
        yield* Effect.promise(async () => {
          const instance = await fetch(`${base}/instance-info`);
          assert.equal(instance.status, 200);
          assert.deepEqual(await instance.json(), info);
          const denied = await fetch(`${base}/user_management/users`, {
            method: "POST",
            body: "{}",
          });
          assert.equal(denied.status, 401);
          assert.equal(creates, 0);
          const conflict = await fetch(`${base}/user_management/users`, {
            method: "POST",
            headers: { authorization: `Bearer ${apiKey}` },
            body: "{}",
          });
          assert.equal(conflict.status, 409);
          assert.deepEqual(await conflict.json(), {
            code: "email_exists",
            message: "email_exists",
          });
          assert.equal(creates, 1);
          const list = await fetch(`${base}/user_management/users`, {
            headers: { authorization: `Bearer ${apiKey}` },
          });
          assert.equal(list.status, 200);
          assert.deepEqual(await list.json(), {
            object: "list",
            data: [],
            list_metadata: { before: null, after: null },
          });
        });
      }),
    ),
);

it.effect(
  "tagged verification failure does not serialize its pending credential",
  () =>
    Effect.sync(() => {
      const error = new VerificationRequired({
        id: "verification_fixture",
        pending: Redacted.make("SECRET_PENDING_CREDENTIAL"),
      });
      assert.ok(!JSON.stringify(error).includes("SECRET_PENDING_CREDENTIAL"));
      assert.equal(error._tag, "VerificationRequired");
      assert.equal(
        new RequestRejected({ reason: "invalid_client" })._tag,
        "RequestRejected",
      );
    }),
);

import { it } from "@effect/vitest";
import { ConfigProvider, Effect, Layer, Redacted, Scope } from "effect";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import { createServer } from "node:http";
import assert from "node:assert/strict";
import { makeHttpApp } from "../src/http.ts";
import { HttpError } from "../src/contracts.ts";
import { WorkOSService } from "../src/workos-service.ts";

it.effect(
  "injects a fake service layer without a database and preserves HTTP guards/errors",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        let creates = 0;
        const apiKey = "sk_test_fake_service";
        const info = {
          clientId: "client_fake",
          issuer: "https://fake.invalid",
          providerGeneration: "fake",
          port: 0,
        };
        const unavailable = Effect.fail(
          new HttpError(404, { code: "not_found" }),
        );
        const layer = Layer.succeed(
          WorkOSService,
          WorkOSService.of({
            apiKey: Redacted.make(apiKey),
            instanceInfo: Effect.succeed(info),
            jwks: Effect.succeed({ keys: [] }),
            authenticate: () => unavailable,
            createUser: () =>
              Effect.suspend(() => {
                creates++;
                return Effect.fail(
                  new HttpError(409, { code: "email_exists" }),
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
        const app = yield* makeHttpApp(scope).pipe(
          Effect.provide(layer),
          Effect.provideService(
            ConfigProvider.ConfigProvider,
            ConfigProvider.fromUnknown({ clientId: info.clientId }),
          ),
        );
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
          assert.deepEqual(await conflict.json(), { code: "email_exists" });
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

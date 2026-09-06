import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkOS } from "@workos-inc/node";
import { createLocalJWKSet, jwtVerify } from "jose";
import { startProvider } from "../src/provider.ts";
test("SDK core persists identities, rejects credentials, signs verified sessions", async () => {
    const dir = await mkdtemp(join(tmpdir(), "local-workos-"));
    const options = { database: join(dir, "state.sqlite"), apiKey: "sk_test_synthetic" };
    let p = await startProvider(options);
    try {
        const sdk = () => new WorkOS(options.apiKey, { apiHostname: "127.0.0.1", port: p.port, https: false });
        await assert.rejects(sdk().userManagement.createUser({ email: "short@example.test", password: "shortpass" }));
        const u = await sdk().userManagement.createUser({ email: "person@example.test", password: "Synthetic-password-42" });
        assert.equal(u.emailVerified, false);
        assert.equal((await sdk().userManagement.listUsers({ email: u.email })).data[0]?.id, u.id);
        assert.deepEqual(await sdk().userManagement.getUserIdentities(u.id), []);
        await assert.rejects(sdk().userManagement.authenticateWithPassword({ clientId: p.clientId, email: u.email, password: "wrong" }));
        await assert.rejects(sdk().userManagement.authenticateWithPassword({ clientId: p.clientId, email: u.email, password: "Synthetic-password-42" }), (e: any) => e.code === "email_verification_required");
        await assert.rejects(sdk().userManagement.authenticateWithPassword({ clientId: "wrong", email: u.email, password: "Synthetic-password-42" }));
        await assert.rejects(new WorkOS("wrong", { apiHostname: "127.0.0.1", port: p.port, https: false }).userManagement.listUsers());
        const v = await sdk().userManagement.createUser({ email: "verified@example.test", password: "Synthetic-password-42", emailVerified: true });
        const session = await sdk().userManagement.authenticateWithPassword({ clientId: p.clientId, email: v.email, password: "Synthetic-password-42" });
        const jwks = await (await fetch(`http://127.0.0.1:${p.port}/sso/jwks/${p.clientId}`)).json();
        const { payload } = await jwtVerify(session.accessToken, createLocalJWKSet(jwks), { issuer: p.issuer, audience: p.clientId });
        assert.equal(payload.sub, v.id);
        assert.equal(payload.client_id, p.clientId);
        assert.ok(payload.sid);
        assert.equal(payload.exp! - payload.iat!, 300);
        await assert.rejects(jwtVerify(session.accessToken, createLocalJWKSet(jwks), { currentDate: new Date((payload.exp! + 1) * 1000) }));
        const inspect = new DatabaseSync(options.database);
        const stored = inspect.prepare("SELECT * FROM sessions WHERE id=?").get(payload.sid as string)!;
        assert.ok(Math.abs(Number(stored.expires_at) - Date.now() - 7 * 86400000) < 5000);
        assert.ok(!JSON.stringify(inspect.prepare("SELECT * FROM users").all()).includes("Synthetic-password-42"));
        assert.ok(!JSON.stringify(stored).includes(session.refreshToken));
        inspect.close();
        const issuer = p.issuer;
        await p.close();
        p = await startProvider(options);
        const reopened = new DatabaseSync(options.database);
        assert.deepEqual(reopened.prepare("SELECT * FROM sessions WHERE id=?").get(payload.sid as string), stored);
        reopened.close();
        assert.equal(p.issuer, issuer);
        assert.equal((await sdk().userManagement.getUser(u.id)).id, u.id);
        await jwtVerify(session.accessToken, createLocalJWKSet(await (await fetch(`http://127.0.0.1:${p.port}/sso/jwks/${p.clientId}`)).json()));
        const sibling = await startProvider({ ...options, database: join(dir, "sibling.sqlite") });
        try {
            assert.notEqual(sibling.issuer, p.issuer);
            const other = new WorkOS(options.apiKey, { apiHostname: "127.0.0.1", port: sibling.port, https: false });
            assert.equal((await other.userManagement.listUsers()).data.length, 0);
            await assert.rejects(other.userManagement.getUser(u.id));
        }
        finally {
            await sibling.close();
        }
    }
    finally {
        await p.close();
        await rm(dir, { recursive: true, force: true });
    }
});

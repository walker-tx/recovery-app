import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, chmod, symlink, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { WorkOS } from '@workos-inc/node';
import { startProvider } from '../src/provider.ts';
async function fixture() {
    const dir = await mkdtemp(join(tmpdir(), 'workos-core-'));
    return { dir, options: { database: join(dir, 'state.sqlite'), apiKey: 'sk_test_synthetic' } };
}
test('reject unsafe state paths without changing targets', async () => {
    const { dir, options } = await fixture();
    try {
        await chmod(dir, 0o777);
        await assert.rejects(startProvider(options));
        await chmod(dir, 0o700);
        const target = join(dir, 'target');
        const db = new DatabaseSync(target);
        db.close();
        await chmod(target, 0o644);
        await symlink(target, options.database);
        await assert.rejects(startProvider(options));
        assert.equal((await stat(target)).mode & 0o777, 0o644);
    }
    finally {
        await rm(dir, { recursive: true, force: true });
    }
});
test('lock failures are bounded and corrupt startup can recover', async (t) => {
    const close = t.mock.method(DatabaseSync.prototype, 'close');
    const { dir, options } = await fixture();
    let p = await startProvider(options);
    await p.close();
    const db = new DatabaseSync(options.database);
    try {
        db.exec('BEGIN EXCLUSIVE');
        const start = performance.now();
        await assert.rejects(startProvider(options));
        assert.ok(performance.now() - start < 1000, 'synchronous lock wait must be short');
        db.exec('ROLLBACK');
        const original = (db.prepare('SELECT body FROM instance').get() as {
            body: string;
        }).body;
        for (const body of ['{', 'null', '{}', JSON.stringify({ ...JSON.parse(original), privateKey: { kty: 'RSA' } })]) {
            db.prepare('UPDATE instance SET body=?').run(body);
            const closedBefore = close.mock.callCount();
            await assert.rejects(startProvider(options));
            assert.equal(close.mock.callCount(), closedBefore + 1);
            db.prepare('UPDATE instance SET body=?').run(original);
            p = await startProvider(options);
            await p.close();
        }
    }
    finally {
        if (db.isTransaction)
            db.exec('ROLLBACK');
        db.close();
        await p.close();
        await rm(dir, { recursive: true, force: true });
    }
});
test('bounded requests, explicit paging and trusted social fixtures', async () => {
    const { dir, options } = await fixture();
    const p = await startProvider(options);
    const sdk = new WorkOS(options.apiKey, { apiHostname: '127.0.0.1', port: p.port, https: false });
    const request = (path: string, init: RequestInit = {}) => fetch(`http://127.0.0.1:${p.port}${path}`, { ...init, signal: AbortSignal.timeout(3000) });
    try {
        for (const body of ['', '{', 'null', '[]', '"secret-marker"', 'x'.repeat(17000)]) {
            const r = await request('/user_management/users', { method: 'POST', body });
            assert.ok(r.status >= 400 && r.status < 500);
            assert.ok(!(await r.text()).includes('secret-marker'));
        }
        for (const secret of [undefined, 'wrong'])
            assert.equal((await request('/user_management/authenticate', { method: 'POST', body: JSON.stringify({ client_id: p.clientId, client_secret: secret, grant_type: 'password' }) })).status, 401);
        for (const authorization of ['', 'Bearer wrong']) {
            for (const method of ['GET', 'POST', 'DELETE'])
                assert.equal((await request('/user_management/users', { method, headers: { authorization }, ...(method === 'POST' ? { body: '{}' } : {}) })).status, 401);
        }
        for (const query of ['before=user_bad', 'order=invalid', 'after=bad', 'limit=0', 'limit=101', 'limit=no'])
            assert.equal((await request('/user_management/users?' + query, { headers: { authorization: `Bearer ${options.apiKey}` } })).status, 422);
        const password = 'Synthetic-password-42';
        const u = await sdk.userManagement.createUser({ email: 'unverified@example.test', password });
        await assert.rejects(sdk.userManagement.authenticateWithPassword({ clientId: p.clientId, email: u.email, password }));
        const db = new DatabaseSync(options.database);
        try {
            assert.equal(db.prepare('SELECT count(*) AS n FROM sessions').get()?.n, 0);
        }
        finally {
            db.close();
        }
        for (const provider of ['GoogleOAuth', 'AppleOAuth'] as const) {
            const user = await p.createIdentityFixture({ email: provider + '@example.test', provider });
            const identities = await sdk.userManagement.getUserIdentities(user.id);
            assert.equal(identities.length, 1);
            assert.equal(identities[0].type, provider);
            assert.equal(identities[0].provider, provider);
            await assert.rejects(sdk.userManagement.authenticateWithPassword({ clientId: p.clientId, email: user.email, password }));
        }
        const ids: string[] = [];
        let after: string | undefined;
        do {
            const page = await sdk.userManagement.listUsers({ limit: 1, after });
            ids.push(...page.data.map(u => u.id));
            after = page.listMetadata.after ?? undefined;
        } while (after);
        assert.equal(new Set(ids).size, 3);
        assert.equal(ids.length, 3);
        const duplicates = await Promise.allSettled([1, 2].map(() => sdk.userManagement.createUser({ email: 'race@example.test', password })));
        assert.equal(duplicates.filter(r => r.status === 'fulfilled').length, 1);
        assert.equal((await stat(options.database)).mode & 0o777, 0o600);
    }
    finally {
        await p.close();
        await rm(dir, { recursive: true, force: true });
    }
});
test('existing sidecars require owner-only permissions and concurrent initialization agrees', async () => {
    const { dir, options } = await fixture();
    try {
        for (const suffix of ['-journal', '-wal', '-shm']) {
            await writeFile(options.database + suffix, '', { mode: 0o644 });
            await assert.rejects(startProvider(options));
            assert.equal((await stat(options.database + suffix)).mode & 0o777, 0o644);
            await rm(options.database + suffix);
        }
        const providers = await Promise.all([startProvider(options), startProvider(options)]);
        try {
            assert.equal(providers[0].issuer, providers[1].issuer);
        }
        finally {
            await Promise.all(providers.map(p => p.close()));
        }
    }
    finally {
        await rm(dir, { recursive: true, force: true });
    }
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { ConvexHttpClient } from 'convex/browser';
import { ConvexReactClient } from 'convex/react';
import { api } from '@recovery/backend/convex/_generated/api.js';
import { createWorkOSSessionActions } from './workos-session-actions.ts';
import { createSessionTransport } from './session-transport.ts';

test('HTTP refresh completes independently without a user JWT or sync transport', async () => {
  let calls = 0;
  const http = new ConvexHttpClient('https://example.convex.cloud', { fetch: async (_url, init) => {
    calls++;
    assert.equal(new Headers(init?.headers).get('Authorization'), null);
    const body = JSON.parse(init?.body as string);
    assert.equal(body.path, 'workosAuth:refreshSession');
    assert.deepEqual(body.args, [{ refreshToken: 'refresh' }]);
    return new Response(JSON.stringify({ status: 'success', value: { status: 'invalid' } }));
  }});
  assert.deepEqual(await createWorkOSSessionActions(http).refreshSession({ refreshToken: 'refresh' }), { status: 'invalid' });
  assert.equal(calls, 1);
});

test('retired queues are never reused; child cleanup precedes close and StrictMode recreation is fresh', async () => {
  const events: string[] = [];
  const factory = () => ({ queue: ['old-unsent'], close: async () => { events.push('close'); } });
  let lifetime = 1;
  const old = createSessionTransport(factory, 1, () => lifetime);
  const pending = old.fetchAccessToken(async () => { lifetime = 2; return 'new-user'; }, { forceRefreshToken: true });
  assert.equal(await pending, null);
  old.retire();
  events.push('child-cleanup');
  const next = createSessionTransport(factory, 2, () => lifetime);
  assert.notEqual(next.client, old.client);
  assert.equal(await old.fetchAccessToken(async () => { throw Error('must not fetch'); }, { forceRefreshToken: true }), null);
  await Promise.resolve();
  assert.deepEqual(events, ['child-cleanup', 'close']);
  assert.equal(await next.fetchAccessToken(async () => 'rotated', { forceRefreshToken: true }), 'rotated');
  const stable = next.client;
  await assert.rejects(next.fetchAccessToken(async () => { throw Error('retry'); }, { forceRefreshToken: true }));
  assert.equal(next.client, stable);
  next.retire();
  const replay = createSessionTransport(factory, 2, () => lifetime);
  assert.notEqual(replay.client, stable);
  replay.retire();
  await Promise.resolve();
});

// Installed SDK classes with a non-network socket; this is not a deployed probe.
test('installed sync action stays unsent while stopped, but HTTP refresh resolves', async () => {
  class Socket {
    onclose: (() => void) | null = null;
    onopen: (() => void) | null = null;
    constructor() { queueMicrotask(() => this.onopen?.()); }
    close() { queueMicrotask(() => this.onclose?.()); }
    send() { throw Error('stopped socket must not send'); }
  }
  const client = new ConvexReactClient('https://example.convex.cloud', { webSocketConstructor: Socket as never, logger: false });
  const sync = (client as unknown as { sync: { webSocketManager: { stop(): Promise<void> } } }).sync;
  await sync.webSocketManager.stop();
  let settled = false;
  void client.action(api.workosAuth.refreshSession, { refreshToken: 'refresh' }).then(() => { settled = true; });
  const http = new ConvexHttpClient('https://example.convex.cloud', { fetch: async () =>
    new Response(JSON.stringify({ status: 'success', value: { status: 'invalid' } })) });
  assert.deepEqual(await createWorkOSSessionActions(http).refreshSession({ refreshToken: 'refresh' }), { status: 'invalid' });
  assert.equal(settled, false);
  await client.close();
  assert.throws(() => client.action(api.workosAuth.refreshSession, { refreshToken: 'refresh' }), /closed/);
});

const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter, getEventListeners } = require("node:events");
const { createReadiness } = require("./stack-readiness.cjs");
const record = {
  ports: {
    provider: 4101,
    metro: 4102,
    convexCloud: 4103,
    convexSite: 4104,
    mailpitHttp: 4105,
    mailpitSmtp: 4106,
  },
};
const response = (body, status = 200) => new Response(body, { status });
test("HTTP uses allocated loopback ports, exact paths and no redirects", async () => {
  const calls = [],
    bodies = ["{}", "packager-status:running", "local-instance", "{}"];
  const adapter = createReadiness({
    fetchImpl: async (url, options) => {
      calls.push([url, options.redirect]);
      return response(bodies.shift());
    },
  });
  for (const name of ["provider", "metro", "convexCloud", "mailpitHttp"])
    assert.equal(await adapter.ready(name, record), true);
  assert.deepEqual(calls, [
    ["http://127.0.0.1:4101/instance-info", "error"],
    ["http://127.0.0.1:4102/status", "error"],
    ["http://127.0.0.1:4103/instance_name", "error"],
    ["http://127.0.0.1:4105/api/v1/info", "error"],
  ]);
});
test("provider reader returns bounded JSON, identity validation belongs to caller", async () => {
  const adapter = createReadiness({
    fetchImpl: async () => response('{"generation":"x"}'),
  });
  assert.deepEqual(await adapter.readProviderInfo(record), { generation: "x" });
});
test("invalid allocations fail closed without I/O", async () => {
  const adapter = createReadiness({
    fetchImpl: () => assert.fail("unexpected I/O"),
  });
  await assert.rejects(adapter.ready("unknown", record), /endpoint/i);
  await assert.rejects(
    adapter.ready("provider", { ports: { provider: "https://example.com" } }),
    /port/i,
  );
});
test("rejects redirects, non-200, wrong Metro, invalid JSON and empty cloud identity", async () => {
  for (const [service, body, status] of [
    ["provider", "{}", 302],
    ["mailpitHttp", "{}", 503],
    ["metro", "no", 200],
    ["provider", "oops", 200],
    ["convexCloud", "", 200],
  ]) {
    const adapter = createReadiness({
      fetchImpl: async () => response(body, status),
    });
    await assert.rejects(adapter.ready(service, record));
  }
});
test("stream cap cancels body before reading remainder", async () => {
  let cancelled = false,
    reads = 0;
  const body = {
    getReader: () => ({
      read: async () => {
        reads++;
        return { done: false, value: Buffer.alloc(5000) };
      },
      cancel: async () => {
        cancelled = true;
      },
      releaseLock() {},
    }),
  };
  const adapter = createReadiness({
    fetchImpl: async () => ({ status: 200, body }),
  });
  await assert.rejects(adapter.readProviderInfo(record), /limit/);
  assert.equal(reads, 2);
  assert.equal(cancelled, true);
});
test("timeout and cancellation abort fetch and remove caller listeners even if I/O ignores signal", async () => {
  let internal;
  const controller = new AbortController();
  const adapter = createReadiness({
    timeoutMs: 15,
    fetchImpl: (_url, { signal }) => {
      internal = signal;
      return new Promise(() => {});
    },
  });
  await assert.rejects(
    adapter.ready("metro", record, { signal: controller.signal }),
    /timeout/i,
  );
  assert.equal(internal.aborted, true);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  const pending = adapter.ready("metro", record, { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending);
  assert.equal(internal.aborted, true);
});
test("stalled body is cancelled on timeout", async () => {
  let cancelled = false;
  const adapter = createReadiness({
    timeoutMs: 15,
    fetchImpl: async () => ({
      status: 200,
      body: {
        getReader: () => ({
          read: () => new Promise(() => {}),
          cancel: async () => {
            cancelled = true;
          },
          releaseLock() {},
        }),
      },
    }),
  });
  await assert.rejects(adapter.ready("provider", record), /timeout/i);
  assert.equal(cancelled, true);
});
function socketFake(parts) {
  const socket = new EventEmitter();
  socket.destroy = () => {
    socket.destroyed = true;
  };
  queueMicrotask(() => {
    for (const part of parts) socket.emit("data", Buffer.from(part));
  });
  return socket;
}
test("SMTP uses own allocated socket, split 220 greeting, no writes, cleanup", async () => {
  let socket;
  const adapter = createReadiness({
    connect: (options) => {
      assert.deepEqual(options, { host: "127.0.0.1", port: 4106 });
      socket = socketFake(["22", "0 Mailpit ready\r\n"]);
      return socket;
    },
  });
  assert.equal(await adapter.ready("mailpitSmtp", record), true);
  assert.equal(socket.destroyed, true);
  assert.equal(socket.eventNames().length, 0);
});
test("SMTP rejects wrong/oversize greetings and closes stalled/cancelled sockets", async () => {
  for (const parts of [["500 no\r\n"], ["x".repeat(513)], []]) {
    let socket;
    const adapter = createReadiness({
      timeoutMs: 15,
      connect: () => (socket = socketFake(parts)),
    });
    await assert.rejects(adapter.ready("mailpitSmtp", record));
    assert.equal(socket.destroyed, true);
    assert.equal(socket.eventNames().length, 0);
  }
  let socket;
  const controller = new AbortController();
  const adapter = createReadiness({ connect: () => (socket = socketFake([])) });
  const pending = adapter.ready("mailpitSmtp", record, {
    signal: controller.signal,
  });
  controller.abort();
  await assert.rejects(pending);
  assert.equal(socket.destroyed, true);
});

test("site pre-push readiness is only an independent TCP connect, never HTTP", async () => {
  for (const event of ["connect", "error", "close", null]) {
    let socket;
    const adapter = createReadiness({
      timeoutMs: 15,
      fetchImpl: () => assert.fail("site has no application health endpoint"),
      connect: (options) => {
        assert.deepEqual(options, { host: "127.0.0.1", port: 4104 });
        socket = socketFake([]);
        if (event) queueMicrotask(() => socket.emit(event));
        return socket;
      },
    });
    if (event === "connect")
      assert.equal(await adapter.ready("convexSite", record), true);
    else await assert.rejects(adapter.ready("convexSite", record));
    assert.equal(socket.destroyed, true);
    assert.equal(socket.eventNames().length, 0);
  }
});
test("site connection respects caller cancellation and destroys socket", async () => {
  const controller = new AbortController();
  const socket = socketFake([]);
  const adapter = createReadiness({ connect: () => socket });
  const pending = adapter.ready("convexSite", record, {
    signal: controller.signal,
  });
  controller.abort();
  await assert.rejects(pending);
  assert.equal(socket.destroyed, true);
  assert.equal(socket.eventNames().length, 0);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});

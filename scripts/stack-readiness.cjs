const net = require("node:net");

// Convex npm 1.44.0 src/cli/lib/localDeployment/run.ts:320-339 checks
// GET /instance_name on the cloud listener (200, deployment-name text).
// Convex 1.44.0 run.ts:66-67 passes --site-proxy-port independently.
// Upstream crates/local_backend/src/main.rs:179-188 starts a separate site
// proxy alongside cloud HTTP (main inspected; matching backend tag unresolved).
// Site pre-push readiness below is TRANSPORT ONLY: no route, identity, or app
// health is implied. Bootstrap must verify exact cloud /instance_name before
// writes; any post-push application-site check is a separate contract.
// Expo CLI 57.0.17 build/src/start/server/metro/dev-server/
// createMetroMiddleware.js:86-89 serves /status as packager-status:running.
// Mailpit v1.31.0 server/server.go:206 mounts GET /api/v1/info;
// server/apiv1/application.go:30-33 encodes JSON (default HTTP 200).
// SMTP: RFC 5321 section 4.2, initial 220 reply.
const paths = {
  provider: "/instance-info",
  metro: "/status",
  convexCloud: "/instance_name",
  mailpitHttp: "/api/v1/info",
};

function allocatedPort(service, record) {
  if (![...Object.keys(paths), "convexSite", "mailpitSmtp"].includes(service)) {
    throw Error("Unknown readiness endpoint");
  }
  const port = record?.ports?.[service];
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw Error("Invalid allocated port");
  return port;
}

function abortable(promise, signal) {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve(promise)
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}

async function readBoundedText(response, { signal, maxBytes = 8192 }) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1)
    throw Error("Invalid byte limit");
  if (!response.body) throw Error("Missing response body");
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0,
    complete = false;
  const cancel = () => {
    Promise.resolve(reader.cancel()).catch(() => {});
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await abortable(reader.read(), signal);
      if (done) {
        complete = true;
        break;
      }
      total += value.byteLength;
      if (total > maxBytes) throw Error("Response byte limit exceeded");
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, total).toString("utf8");
  } finally {
    signal.removeEventListener("abort", cancel);
    if (!complete) cancel();
    reader.releaseLock();
  }
}

function createReadiness({
  fetchImpl = globalThis.fetch,
  connect = net.createConnection,
  timeoutMs = 2000,
} = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000)
    throw Error("Invalid readiness timeout");
  async function bounded(operation, signal) {
    const controller = new AbortController();
    const abort = () => controller.abort(signal.reason);
    if (signal?.aborted) throw signal.reason;
    signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(
      () => controller.abort(Error("Readiness timeout")),
      timeoutMs,
    );
    try {
      return await abortable(operation(controller.signal), controller.signal);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    }
  }

  async function http(service, record, signal) {
    const port = allocatedPort(service, record);
    const url = `http://127.0.0.1:${port}${paths[service]}`;
    const response = await abortable(
      fetchImpl(url, { signal, redirect: "error" }),
      signal,
    );
    if (response.status !== 200 || response.redirected) {
      if (response.body)
        Promise.resolve(response.body.cancel()).catch(() => {});
      throw Error("Unexpected readiness HTTP response");
    }
    return readBoundedText(response, { signal });
  }

  function smtp(port, signal) {
    return new Promise((resolve, reject) => {
      const socket = connect({ host: "127.0.0.1", port });
      let greeting = Buffer.alloc(0),
        settled = false;
      function finish(error) {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", abort);
        socket.removeListener("data", data);
        socket.removeListener("error", failed);
        socket.removeListener("end", ended);
        socket.removeListener("close", ended);
        socket.destroy(); // No EHLO, MAIL, RCPT or DATA: greeting only.
        if (error) reject(error);
        else resolve(true);
      }
      const abort = () => finish(signal.reason);
      const failed = () => finish(Error("SMTP connection failed"));
      const ended = () => finish(Error("SMTP closed before greeting"));
      const data = (chunk) => {
        if (greeting.length + chunk.length > 512)
          return finish(Error("SMTP greeting byte limit exceeded"));
        greeting = Buffer.concat([greeting, chunk]);
        const text = greeting.toString("ascii");
        if (text.includes("\r\n")) {
          finish(
            /^220 [^\r\n]*\r\n$/.test(text)
              ? undefined
              : Error("Invalid SMTP greeting"),
          );
        }
      };
      socket.on("data", data);
      socket.once("error", failed);
      socket.once("end", ended);
      socket.once("close", ended);
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    });
  }

  function siteListener(port, signal) {
    return new Promise((resolve, reject) => {
      const socket = connect({ host: "127.0.0.1", port });
      let settled = false;
      function finish(error) {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", abort);
        socket.removeListener("connect", connected);
        socket.removeListener("error", failed);
        socket.removeListener("close", closed);
        socket.destroy(); // No HTTP request: application routes may not exist yet.
        if (error) reject(error);
        else resolve(true);
      }
      const connected = () => finish();
      const failed = () => finish(Error("Site listener connection failed"));
      const closed = () => finish(Error("Site listener closed before connect"));
      const abort = () => finish(signal.reason);
      socket.once("connect", connected);
      socket.once("error", failed);
      socket.once("close", closed);
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    });
  }

  async function readProviderInfo(record, { signal } = {}) {
    return bounded(
      async (inner) => JSON.parse(await http("provider", record, inner)),
      signal,
    );
  }

  async function ready(service, record, { signal } = {}) {
    const port = allocatedPort(service, record);
    return bounded(async (inner) => {
      if (service === "convexSite") return siteListener(port, inner);
      if (service === "mailpitSmtp") return smtp(port, inner);
      const text = await http(service, record, inner);
      if (service === "metro" && text !== "packager-status:running")
        throw Error("Metro not ready");
      if (service === "convexCloud" && !text.trim())
        throw Error("Missing Convex instance name");
      if (service === "provider" || service === "mailpitHttp") JSON.parse(text);
      return true;
    }, signal);
  }
  // One attempt per endpoint: lifecycle owns startup budget; no hidden retry delay.
  return { ready, readProviderInfo };
}

module.exports = { createReadiness, readBoundedText };

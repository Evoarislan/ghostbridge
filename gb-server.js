// gb-server.js
//
// Host side of the PhantomJS `webserver` module (Session 8, Part 3).
//
// The user script runs in the runtime page, so the listening socket lives
// here in Node. An incoming request is delivered into the runtime
// (window.__gbServe) where the script's handler runs with PhantomJS-shaped
// request/response objects. The response is buffered in the runtime and sent
// to the client by one 'server'/'send' channel call when the handler closes
// it (response.close / closeGracefully), so a client sees the same bytes
// PhantomJS would send, without streaming partial writes.
//
// Ops (all through the sync channel, op 'server'):
//   listen {id, host, port}  -> true if the socket is bound, false if not
//   close  {id}              -> true
//   send   {reqId, statusCode, headers, body, encoding} -> true

const http = require('http');

function createServerHost(ctx, deliver) {
  const servers = new Map(); // id -> http.Server
  const pending = new Map(); // reqId -> http.ServerResponse
  let nextReq = 1;

  function readBody(req) {
    return new Promise((resolve) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', () => resolve(Buffer.concat(chunks)));
    });
  }

  function onRequest(id, req, res) {
    (async () => {
      const body = await readBody(req);
      const reqId = nextReq++;
      pending.set(reqId, res);
      res.on('close', () => pending.delete(reqId));
      ctx.state.lastActivity = Date.now();
      const headers = {};
      for (const [k, v] of Object.entries(req.headers)) headers[k] = Array.isArray(v) ? v.join(', ') : v;
      await deliver('server', 'request', {
        serverId: id, reqId,
        method: req.method, url: req.url, httpVersion: req.httpVersion,
        headers,
        // PhantomJS gives post/postRaw only for requests that carry a body method.
        postRaw: /^(POST|PUT|PATCH)$/.test(req.method) ? body.toString('utf8') : null,
      });
    })();
  }

  function listen(payload) {
    const { id, host, port } = payload;
    return new Promise((resolve) => {
      const srv = http.createServer((req, res) => onRequest(id, req, res));
      srv.on('error', () => resolve(false));
      srv.listen(port, host || '0.0.0.0', () => {
        servers.set(id, srv);
        resolve(true);
      });
    });
  }

  function close(payload) {
    const srv = servers.get(payload.id);
    servers.delete(payload.id);
    if (srv) { try { srv.close(); srv.closeAllConnections && srv.closeAllConnections(); } catch {} }
    return true;
  }

  function send(payload) {
    const res = pending.get(payload.reqId);
    if (!res) return false; // client went away, or already answered
    pending.delete(payload.reqId);
    const body = Buffer.from(String(payload.body == null ? '' : payload.body), payload.encoding === 'binary' ? 'latin1' : 'utf8');
    try {
      res.statusCode = payload.statusCode;
      for (const [k, v] of Object.entries(payload.headers || {})) res.setHeader(k, v);
      if (!res.hasHeader('content-length')) res.setHeader('Content-Length', body.length);
      res.end(body);
    } catch {}
    return true;
  }

  async function call(payload) {
    const p = payload || {};
    if (p.fn === 'listen') return listen(p);
    if (p.fn === 'close') return close(p);
    if (p.fn === 'send') return send(p);
    throw new Error('unknown server op ' + p.fn);
  }

  function closeAll() {
    for (const id of Array.from(servers.keys())) close({ id });
  }

  return { call, closeAll, listening: () => servers.size };
}

module.exports = { createServerHost };

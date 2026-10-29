#!/usr/bin/env node
/**
 * Optional Local CORS Proxy for LegendKeeper v3 API -> Foundry VTT
 *
 * LegendKeeper's v3 REST API is designed for server-side requests and may block
 * direct browser Origin headers via CORS. Since Foundry VTT modules execute in the
 * browser, run this lightweight zero-dependency proxy if your browser blocks direct
 * calls to https://www.legendkeeper.com:
 *
 *   node tools/lk-cors-proxy.mjs
 *
 * Then set "API Base URL / CORS Proxy" in Foundry Module Settings to:
 *   http://localhost:8787
 */

import http from "node:http";
import https from "node:https";
import { URL } from "node:url";

const PORT = Number(process.env.LK_PROXY_PORT || 8787);
const HOST = process.env.LK_PROXY_HOST || "0.0.0.0";
const TARGET_ORIGIN = (process.env.LK_TARGET_ORIGIN || "https://www.legendkeeper.com").replace(/\/+$/, "");

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept, If-Match, Idempotency-Key, X-Request-Id",
  "Access-Control-Expose-Headers": "ETag, X-Request-Id, Retry-After, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, Idempotent-Replay"
};

const server = http.createServer((req, res) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }

  const targetUrl = new URL(req.url || "/", `${TARGET_ORIGIN}/`);
  const forwardHeaders = {
    host: targetUrl.host,
    accept: req.headers["accept"] || "application/json",
    "user-agent": "@legendkeeper/sdk/4.1.0 (FoundryVTT-Sync-Proxy)"
  };

  for (const headerName of [
    "authorization",
    "content-type",
    "content-length",
    "if-match",
    "idempotency-key",
    "x-request-id"
  ]) {
    if (req.headers[headerName] !== undefined) {
      forwardHeaders[headerName] = req.headers[headerName];
    }
  }

  const client = targetUrl.protocol === "https:" ? https : http;
  const proxyReq = client.request(
    targetUrl,
    {
      method: req.method,
      headers: forwardHeaders
    },
    (proxyRes) => {
      const responseHeaders = { ...CORS_HEADERS };
      for (const [k, v] of Object.entries(proxyRes.headers)) {
        if (v !== undefined && !k.toLowerCase().startsWith("access-control-")) {
          responseHeaders[k] = v;
        }
      }
      res.writeHead(proxyRes.statusCode || 502, responseHeaders);
      proxyRes.pipe(res, { end: true });
    }
  );

  proxyReq.on("error", (err) => {
    console.error("[LK-CORS-Proxy] Upstream error:", err.message);
    res.writeHead(502, { ...CORS_HEADERS, "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        code: "CONNECTION_ERROR",
        message: `Proxy failed to reach ${TARGET_ORIGIN}: ${err.message}`
      })
    );
  });

  req.pipe(proxyReq, { end: true });
});

server.listen(PORT, HOST, () => {
  console.log(`LegendKeeper CORS Proxy listening on http://${HOST}:${PORT} -> ${TARGET_ORIGIN}`);
});

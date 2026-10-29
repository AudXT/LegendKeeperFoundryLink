/**
 * LegendKeeper CORS Proxy — Cloudflare Worker (One-Time Setup)
 *
 * Works from any location, network, or user over HTTPS with zero server maintenance.
 *
 * Setup (takes ~1 minute):
 * 1. Go to https://dash.cloudflare.com -> "Workers & Pages" -> "Create" -> "Create Worker"
 * 2. Name it e.g. `lk-cors-proxy` and click "Deploy"
 * 3. Click "Edit code", replace the file contents with this script, and click "Deploy"
 * 4. Copy your Worker URL (e.g. `https://lk-cors-proxy.<your-subdomain>.workers.dev`)
 *    and paste it into Foundry VTT -> Module Settings -> "LegendKeeper API Base URL".
 */

const TARGET_ORIGIN = "https://www.legendkeeper.com";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Authorization, Content-Type, Accept, Idempotency-Key, If-Match, X-Requested-With",
  "Access-Control-Expose-Headers":
    "ETag, Retry-After, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, X-Request-Id",
  "Access-Control-Max-Age": "86400"
};

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const incomingUrl = new URL(request.url);
    const targetUrl = new URL(incomingUrl.pathname + incomingUrl.search, TARGET_ORIGIN);

    const upstreamHeaders = new Headers(request.headers);
    upstreamHeaders.delete("host");
    upstreamHeaders.delete("origin");
    upstreamHeaders.delete("referer");

    const upstreamResponse = await fetch(targetUrl.toString(), {
      method: request.method,
      headers: upstreamHeaders,
      body: request.method !== "GET" && request.method !== "HEAD" ? request.body : undefined,
      redirect: "follow"
    });

    const responseHeaders = new Headers(upstreamResponse.headers);
    for (const [k, v] of Object.entries(CORS_HEADERS)) {
      responseHeaders.set(k, v);
    }

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: responseHeaders
    });
  }
};

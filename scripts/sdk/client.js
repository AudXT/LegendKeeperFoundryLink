/**
 * LegendKeeper v3 API Client for Foundry VTT
 * Adapted from @legendkeeper/sdk v4.1.0 with browser/Foundry compatibility
 */

const OPERATIONS = [
  { id: "createAssetFolder", namespace: "assets", method: "createFolder", httpMethod: "POST", path: "/api/v3/projects/{projectId}/assets", pathParams: ["projectId"], queryParams: [], headerParams: ["idempotency-key"], hasBody: true, paginated: false, returnsList: false },
  { id: "createImageAsset", namespace: "assets", method: "createImage", httpMethod: "POST", path: "/api/v3/projects/{projectId}/assets/images", pathParams: ["projectId"], queryParams: [], headerParams: ["idempotency-key"], hasBody: true, paginated: false, returnsList: false },
  { id: "createImageUpload", namespace: "assets", method: "createImageUpload", httpMethod: "POST", path: "/api/v3/projects/{projectId}/assets/uploads", pathParams: ["projectId"], queryParams: [], headerParams: ["idempotency-key"], hasBody: true, paginated: false, returnsList: false },
  { id: "deleteAsset", namespace: "assets", method: "delete", httpMethod: "DELETE", path: "/api/v3/projects/{projectId}/assets/{assetId}", pathParams: ["projectId", "assetId"], queryParams: [], headerParams: [], hasBody: false, paginated: false, returnsList: false },
  { id: "getAsset", namespace: "assets", method: "get", httpMethod: "GET", path: "/api/v3/projects/{projectId}/assets/{assetId}", pathParams: ["projectId", "assetId"], queryParams: [], headerParams: [], hasBody: false, paginated: false, returnsList: false },
  { id: "listAssets", namespace: "assets", method: "list", httpMethod: "GET", path: "/api/v3/projects/{projectId}/assets", pathParams: ["projectId"], queryParams: ["cursor", "limit", "folderId"], headerParams: [], hasBody: false, paginated: true, returnsList: true },
  { id: "updateAsset", namespace: "assets", method: "update", httpMethod: "PATCH", path: "/api/v3/projects/{projectId}/assets/{assetId}", pathParams: ["projectId", "assetId"], queryParams: [], headerParams: [], hasBody: true, paginated: false, returnsList: false },

  { id: "createBlockProperty", namespace: "blocks", method: "createProperty", httpMethod: "POST", path: "/api/v3/projects/{projectId}/resources/{resourceId}/docs/{documentId}/blocks/{blockId}/properties", pathParams: ["projectId", "resourceId", "documentId", "blockId"], queryParams: [], headerParams: ["if-match", "idempotency-key"], hasBody: true, paginated: false, returnsList: false },
  { id: "createBlockPropertyRow", namespace: "blocks", method: "createPropertyRow", httpMethod: "POST", path: "/api/v3/projects/{projectId}/resources/{resourceId}/docs/{documentId}/blocks/{blockId}/properties/{propertyId}/rows", pathParams: ["projectId", "resourceId", "documentId", "blockId", "propertyId"], queryParams: [], headerParams: ["if-match", "idempotency-key"], hasBody: true, paginated: false, returnsList: false },
  { id: "createBlockRow", namespace: "blocks", method: "createRow", httpMethod: "POST", path: "/api/v3/projects/{projectId}/resources/{resourceId}/docs/{documentId}/blocks/{blockId}/rows", pathParams: ["projectId", "resourceId", "documentId", "blockId"], queryParams: [], headerParams: ["if-match", "idempotency-key"], hasBody: true, paginated: false, returnsList: false },
  { id: "deleteBlock", namespace: "blocks", method: "delete", httpMethod: "DELETE", path: "/api/v3/projects/{projectId}/resources/{resourceId}/docs/{documentId}/blocks/{blockId}", pathParams: ["projectId", "resourceId", "documentId", "blockId"], queryParams: [], headerParams: ["if-match"], hasBody: false, paginated: false, returnsList: false },
  { id: "deleteBlockProperty", namespace: "blocks", method: "deleteProperty", httpMethod: "DELETE", path: "/api/v3/projects/{projectId}/resources/{resourceId}/docs/{documentId}/blocks/{blockId}/properties/{propertyId}", pathParams: ["projectId", "resourceId", "documentId", "blockId", "propertyId"], queryParams: [], headerParams: ["if-match"], hasBody: false, paginated: false, returnsList: false },
  { id: "deleteBlockPropertyRow", namespace: "blocks", method: "deletePropertyRow", httpMethod: "DELETE", path: "/api/v3/projects/{projectId}/resources/{resourceId}/docs/{documentId}/blocks/{blockId}/properties/{propertyId}/rows/{rowId}", pathParams: ["projectId", "resourceId", "documentId", "blockId", "propertyId", "rowId"], queryParams: [], headerParams: ["if-match"], hasBody: false, paginated: false, returnsList: false },
  { id: "deleteBlockRow", namespace: "blocks", method: "deleteRow", httpMethod: "DELETE", path: "/api/v3/projects/{projectId}/resources/{resourceId}/docs/{documentId}/blocks/{blockId}/rows/{rowId}", pathParams: ["projectId", "resourceId", "documentId", "blockId", "rowId"], queryParams: [], headerParams: ["if-match"], hasBody: false, paginated: false, returnsList: false },
  { id: "getBlock", namespace: "blocks", method: "get", httpMethod: "GET", path: "/api/v3/projects/{projectId}/resources/{resourceId}/docs/{documentId}/blocks/{blockId}", pathParams: ["projectId", "resourceId", "documentId", "blockId"], queryParams: [], headerParams: [], hasBody: false, paginated: false, returnsList: false },
  { id: "getBlockProperty", namespace: "blocks", method: "getProperty", httpMethod: "GET", path: "/api/v3/projects/{projectId}/resources/{resourceId}/docs/{documentId}/blocks/{blockId}/properties/{propertyId}", pathParams: ["projectId", "resourceId", "documentId", "blockId", "propertyId"], queryParams: [], headerParams: [], hasBody: false, paginated: false, returnsList: false },
  { id: "insertBlock", namespace: "blocks", method: "insert", httpMethod: "POST", path: "/api/v3/projects/{projectId}/resources/{resourceId}/docs/{documentId}/blocks", pathParams: ["projectId", "resourceId", "documentId"], queryParams: [], headerParams: ["if-match", "idempotency-key"], hasBody: true, paginated: false, returnsList: false },
  { id: "listBlockProperties", namespace: "blocks", method: "listProperties", httpMethod: "GET", path: "/api/v3/projects/{projectId}/resources/{resourceId}/docs/{documentId}/blocks/{blockId}/properties", pathParams: ["projectId", "resourceId", "documentId", "blockId"], queryParams: [], headerParams: [], hasBody: false, paginated: false, returnsList: true },
  { id: "listBlockPropertyRows", namespace: "blocks", method: "listPropertyRows", httpMethod: "GET", path: "/api/v3/projects/{projectId}/resources/{resourceId}/docs/{documentId}/blocks/{blockId}/properties/{propertyId}/rows", pathParams: ["projectId", "resourceId", "documentId", "blockId", "propertyId"], queryParams: [], headerParams: [], hasBody: false, paginated: false, returnsList: true },
  { id: "listBlockRows", namespace: "blocks", method: "listRows", httpMethod: "GET", path: "/api/v3/projects/{projectId}/resources/{resourceId}/docs/{documentId}/blocks/{blockId}/rows", pathParams: ["projectId", "resourceId", "documentId", "blockId"], queryParams: [], headerParams: [], hasBody: false, paginated: false, returnsList: true },
  { id: "moveBlock", namespace: "blocks", method: "move", httpMethod: "POST", path: "/api/v3/projects/{projectId}/resources/{resourceId}/docs/{documentId}/blocks/{blockId}/move", pathParams: ["projectId", "resourceId", "documentId", "blockId"], queryParams: [], headerParams: ["if-match", "idempotency-key"], hasBody: true, paginated: false, returnsList: false },
  { id: "replaceBlock", namespace: "blocks", method: "replace", httpMethod: "PUT", path: "/api/v3/projects/{projectId}/resources/{resourceId}/docs/{documentId}/blocks/{blockId}", pathParams: ["projectId", "resourceId", "documentId", "blockId"], queryParams: [], headerParams: ["if-match"], hasBody: true, paginated: false, returnsList: false },
  { id: "updateBlock", namespace: "blocks", method: "update", httpMethod: "PATCH", path: "/api/v3/projects/{projectId}/resources/{resourceId}/docs/{documentId}/blocks/{blockId}", pathParams: ["projectId", "resourceId", "documentId", "blockId"], queryParams: [], headerParams: ["if-match"], hasBody: true, paginated: false, returnsList: false },
  { id: "updateBlockProperty", namespace: "blocks", method: "updateProperty", httpMethod: "PATCH", path: "/api/v3/projects/{projectId}/resources/{resourceId}/docs/{documentId}/blocks/{blockId}/properties/{propertyId}", pathParams: ["projectId", "resourceId", "documentId", "blockId", "propertyId"], queryParams: [], headerParams: ["if-match"], hasBody: true, paginated: false, returnsList: false },
  { id: "updateBlockPropertyRow", namespace: "blocks", method: "updatePropertyRow", httpMethod: "PATCH", path: "/api/v3/projects/{projectId}/resources/{resourceId}/docs/{documentId}/blocks/{blockId}/properties/{propertyId}/rows/{rowId}", pathParams: ["projectId", "resourceId", "documentId", "blockId", "propertyId", "rowId"], queryParams: [], headerParams: ["if-match"], hasBody: true, paginated: false, returnsList: false },
  { id: "updateBlockRow", namespace: "blocks", method: "updateRow", httpMethod: "PATCH", path: "/api/v3/projects/{projectId}/resources/{resourceId}/docs/{documentId}/blocks/{blockId}/rows/{rowId}", pathParams: ["projectId", "resourceId", "documentId", "blockId", "rowId"], queryParams: [], headerParams: ["if-match"], hasBody: true, paginated: false, returnsList: false },

  { id: "assignBlockIds", namespace: "documents", method: "assignBlockIds", httpMethod: "POST", path: "/api/v3/projects/{projectId}/resources/{resourceId}/docs/{documentId}/block-ids", pathParams: ["projectId", "resourceId", "documentId"], queryParams: [], headerParams: ["idempotency-key"], hasBody: false, paginated: false, returnsList: false },
  { id: "createDocument", namespace: "documents", method: "create", httpMethod: "POST", path: "/api/v3/projects/{projectId}/resources/{resourceId}/docs", pathParams: ["projectId", "resourceId"], queryParams: [], headerParams: ["idempotency-key"], hasBody: true, paginated: false, returnsList: false },
  { id: "deleteDocument", namespace: "documents", method: "delete", httpMethod: "DELETE", path: "/api/v3/projects/{projectId}/resources/{resourceId}/docs/{documentId}", pathParams: ["projectId", "resourceId", "documentId"], queryParams: [], headerParams: [], hasBody: false, paginated: false, returnsList: false },
  { id: "getDocument", namespace: "documents", method: "get", httpMethod: "GET", path: "/api/v3/projects/{projectId}/resources/{resourceId}/docs/{documentId}", pathParams: ["projectId", "resourceId", "documentId"], queryParams: [], headerParams: [], hasBody: false, paginated: false, returnsList: false },
  { id: "getDocumentBlocks", namespace: "documents", method: "getBlocks", httpMethod: "GET", path: "/api/v3/projects/{projectId}/resources/{resourceId}/docs/{documentId}/blocks", pathParams: ["projectId", "resourceId", "documentId"], queryParams: [], headerParams: [], hasBody: false, paginated: false, returnsList: false },
  { id: "listDocuments", namespace: "documents", method: "list", httpMethod: "GET", path: "/api/v3/projects/{projectId}/resources/{resourceId}/docs", pathParams: ["projectId", "resourceId"], queryParams: [], headerParams: [], hasBody: false, paginated: false, returnsList: true },
  { id: "replaceDocumentBlocks", namespace: "documents", method: "replaceBlocks", httpMethod: "PUT", path: "/api/v3/projects/{projectId}/resources/{resourceId}/docs/{documentId}/blocks", pathParams: ["projectId", "resourceId", "documentId"], queryParams: [], headerParams: ["if-match"], hasBody: true, paginated: false, returnsList: false },
  { id: "restoreDocument", namespace: "documents", method: "restore", httpMethod: "POST", path: "/api/v3/projects/{projectId}/resources/{resourceId}/docs/{documentId}/restore", pathParams: ["projectId", "resourceId", "documentId"], queryParams: [], headerParams: ["idempotency-key"], hasBody: false, paginated: false, returnsList: false },
  { id: "updateDocument", namespace: "documents", method: "update", httpMethod: "PATCH", path: "/api/v3/projects/{projectId}/resources/{resourceId}/docs/{documentId}", pathParams: ["projectId", "resourceId", "documentId"], queryParams: [], headerParams: [], hasBody: true, paginated: false, returnsList: false },

  { id: "createFeature", namespace: "features", method: "create", httpMethod: "POST", path: "/api/v3/projects/{projectId}/resources/{resourceId}/docs/{documentId}/features", pathParams: ["projectId", "resourceId", "documentId"], queryParams: [], headerParams: ["idempotency-key"], hasBody: true, paginated: false, returnsList: false },
  { id: "deleteFeature", namespace: "features", method: "delete", httpMethod: "DELETE", path: "/api/v3/projects/{projectId}/resources/{resourceId}/docs/{documentId}/features/{featureId}", pathParams: ["projectId", "resourceId", "documentId", "featureId"], queryParams: [], headerParams: [], hasBody: false, paginated: false, returnsList: false },
  { id: "getFeature", namespace: "features", method: "get", httpMethod: "GET", path: "/api/v3/projects/{projectId}/resources/{resourceId}/docs/{documentId}/features/{featureId}", pathParams: ["projectId", "resourceId", "documentId", "featureId"], queryParams: [], headerParams: [], hasBody: false, paginated: false, returnsList: false },
  { id: "listFeatures", namespace: "features", method: "list", httpMethod: "GET", path: "/api/v3/projects/{projectId}/resources/{resourceId}/docs/{documentId}/features", pathParams: ["projectId", "resourceId", "documentId"], queryParams: ["type"], headerParams: [], hasBody: false, paginated: false, returnsList: true },
  { id: "updateFeature", namespace: "features", method: "update", httpMethod: "PATCH", path: "/api/v3/projects/{projectId}/resources/{resourceId}/docs/{documentId}/features/{featureId}", pathParams: ["projectId", "resourceId", "documentId", "featureId"], queryParams: [], headerParams: [], hasBody: true, paginated: false, returnsList: false },

  { id: "getProject", namespace: "projects", method: "get", httpMethod: "GET", path: "/api/v3/projects/{projectId}", pathParams: ["projectId"], queryParams: [], headerParams: [], hasBody: false, paginated: false, returnsList: false },
  { id: "listProjects", namespace: "projects", method: "list", httpMethod: "GET", path: "/api/v3/projects", pathParams: [], queryParams: ["cursor", "limit"], headerParams: [], hasBody: false, paginated: true, returnsList: true },

  { id: "createProperty", namespace: "properties", method: "create", httpMethod: "POST", path: "/api/v3/projects/{projectId}/resources/{resourceId}/properties", pathParams: ["projectId", "resourceId"], queryParams: [], headerParams: ["idempotency-key"], hasBody: true, paginated: false, returnsList: false },
  { id: "createPropertyRow", namespace: "properties", method: "createRow", httpMethod: "POST", path: "/api/v3/projects/{projectId}/resources/{resourceId}/properties/{propertyId}/rows", pathParams: ["projectId", "resourceId", "propertyId"], queryParams: [], headerParams: ["if-match", "idempotency-key"], hasBody: true, paginated: false, returnsList: false },
  { id: "deleteProperty", namespace: "properties", method: "delete", httpMethod: "DELETE", path: "/api/v3/projects/{projectId}/resources/{resourceId}/properties/{propertyId}", pathParams: ["projectId", "resourceId", "propertyId"], queryParams: [], headerParams: [], hasBody: false, paginated: false, returnsList: false },
  { id: "deletePropertyRow", namespace: "properties", method: "deleteRow", httpMethod: "DELETE", path: "/api/v3/projects/{projectId}/resources/{resourceId}/properties/{propertyId}/rows/{rowId}", pathParams: ["projectId", "resourceId", "propertyId", "rowId"], queryParams: [], headerParams: ["if-match"], hasBody: false, paginated: false, returnsList: false },
  { id: "getProperty", namespace: "properties", method: "get", httpMethod: "GET", path: "/api/v3/projects/{projectId}/resources/{resourceId}/properties/{propertyId}", pathParams: ["projectId", "resourceId", "propertyId"], queryParams: [], headerParams: [], hasBody: false, paginated: false, returnsList: false },
  { id: "listProperties", namespace: "properties", method: "list", httpMethod: "GET", path: "/api/v3/projects/{projectId}/resources/{resourceId}/properties", pathParams: ["projectId", "resourceId"], queryParams: [], headerParams: [], hasBody: false, paginated: false, returnsList: true },
  { id: "listPropertyRows", namespace: "properties", method: "listRows", httpMethod: "GET", path: "/api/v3/projects/{projectId}/resources/{resourceId}/properties/{propertyId}/rows", pathParams: ["projectId", "resourceId", "propertyId"], queryParams: [], headerParams: [], hasBody: false, paginated: false, returnsList: true },
  { id: "updateProperty", namespace: "properties", method: "update", httpMethod: "PATCH", path: "/api/v3/projects/{projectId}/resources/{resourceId}/properties/{propertyId}", pathParams: ["projectId", "resourceId", "propertyId"], queryParams: [], headerParams: [], hasBody: true, paginated: false, returnsList: false },
  { id: "updatePropertyRow", namespace: "properties", method: "updateRow", httpMethod: "PATCH", path: "/api/v3/projects/{projectId}/resources/{resourceId}/properties/{propertyId}/rows/{rowId}", pathParams: ["projectId", "resourceId", "propertyId", "rowId"], queryParams: [], headerParams: ["if-match"], hasBody: true, paginated: false, returnsList: false },

  { id: "createResource", namespace: "resources", method: "create", httpMethod: "POST", path: "/api/v3/projects/{projectId}/resources", pathParams: ["projectId"], queryParams: [], headerParams: ["idempotency-key"], hasBody: true, paginated: false, returnsList: false },
  { id: "createResourceFromTemplate", namespace: "resources", method: "createFromTemplate", httpMethod: "POST", path: "/api/v3/projects/{projectId}/resources/from-template", pathParams: ["projectId"], queryParams: [], headerParams: ["idempotency-key"], hasBody: true, paginated: false, returnsList: false },
  { id: "createManyResources", namespace: "resources", method: "createMany", httpMethod: "POST", path: "/api/v3/projects/{projectId}/resources/batch", pathParams: ["projectId"], queryParams: [], headerParams: ["idempotency-key"], hasBody: true, paginated: false, returnsList: false },
  { id: "deleteResource", namespace: "resources", method: "delete", httpMethod: "DELETE", path: "/api/v3/projects/{projectId}/resources/{resourceId}", pathParams: ["projectId", "resourceId"], queryParams: ["cascade"], headerParams: [], hasBody: false, paginated: false, returnsList: false },
  { id: "getResource", namespace: "resources", method: "get", httpMethod: "GET", path: "/api/v3/projects/{projectId}/resources/{resourceId}", pathParams: ["projectId", "resourceId"], queryParams: [], headerParams: [], hasBody: false, paginated: false, returnsList: false },
  { id: "listResources", namespace: "resources", method: "list", httpMethod: "GET", path: "/api/v3/projects/{projectId}/resources", pathParams: ["projectId"], queryParams: ["cursor", "limit", "parentId"], headerParams: [], hasBody: false, paginated: true, returnsList: true },
  { id: "moveResource", namespace: "resources", method: "move", httpMethod: "POST", path: "/api/v3/projects/{projectId}/resources/{resourceId}/move", pathParams: ["projectId", "resourceId"], queryParams: [], headerParams: ["idempotency-key"], hasBody: true, paginated: false, returnsList: false },
  { id: "restoreResource", namespace: "resources", method: "restore", httpMethod: "POST", path: "/api/v3/projects/{projectId}/resources/{resourceId}/restore", pathParams: ["projectId", "resourceId"], queryParams: [], headerParams: ["idempotency-key"], hasBody: false, paginated: false, returnsList: false },
  { id: "saveResourceAsTemplate", namespace: "resources", method: "saveAsTemplate", httpMethod: "POST", path: "/api/v3/projects/{projectId}/resources/{resourceId}/save-as-template", pathParams: ["projectId", "resourceId"], queryParams: [], headerParams: ["idempotency-key"], hasBody: true, paginated: false, returnsList: false },
  { id: "updateResource", namespace: "resources", method: "update", httpMethod: "PATCH", path: "/api/v3/projects/{projectId}/resources/{resourceId}", pathParams: ["projectId", "resourceId"], queryParams: [], headerParams: [], hasBody: true, paginated: false, returnsList: false },

  { id: "search", namespace: "search", method: "search", httpMethod: "GET", path: "/api/v3/projects/{projectId}/search", pathParams: ["projectId"], queryParams: ["q", "limit"], headerParams: [], hasBody: false, paginated: false, returnsList: true },
  { id: "listTags", namespace: "tags", method: "list", httpMethod: "GET", path: "/api/v3/projects/{projectId}/tags", pathParams: ["projectId"], queryParams: [], headerParams: [], hasBody: false, paginated: false, returnsList: true },
  { id: "listTemplates", namespace: "templates", method: "list", httpMethod: "GET", path: "/api/v3/projects/{projectId}/templates", pathParams: ["projectId"], queryParams: ["cursor", "limit"], headerParams: [], hasBody: false, paginated: true, returnsList: true },

  { id: "listEvents", namespace: "timelines", method: "listEvents", httpMethod: "GET", path: "/api/v3/projects/{projectId}/resources/{resourceId}/docs/{documentId}/events", pathParams: ["projectId", "resourceId", "documentId"], queryParams: ["cursor", "limit"], headerParams: [], hasBody: false, paginated: true, returnsList: true },
  { id: "listLanes", namespace: "timelines", method: "listLanes", httpMethod: "GET", path: "/api/v3/projects/{projectId}/resources/{resourceId}/docs/{documentId}/lanes", pathParams: ["projectId", "resourceId", "documentId"], queryParams: [], headerParams: [], hasBody: false, paginated: false, returnsList: true }
];

export const ERROR_CODES = Object.freeze([
  "VALIDATION_ERROR",
  "INVALID_CONTENT",
  "UNSUPPORTED_KIND",
  "KIND_MISMATCH",
  "UNAUTHENTICATED",
  "SUBSCRIPTION_LAPSED",
  "PAID_PLAN_REQUIRED",
  "FORBIDDEN",
  "WRONG_PROJECT",
  "INSUFFICIENT_SCOPE",
  "FEATURE_UNAVAILABLE",
  "NOT_FOUND",
  "METHOD_NOT_ALLOWED",
  "DUPLICATE_ID",
  "AMBIGUOUS",
  "ALREADY_DELETED",
  "HAS_CHILDREN",
  "NOT_DELETED",
  "PARENT_DELETED",
  "IN_PROGRESS",
  "IDEMPOTENCY_KEY_REUSED",
  "TOO_MANY_PENDING_INVITES",
  "VERSION_MISMATCH",
  "DOCUMENT_TOO_LARGE",
  "PAYLOAD_TOO_LARGE",
  "STORAGE_QUOTA_EXCEEDED",
  "RATE_LIMITED",
  "UPLOAD_RATE_EXCEEDED",
  "INTERNAL"
]);

const ERROR_CODE_SET = new Set(ERROR_CODES);

export class LegendKeeperError extends Error {
  constructor(status, body, response) {
    super(body?.message ?? `Request failed with status ${status}`);
    this.name = "LegendKeeperError";
    this.status = status;
    this.code = typeof body?.code === "string" && ERROR_CODE_SET.has(body.code) ? body.code : undefined;
    this.errors = Array.isArray(body?.errors) ? body.errors : undefined;
    this.requestId = response?.headers?.get?.("x-request-id") ?? body?.requestId ?? undefined;
    this.response = response;
  }
}

export class ValidationError extends LegendKeeperError {
  constructor(status, body, response) {
    super(status, body, response);
    this.name = "ValidationError";
  }
}

export class AuthenticationError extends LegendKeeperError {
  constructor(status, body, response) {
    super(status, body, response);
    this.name = "AuthenticationError";
  }
}

export class PermissionError extends LegendKeeperError {
  constructor(status, body, response) {
    super(status, body, response);
    this.name = "PermissionError";
  }
}

export class NotFoundError extends LegendKeeperError {
  constructor(status, body, response) {
    super(status, body, response);
    this.name = "NotFoundError";
  }
}

export class ConflictError extends LegendKeeperError {
  constructor(status, body, response) {
    super(status, body, response);
    this.name = "ConflictError";
  }
}

export class ServerError extends LegendKeeperError {
  constructor(status, body, response) {
    super(status, body, response);
    this.name = "ServerError";
  }
}

export class VersionMismatchError extends LegendKeeperError {
  constructor(status, body, response) {
    super(status, body, response);
    this.name = "VersionMismatchError";
    this.currentVersion = /version is ([A-Za-z0-9_-]+)/.exec(this.message)?.[1];
  }
}

export class RateLimitError extends LegendKeeperError {
  constructor(status, body, response) {
    super(status, body, response);
    this.name = "RateLimitError";
    this.retryAfterMs = parseRetryAfterMs(response);
  }
}

export class ConnectionError extends Error {
  constructor(message, cause) {
    super(message, { cause });
    this.name = "ConnectionError";
  }
}

function parseRetryAfterMs(response) {
  const raw = response?.headers?.get?.("retry-after");
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(raw);
  return Number.isNaN(at) ? undefined : Math.max(0, at - Date.now());
}

function errorForStatus(status, body, response) {
  if (status === 400) return new ValidationError(status, body, response);
  if (status === 401) return new AuthenticationError(status, body, response);
  if (status === 403) return new PermissionError(status, body, response);
  if (status === 404) return new NotFoundError(status, body, response);
  if (status === 409) return new ConflictError(status, body, response);
  if (status === 412) return new VersionMismatchError(status, body, response);
  if (status === 429) return new RateLimitError(status, body, response);
  if (status >= 500) return new ServerError(status, body, response);
  return new LegendKeeperError(status, body, response);
}

/**
 * Safe UUID generator that works even when Foundry VTT is hosted over plain HTTP LAN
 * where globalThis.crypto.randomUUID may not be exposed by the browser.
 */
export function safeUUID() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  if (globalThis.foundry?.utils?.randomID) {
    return `lk-${globalThis.foundry.utils.randomID(24)}`;
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Generates a LegendKeeper-compatible 24-character cuid2-style resource ID
 * matching ^[a-z](?:[0-9a-z]{7}|[0-9a-z]{23})$
 */
export function generateLkResourceId() {
  const chars = "0123456789abcdefghijklmnopqrstuvwxyz";
  let result = "r";
  for (let i = 0; i < 23; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

function buildUrl(baseUrl, path, pathParams = {}, query = {}) {
  const filled = path.replace(/\{(\w+)\}/g, (_, name) => {
    const value = pathParams[name];
    if (value === undefined) throw new TypeError(`Missing path parameter "${name}" for ${path}`);
    return encodeURIComponent(value);
  });
  const withSlash = filled.endsWith("/") ? filled : `${filled}/`;
  const url = new URL(withSlash.replace(/^\//, ""), baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

async function readBody(response) {
  if (response.status === 204) return undefined;
  const type = response.headers.get("content-type") ?? "";
  if (!type.includes("application/json")) return undefined;
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    throw errorForStatus(response.status, { message: "Malformed JSON response" }, response);
  }
}

function combineSignals(caller, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    const err = new Error("Request timed out");
    err.name = "TimeoutError";
    controller.abort(err);
  }, timeoutMs);

  const onCallerAbort = () => controller.abort(caller.reason);
  if (caller) {
    if (caller.aborted) onCallerAbort();
    else caller.addEventListener("abort", onCallerAbort, { once: true });
  }
  const release = () => {
    clearTimeout(timer);
    if (caller) caller.removeEventListener("abort", onCallerAbort);
  };
  return { signal: controller.signal, release };
}

async function sendOnce(config, spec) {
  const url = buildUrl(config.baseUrl, spec.path, spec.pathParams, spec.query);
  const headers = {
    authorization: `Bearer ${config.apiKey}`,
    accept: "application/json"
  };
  for (const [key, value] of Object.entries(spec.headers ?? {})) {
    if (value !== undefined) headers[key.toLowerCase()] = value;
  }
  const { signal, release } = combineSignals(spec.signal, config.timeoutMs);
  const init = {
    method: spec.method,
    headers,
    signal
  };
  if (spec.body !== undefined) {
    headers["content-type"] = "application/json";
    init.body = JSON.stringify(spec.body);
  }
  let response;
  try {
    response = await config.fetch(url, init);
  } catch (cause) {
    const rawMsg = cause instanceof Error ? cause.message : "fetch failed";
    const isCorsLikely =
      rawMsg.includes("Failed to fetch") ||
      rawMsg.includes("NetworkError") ||
      rawMsg.includes("Load failed");
    const hint = isCorsLikely
      ? `${rawMsg}. If calling LegendKeeper directly from the browser is blocked by CORS, start the included proxy ('node tools/lk-cors-proxy.mjs') and set the API Base URL in Module Settings to http://localhost:8787.`
      : rawMsg;
    throw new ConnectionError(hint, cause);
  } finally {
    release();
  }
  const body = await readBody(response);
  if (!response.ok) throw errorForStatus(response.status, body, response);
  return { status: response.status, body, response };
}

function withVersion(result) {
  const body = result.body;
  const etag = result.response.headers.get("etag");
  if (etag && body !== null && typeof body === "object" && !Array.isArray(body) && !("version" in body)) {
    const version = etag.replace(/^W\//, "").replace(/^"|"$/g, "");
    return { ...body, version };
  }
  return body;
}

const RETRY_STATUSES = new Set([429, 502, 503, 504]);
const BASE_MS = 500;
const CAP_MS = 8000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function shouldRetry(scope, error) {
  if (scope.signal?.aborted === true) return false;
  const repeatsSafely = scope.method !== "POST" || scope.idempotencyKey !== undefined;
  if (error instanceof ConnectionError) {
    const name = error.cause?.name;
    if (name === "AbortError") return false;
    if (name === "TimeoutError") return repeatsSafely;
    return false;
  }
  if (error instanceof LegendKeeperError) {
    if (scope.idempotencyKey !== undefined && error.status === 409 && error.code === "IN_PROGRESS") {
      return true;
    }
    if (RETRY_STATUSES.has(error.status)) {
      const hinted = parseRetryAfterMs(error.response);
      const waitsPastCap = hinted !== undefined && hinted > CAP_MS;
      return !waitsPastCap && (repeatsSafely || error.status === 429);
    }
  }
  return false;
}

function delayFor(attempt, error) {
  const hinted = error instanceof LegendKeeperError ? parseRetryAfterMs(error.response) : undefined;
  if (hinted !== undefined) return Math.min(hinted, CAP_MS);
  const exp = Math.min(CAP_MS, BASE_MS * 2 ** attempt);
  return Math.floor(exp / 2 + Math.random() * (exp / 2));
}

async function withRetries(scope, maxRetries, send) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await send();
    } catch (error) {
      if (attempt >= maxRetries || !shouldRetry(scope, error)) throw error;
      await sleep(delayFor(attempt, error));
    }
  }
}

function makePage(envelope, fetchPage) {
  const data = Array.isArray(envelope?.data) ? envelope.data : [];
  const nextCursor = envelope?.nextCursor ?? null;
  const hasMore = envelope?.hasMore ?? nextCursor !== null;
  const page = {
    data,
    hasMore,
    nextCursor,
    async next() {
      if (!hasMore || nextCursor === null) return null;
      return makePage(await fetchPage(nextCursor), fetchPage);
    },
    async *[Symbol.asyncIterator]() {
      let current = page;
      while (current) {
        for (const item of current.data) yield item;
        current = await current.next();
      }
    }
  };
  return page;
}

async function sha256Hex(bytes) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new TypeError("crypto.subtle is required to upload an image");
  const digest = await subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export class LegendKeeper {
  constructor(options = {}) {
    if (!options.apiKey) throw new TypeError("apiKey is required");
    const fetchImpl = options.fetch ?? globalThis.fetch?.bind(globalThis);
    if (!fetchImpl) throw new TypeError("No fetch implementation available");

    this.config = {
      apiKey: options.apiKey.trim(),
      baseUrl: (options.baseUrl || "https://www.legendkeeper.com").replace(/\/+$/, ""),
      fetch: fetchImpl,
      maxRetries: options.maxRetries ?? 2,
      timeoutMs: options.timeoutMs ?? 30000
    };
    this.explicitProjectId = options.projectId?.trim() || undefined;
    this.generatesIdempotencyKeys = options.idempotencyKeys ?? true;
    this.projectPromise = undefined;

    for (const op of OPERATIONS) {
      const namespace = (this[op.namespace] ??= {});
      namespace[op.method] = (a, b) => {
        const [pathParams, opts] = this.#splitArguments(op, a, b);
        return this.#invoke(op, pathParams, opts);
      };
    }

    this.assets.uploadImage = (input) => this.uploadImage(input);
  }

  #splitArguments(op, a, b) {
    const takesProjectOnly = op.pathParams.length === 1 && op.pathParams[0] === "projectId";
    const firstArgIsOptions =
      op.pathParams.length === 0 ||
      (takesProjectOnly && b === undefined && !(typeof a === "object" && a !== null && "projectId" in a));
    if (firstArgIsOptions) {
      return [{}, typeof a === "object" && a !== null ? a : {}];
    }
    return [
      typeof a === "object" && a !== null ? a : {},
      typeof b === "object" && b !== null ? b : {}
    ];
  }

  #splitOptions(op, options) {
    const query = {};
    const body = {};
    let ifMatch;
    let idempotencyKey;
    let signal;
    for (const [key, value] of Object.entries(options)) {
      if (key === "ifMatch") ifMatch = typeof value === "string" ? value : undefined;
      else if (key === "idempotencyKey" && op.headerParams.includes("idempotency-key")) {
        idempotencyKey = typeof value === "string" ? value : undefined;
      } else if (key === "signal") signal = value;
      else if (op.queryParams.includes(key)) query[key] = value;
      else body[key] = value;
    }
    return {
      query,
      body: op.hasBody ? body : undefined,
      ifMatch,
      idempotencyKey,
      signal
    };
  }

  async project() {
    this.projectPromise ??= this.#fetchKeyProject().catch((error) => {
      this.projectPromise = undefined;
      throw error;
    });
    return this.projectPromise;
  }

  async #fetchKeyProject() {
    if (this.explicitProjectId) {
      return this.projects.get({ projectId: this.explicitProjectId });
    }
    const { data } = await this.projects.list();
    const project = data[0];
    if (data.length !== 1 || !project) {
      throw new TypeError(
        `Expected the API key to resolve to 1 project, got ${data.length}. Specify Project ID in module settings.`
      );
    }
    return project;
  }

  async resolveProjectId() {
    if (this.explicitProjectId) return this.explicitProjectId;
    return (await this.project()).id;
  }

  async #withProjectId(op, pathParams) {
    if (!op.pathParams.includes("projectId") || pathParams.projectId !== undefined) {
      return pathParams;
    }
    return {
      ...pathParams,
      projectId: await this.resolveProjectId()
    };
  }

  async #invoke(op, rawPathParams, options) {
    const pathParams = await this.#withProjectId(op, rawPathParams);
    const { query, body, ifMatch, idempotencyKey: suppliedKey, signal } = this.#splitOptions(op, options);
    const idempotencyKey = op.headerParams.includes("idempotency-key")
      ? suppliedKey ?? (this.generatesIdempotencyKeys ? safeUUID() : undefined)
      : undefined;

    const send = (extraQuery = {}) =>
      withRetries(
        { method: op.httpMethod, idempotencyKey, signal },
        this.config.maxRetries,
        () =>
          sendOnce(this.config, {
            method: op.httpMethod,
            path: op.path,
            pathParams,
            query: { ...query, ...extraQuery },
            body,
            headers: {
              "if-match": ifMatch,
              "idempotency-key": idempotencyKey
            },
            signal
          })
      );

    const result = await send();
    if (op.returnsList) {
      const followCursor = async (cursor) => (await send({ cursor })).body;
      return makePage(result.body, op.paginated ? followCursor : () => Promise.resolve({ data: [] }));
    }
    return op.headerParams.includes("if-match") ? withVersion(result) : result.body;
  }

  async uploadImage(input) {
    let bytes;
    if (typeof Blob !== "undefined" && input.data instanceof Blob) {
      bytes = new Uint8Array(await input.data.arrayBuffer());
    } else if (input.data instanceof ArrayBuffer) {
      bytes = new Uint8Array(input.data);
    } else {
      bytes = input.data;
    }
    const contentType = input.contentType || (input.data?.type ? input.data.type : "image/png");
    const project = { projectId: input.projectId };
    const upload = await this.assets.createImageUpload(project, {
      contentType,
      contentLength: bytes.byteLength,
      contentHash: await sha256Hex(bytes),
      signal: input.signal
    });
    const { signal, release } = combineSignals(input.signal, this.config.timeoutMs);
    let response;
    try {
      response = await this.config.fetch(upload.uploadUrl, {
        method: upload.method,
        headers: upload.headers,
        body: bytes,
        signal
      });
    } catch (cause) {
      throw new ConnectionError(cause instanceof Error ? cause.message : "Image storage upload failed", cause);
    } finally {
      release();
    }
    if (!response.ok) {
      throw new LegendKeeperError(
        response.status,
        { message: `Storage refused the upload with status ${response.status}` },
        response
      );
    }
    return this.assets.createImage(project, {
      uploadKey: upload.uploadKey,
      name: input.name || "Uploaded Image",
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.folderId !== undefined ? { folderId: input.folderId } : {}),
      signal: input.signal
    });
  }
}

export function pixelToPos(frame, x, y) {
  const [[south, west], [north, east]] = frame.bounds;
  return [
    north - (y * (north - south)) / frame.height,
    west + (x * (east - west)) / frame.width
  ];
}

export function posToPixel(frame, pos) {
  const [[south, west], [north, east]] = frame.bounds;
  const [lat, lng] = pos;
  return [
    Math.round(((lng - west) * frame.width) / (east - west)),
    Math.round(((north - lat) * frame.height) / (north - south))
  ];
}

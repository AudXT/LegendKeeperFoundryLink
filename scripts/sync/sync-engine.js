import { MODULE_ID, SETTINGS, FLAGS, DEFAULT_BASE_URL } from "../constants.js?v=1.2.8";
import {
  LegendKeeper,
  NotFoundError,
  VersionMismatchError
} from "../sdk/client.js?v=1.2.8";
import {
  blocksToHtml,
  escapeHtml,
  renderFoundryContentLink,
  renderResourceDecorationHtml,
  renderMapDocumentHtml,
  renderTimelineDocumentHtml
} from "../converter/blocks-to-html.js?v=1.2.8";
import { htmlToBlocks, isLkAssetUrl } from "../converter/html-to-blocks.js?v=1.2.8";
import { promptPageConflictResolution } from "../ui/conflict-dialog.js?v=1.2.8";

/**
 * Computes a deterministic string hash (FNV-1a 32-bit hex) for detecting local journal modifications
 * without false positives from Foundry metadata touches.
 */
export function computeContentHash(str) {
  let hash = 0x811c9dc5;
  const input = String(str ?? "");
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Strips auto-generated header/footer wrappers (`data-lk-generated="true"`) from HTML
 * before computing a content hash so decoration refreshes don't register as user edits.
 */
export function stripGeneratedHtml(html) {
  if (!html) return "";
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    for (const el of doc.querySelectorAll("[data-lk-generated='true']")) {
      el.remove();
    }
    return doc.body.innerHTML.trim();
  } catch {
    return String(html).trim();
  }
}

/**
 * Computes a deterministic content hash for a single Foundry JournalEntryPage.
 */
export function computePageHash(page) {
  if (!page) return "";
  const body = stripGeneratedHtml(page.text?.content || "");
  return computeContentHash(`${page.name || "Main"}|${body}`);
}

/**
 * Computes a combined content hash for a Foundry JournalEntry and all its pages.
 */
export function computeJournalHash(journalEntry) {
  if (!journalEntry) return "";
  const pages = Array.from(journalEntry.pages ?? []).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
  const pageSignatures = pages.map((p) => {
    const docId = p.getFlag(MODULE_ID, FLAGS.DOCUMENT_ID) || "";
    return `${docId}:${computePageHash(p)}`;
  });
  const folderResourceId = journalEntry.folder?.getFlag?.(MODULE_ID, FLAGS.RESOURCE_ID) || "";
  return computeContentHash(`${journalEntry.name}|${folderResourceId}|${pageSignatures.join("||")}`);
}

const CURRENT_HASH_VERSION = 2;

export function hasPageChangedLocally(page) {
  if (!page) return false;
  const sh = page.getFlag(MODULE_ID, FLAGS.PAGE_HASH);
  if (!sh) return false;
  if (page.getFlag(MODULE_ID, FLAGS.HASH_VERSION) !== CURRENT_HASH_VERSION) return false;
  return computePageHash(page) !== sh;
}

export function hasJournalChangedLocally(entry) {
  if (!entry) return false;
  const sh = entry.getFlag(MODULE_ID, FLAGS.CONTENT_HASH);
  if (!sh) return false;
  if (entry.getFlag(MODULE_ID, FLAGS.HASH_VERSION) !== CURRENT_HASH_VERSION) return false;
  return computeJournalHash(entry) !== sh;
}

export class LegendKeeperSyncEngine {
  constructor() {
    this.isSyncingInternal = false;
    this._clientCache = null;
    this._clientCacheKey = "";
  }

  /**
   * Reads a module setting safely.
   */
  getSetting(key, fallback = undefined) {
    try {
      return game.settings.get(MODULE_ID, key);
    } catch {
      return fallback;
    }
  }

  /**
   * Returns a configured LegendKeeper SDK client instance.
   */
  getClient() {
    const apiKey = (this.getSetting(SETTINGS.API_KEY, "") || "").trim();
    if (!apiKey) {
      throw new Error(game.i18n.localize("LK_SYNC.Notifications.NoApiKey"));
    }
    const baseUrl = (this.getSetting(SETTINGS.BASE_URL, DEFAULT_BASE_URL) || DEFAULT_BASE_URL).trim();
    const projectId = (this.getSetting(SETTINGS.PROJECT_ID, "") || "").trim();
    const cacheKey = `${apiKey}|${baseUrl}|${projectId}`;

    if (!this._clientCache || this._clientCacheKey !== cacheKey) {
      this._clientCache = new LegendKeeper({
        apiKey,
        baseUrl,
        projectId: projectId || undefined
      });
      this._clientCacheKey = cacheKey;
    }
    return this._clientCache;
  }

  /**
   * Tests the API connection and returns project metadata.
   */
  async testConnection() {
    try {
      const lk = this.getClient();
      const project = await lk.project();
      return { ok: true, project };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        code: error?.code,
        status: error?.status
      };
    }
  }

  /**
   * Fetches all non-template resources from LegendKeeper.
   */
  async fetchAllRemoteResources() {
    const lk = this.getClient();
    const allItems = [];
    for await (const item of await lk.resources.list({ limit: 100 })) {
      allItems.push(item);
    }

    // Filter out templates (resources whose parentId is "templates" or whose ancestor is under "templates")
    const byId = new Map(allItems.map((item) => [item.id, item]));
    const isTemplate = (item) => {
      let cur = item;
      const visited = new Set();
      while (cur && cur.parentId) {
        if (cur.parentId === "templates") return true;
        if (visited.has(cur.id)) break;
        visited.add(cur.id);
        cur = byId.get(cur.parentId);
      }
      return false;
    };

    const isHiddenInHierarchy = (item) => {
      let cur = item;
      const visited = new Set();
      while (cur) {
        if (cur.isHidden) return true;
        if (!cur.parentId || cur.parentId === "templates" || visited.has(cur.id)) break;
        visited.add(cur.id);
        cur = byId.get(cur.parentId);
      }
      return false;
    };

    for (const item of allItems) {
      if (isHiddenInHierarchy(item)) {
        item.isHidden = true;
      }
    }

    const hiddenHandling = this.getSetting(SETTINGS.HIDDEN_RESOURCE_HANDLING, "gmOnly");
    return allItems.filter((item) => {
      if (isTemplate(item)) return false;
      if (hiddenHandling === "skip" && item.isHidden) return false;
      return true;
    });
  }

  /**
   * Builds a lookup map of all Foundry JournalEntries & Pages indexed by LegendKeeper IDs and Foundry UUIDs.
   */
  buildLocalIndex() {
    const byResourceId = new Map();
    const byDocumentId = new Map();
    const pagesByResourceId = new Map();
    let masterJournal = null;
    const unlinkedJournals = [];

    for (const entry of game.journal ?? []) {
      if (entry.getFlag(MODULE_ID, FLAGS.IS_INDEX_JOURNAL)) {
        continue;
      }
      if (entry.getFlag(MODULE_ID, FLAGS.IS_MASTER_JOURNAL)) {
        masterJournal = entry;
        const sortedPages = Array.from(entry.pages ?? []).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
        for (const page of sortedPages) {
          if (page.getFlag(MODULE_ID, FLAGS.IS_INDEX_PAGE)) continue;
          const pResId = page.getFlag(MODULE_ID, FLAGS.RESOURCE_ID);
          const docId = page.getFlag(MODULE_ID, FLAGS.DOCUMENT_ID);
          if (pResId) {
            const list = pagesByResourceId.get(pResId) ?? [];
            list.push(page);
            pagesByResourceId.set(pResId, list);
          }
          if (docId) {
            byDocumentId.set(docId, { entry, page });
          }
          const tabMeta = page.getFlag(MODULE_ID, FLAGS.TAB_DOCS_META);
          if (Array.isArray(tabMeta)) {
            for (const tm of tabMeta) {
              if (tm?.documentId) {
                byDocumentId.set(tm.documentId, { entry, page });
              }
            }
          }
        }
        continue;
      }
      const resId = entry.getFlag(MODULE_ID, FLAGS.RESOURCE_ID);
      if (resId) {
        byResourceId.set(resId, entry);
        for (const page of entry.pages ?? []) {
          const docId = page.getFlag(MODULE_ID, FLAGS.DOCUMENT_ID);
          if (docId) {
            byDocumentId.set(docId, { entry, page });
          }
          const tabMeta = page.getFlag(MODULE_ID, FLAGS.TAB_DOCS_META);
          if (Array.isArray(tabMeta)) {
            for (const tm of tabMeta) {
              if (tm?.documentId) {
                byDocumentId.set(tm.documentId, { entry, page });
              }
            }
          }
        }
      } else {
        unlinkedJournals.push(entry);
      }
    }

    return { byResourceId, byDocumentId, pagesByResourceId, masterJournal, unlinkedJournals };
  }

  /**
   * Builds full path display names ("Ancestor / Parent / Name") and parent-child maps for all remote resources.
   */
  buildResourcePathInfo(remoteResources = []) {
    const remoteById = new Map(remoteResources.map((r) => [r.id, r]));
    const chainById = new Map();
    const pathById = new Map();
    const parentPathById = new Map();
    const childrenByParentId = new Map();

    const sorted = [...remoteResources].sort((a, b) => ((a.rank ?? "") < (b.rank ?? "") ? -1 : 1));
    for (const r of sorted) {
      const pKey = r.parentId && r.parentId !== "templates" && remoteById.has(r.parentId) ? r.parentId : null;
      const list = childrenByParentId.get(pKey) ?? [];
      list.push(r.id);
      childrenByParentId.set(pKey, list);
    }

    const computeChain = (resId) => {
      const chain = [];
      let cur = remoteById.get(resId);
      const visited = new Set();
      while (cur && !visited.has(cur.id)) {
        visited.add(cur.id);
        chain.unshift(cur);
        if (!cur.parentId || cur.parentId === "templates" || !remoteById.has(cur.parentId)) {
          break;
        }
        cur = remoteById.get(cur.parentId);
      }
      return chain;
    };

    for (const r of remoteResources) {
      const chain = computeChain(r.id);
      const segments = chain.map((item) => item.name);
      chainById.set(r.id, chain);
      pathById.set(r.id, segments.join(" / "));
      parentPathById.set(r.id, segments.slice(0, -1).join(" / "));
    }

    return { remoteById, chainById, pathById, parentPathById, childrenByParentId };
  }

  /**
   * Creates converter lookup callbacks (`resolveMention`, `resolveUuidToLk`, `evaluateCollectionFilter`, `resolveImageAssetUrl`)
   * using the current local index and remote resource list.
   */
  createConverterContext(remoteResources = [], localIndex = null) {
    const idx = localIndex || this.buildLocalIndex();
    const remoteById = new Map(remoteResources.map((r) => [r.id, r]));
    const secretHandling = this.getSetting(SETTINGS.SECRET_HANDLING, "secretBlock");
    const uploadLocalImages = this.getSetting(SETTINGS.UPLOAD_LOCAL_IMAGES, true);

    const resolveMention = ({ resourceId, documentId, label }) => {
      if (documentId && idx.byDocumentId.has(documentId)) {
        const { entry, page } = idx.byDocumentId.get(documentId);
        return {
          uuid: `JournalEntry.${entry.id}.JournalEntryPage.${page.id}`,
          name:
            label ||
            page.getFlag(MODULE_ID, FLAGS.RESOURCE_NAME) ||
            page.name ||
            entry.getFlag(MODULE_ID, FLAGS.RESOURCE_NAME) ||
            entry.name
        };
      }
      if (resourceId && idx.byResourceId.has(resourceId)) {
        const entry = idx.byResourceId.get(resourceId);
        const remote = remoteById.get(resourceId);
        const cleanName = entry.getFlag(MODULE_ID, FLAGS.RESOURCE_NAME) || remote?.name || entry.name;
        return {
          uuid: `JournalEntry.${entry.id}`,
          name: label || cleanName
        };
      }
      if (resourceId && idx.pagesByResourceId?.has(resourceId) && idx.masterJournal) {
        const pages = idx.pagesByResourceId.get(resourceId);
        const primaryPage = pages?.[0];
        if (primaryPage) {
          const remote = remoteById.get(resourceId);
          const cleanName =
            primaryPage.getFlag(MODULE_ID, FLAGS.RESOURCE_NAME) || remote?.name || primaryPage.name;
          return {
            uuid: `JournalEntry.${idx.masterJournal.id}.JournalEntryPage.${primaryPage.id}`,
            name: label || cleanName
          };
        }
      }
      const remote = resourceId ? remoteById.get(resourceId) : null;
      return remote ? { uuid: null, name: label || remote.name } : null;
    };

    const resolveUuidToLk = (uuid) => {
      if (!uuid || typeof uuid !== "string") return null;
      const m = /^JournalEntry\.([^.]+)(?:\.JournalEntryPage\.([^.]+))?/.exec(uuid.trim());
      if (!m) return null;
      const entryId = m[1];
      const pageId = m[2];
      const entry = game.journal?.get?.(entryId);
      if (!entry) return null;
      if (pageId) {
        const page = entry.pages?.get?.(pageId);
        const pageResId = page?.getFlag?.(MODULE_ID, FLAGS.RESOURCE_ID) || entry.getFlag(MODULE_ID, FLAGS.RESOURCE_ID);
        const documentId = page?.getFlag?.(MODULE_ID, FLAGS.DOCUMENT_ID);
        const isPrimaryDoc = page?.getFlag?.(MODULE_ID, FLAGS.IS_PRIMARY_DOC);
        if (entry.getFlag(MODULE_ID, FLAGS.IS_MASTER_JOURNAL) && isPrimaryDoc && pageResId) {
          return {
            resourceId: pageResId,
            name: page.getFlag(MODULE_ID, FLAGS.RESOURCE_NAME) || page.name
          };
        }
        if (pageResId && documentId) {
          return { resourceId: pageResId, documentId, name: page.name };
        }
      }
      const resourceId = entry.getFlag(MODULE_ID, FLAGS.RESOURCE_ID);
      if (!resourceId) return null;
      const cleanName = entry.getFlag(MODULE_ID, FLAGS.RESOURCE_NAME) || entry.name;
      return { resourceId, name: cleanName };
    };

    const evaluateCollectionFilter = (filter, selfResourceId) => {
      if (!filter || typeof filter !== "object") return [];
      const resolveVal = (val) => (val === "$self" ? selfResourceId : val);

      const matchesPredicate = (res, pred) => {
        if (!pred || typeof pred !== "object") return false;
        switch (pred.filterType) {
          case "field": {
            const targetVal = resolveVal(pred.value);
            const actualVal = pred.field === "parentId" ? res.parentId : res.name;
            if (pred.operator === "equals") return actualVal === targetVal;
            if (pred.operator === "not_equals") return actualVal !== targetVal;
            if (pred.operator === "contains") {
              return String(actualVal ?? "").toLowerCase().includes(String(targetVal ?? "").toLowerCase());
            }
            return false;
          }
          case "tag": {
            const resTags = Array.isArray(res.tags) ? res.tags : [];
            const filterTags = Array.isArray(pred.tags) ? pred.tags : [];
            if (pred.operator === "has_all") {
              return filterTags.length > 0 && filterTags.every((t) => resTags.includes(t));
            }
            if (pred.operator === "has_any") {
              return filterTags.some((t) => resTags.includes(t));
            }
            if (pred.operator === "has_none") {
              return !filterTags.some((t) => resTags.includes(t));
            }
            return false;
          }
          case "composite": {
            const subFilters = Array.isArray(pred.filters) ? pred.filters : [];
            if (pred.operator === "and") return subFilters.every((f) => matchesPredicate(res, f));
            if (pred.operator === "or") return subFilters.some((f) => matchesPredicate(res, f));
            if (pred.operator === "not" && subFilters[0]) return !matchesPredicate(res, subFilters[0]);
            return false;
          }
          default:
            return false;
        }
      };

      return remoteResources
        .filter((r) => matchesPredicate(r, filter))
        .sort((a, b) => ((a.rank ?? "") < (b.rank ?? "") ? -1 : 1))
        .map((r) => r.id);
    };

    const resolveImageAssetUrl = async (src, name) => {
      if (!src) return null;
      if (isLkAssetUrl(src)) return src;
      if (!uploadLocalImages) return null;

      try {
        const lk = this.getClient();
        const response = await fetch(src);
        if (!response.ok) return null;
        const blob = await response.blob();
        const allowedTypes = ["image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp"];
        const contentType = allowedTypes.includes(blob.type) ? blob.type : "image/png";
        const asset = await lk.assets.uploadImage({
          data: blob,
          contentType,
          name: (name || "Foundry Journal Image").slice(0, 200)
        });
        return asset?.url || null;
      } catch (err) {
        console.warn("LegendKeeper Sync | Could not upload image to LK:", src, err);
        return null;
      }
    };

    return {
      secretHandling,
      resolveMention,
      resolveUuidToLk,
      evaluateCollectionFilter,
      resolveImageAssetUrl
    };
  }

  /**
   * Computes a complete two-way comparison between LegendKeeper and Foundry VTT Journals.
   */
  async getSyncOverview() {
    const remoteResources = await this.fetchAllRemoteResources();
    const { byResourceId, pagesByResourceId, masterJournal, unlinkedJournals } = this.buildLocalIndex();
    const pathInfo = this.buildResourcePathInfo(remoteResources);
    const { remoteById, parentPathById } = pathInfo;

    const items = [];

    for (const res of remoteResources) {
      const localEntry = byResourceId.get(res.id);
      const masterPages = pagesByResourceId.get(res.id);
      const parentName = parentPathById.get(res.id) || "";

      if (!localEntry && (!masterPages || masterPages.length === 0 || !masterJournal)) {
        items.push({
          id: res.id,
          resourceId: res.id,
          journalId: null,
          pageId: null,
          name: res.name,
          parentName,
          tags: res.tags || [],
          documentCount: res.documents?.length || 0,
          status: "remote-only",
          statusLabel: game.i18n.localize("LK_SYNC.Status.remote-only"),
          remoteUpdatedAt: res.updatedAt || null,
          localUpdatedAt: null
        });
        continue;
      }

      if (localEntry) {
        const storedLkUpdatedAt = localEntry.getFlag(MODULE_ID, FLAGS.LK_UPDATED_AT);

        const remoteChanged = Boolean(res.updatedAt && storedLkUpdatedAt && res.updatedAt !== storedLkUpdatedAt);
        const localChanged = hasJournalChangedLocally(localEntry);

        let status = "in-sync";
        if (remoteChanged && localChanged) status = "conflict";
        else if (remoteChanged) status = "remote-newer";
        else if (localChanged) status = "local-newer";

        items.push({
          id: res.id,
          resourceId: res.id,
          journalId: localEntry.id,
          pageId: null,
          name: res.name,
          localName: localEntry.name,
          parentName,
          tags: res.tags || [],
          documentCount: res.documents?.length || localEntry.pages?.size || 0,
          status,
          statusLabel: game.i18n.localize(`LK_SYNC.Status.${status}`),
          remoteUpdatedAt: res.updatedAt || null,
          localUpdatedAt: localEntry._stats?.modifiedTime
            ? new Date(localEntry._stats.modifiedTime).toISOString()
            : null
        });
      } else if (masterPages && masterPages.length > 0 && masterJournal) {
        const primaryPage = masterPages[0];
        const storedLkUpdatedAt = primaryPage.getFlag(MODULE_ID, FLAGS.LK_UPDATED_AT);
        const remoteChanged = Boolean(res.updatedAt && storedLkUpdatedAt && res.updatedAt !== storedLkUpdatedAt);
        const localChanged = masterPages.some((p) => hasPageChangedLocally(p));

        let status = "in-sync";
        if (remoteChanged && localChanged) status = "conflict";
        else if (remoteChanged) status = "remote-newer";
        else if (localChanged) status = "local-newer";

        items.push({
          id: res.id,
          resourceId: res.id,
          journalId: masterJournal.id,
          pageId: primaryPage.id,
          name: res.name,
          localName: primaryPage.name,
          parentName,
          tags: res.tags || [],
          documentCount: res.documents?.length || masterPages.length || 0,
          status,
          statusLabel: game.i18n.localize(`LK_SYNC.Status.${status}`),
          remoteUpdatedAt: res.updatedAt || null,
          localUpdatedAt: primaryPage._stats?.modifiedTime
            ? new Date(primaryPage._stats.modifiedTime).toISOString()
            : null
        });
      }
    }

    for (const [resId, entry] of byResourceId.entries()) {
      if (!remoteById.has(resId)) {
        items.push({
          id: entry.id,
          resourceId: resId,
          journalId: entry.id,
          pageId: null,
          name: entry.name,
          parentName: entry.folder?.name || "",
          tags: entry.getFlag(MODULE_ID, FLAGS.TAGS) || [],
          documentCount: entry.pages?.size || 0,
          status: "local-only",
          statusLabel: game.i18n.localize("LK_SYNC.Status.local-only"),
          remoteUpdatedAt: null,
          localUpdatedAt: entry._stats?.modifiedTime
            ? new Date(entry._stats.modifiedTime).toISOString()
            : null
        });
      }
    }

    for (const entry of unlinkedJournals) {
      items.push({
        id: entry.id,
        resourceId: null,
        journalId: entry.id,
        pageId: null,
        name: entry.name,
        parentName: entry.folder?.name || "",
        tags: [],
        documentCount: entry.pages?.size || 0,
        status: "local-only",
        statusLabel: game.i18n.localize("LK_SYNC.Status.local-only"),
        remoteUpdatedAt: null,
        localUpdatedAt: entry._stats?.modifiedTime
          ? new Date(entry._stats.modifiedTime).toISOString()
          : null
      });
    }

    return {
      items,
      counts: {
        total: items.length,
        inSync: items.filter((i) => i.status === "in-sync").length,
        remoteOnly: items.filter((i) => i.status === "remote-only").length,
        remoteNewer: items.filter((i) => i.status === "remote-newer").length,
        localOnly: items.filter((i) => i.status === "local-only").length,
        localNewer: items.filter((i) => i.status === "local-newer").length,
        conflict: items.filter((i) => i.status === "conflict").length
      }
    };
  }

  /**
   * Ensures Foundry JournalEntry Folder(s) exist according to the selected `folderMode` setting:
   * - `singleFolder`: Single top-level "LegendKeeper" folder with clean Journal titles.
   * - `nestedFolders`: Real Foundry folders up to Foundry's 4-level limit, with relative path names below depth 4.
   * - `singleJournal`: Single top-level "LegendKeeper" folder holding one master "📖 LegendKeeper Wiki" JournalEntry.
   */
  async ensureFolderHierarchy(remoteResources = []) {
    const folderMode = this.getSetting(SETTINGS.FOLDER_MODE, "singleFolder");
    const maxDepth = Math.min(globalThis.CONST?.FOLDER_MAX_DEPTH ?? 4, 4);
    const configuredRootName = (this.getSetting(SETTINGS.ROOT_FOLDER_NAME, "LegendKeeper") || "").trim();
    const journalFolders = () => (game.folders ?? []).filter((f) => f.type === "JournalEntry");
    const isTopLevelFolder = (f) => !f.folder && !f._source?.folder;

    let rootFolder = null;
    if (configuredRootName) {
      rootFolder = journalFolders().find((f) => {
        if (!isTopLevelFolder(f)) return false;
        const isRootFlag = Boolean(f.getFlag(MODULE_ID, FLAGS.IS_ROOT_FOLDER));
        const storedTier = f.getFlag(MODULE_ID, FLAGS.OVERFLOW_TIER) ?? 1;
        return (isRootFlag && storedTier === 1) || f.name === configuredRootName;
      });

      if (!rootFolder) {
        rootFolder = await Folder.create({
          name: configuredRootName,
          type: "JournalEntry",
          folder: null,
          sorting: "a",
          flags: {
            [MODULE_ID]: {
              [FLAGS.IS_ROOT_FOLDER]: true,
              [FLAGS.OVERFLOW_TIER]: 1
            }
          }
        });
      }
    }

    const rootDepth = rootFolder ? 1 : 0;
    const maxLkFolderDepth = folderMode === "nestedFolders" ? Math.max(0, maxDepth - rootDepth) : 0;
    const pathInfo = this.buildResourcePathInfo(remoteResources);

    const parentResourceIds = new Set();
    for (const res of remoteResources) {
      if (res.parentId && res.parentId !== "templates") {
        parentResourceIds.add(res.parentId);
      }
    }

    const allowedFolderResources =
      folderMode === "nestedFolders"
        ? remoteResources
            .filter((r) => {
              if (!parentResourceIds.has(r.id)) return false;
              const chainLen = pathInfo.chainById.get(r.id)?.length || 1;
              return chainLen <= maxLkFolderDepth;
            })
            .sort((a, b) => {
              const lenA = pathInfo.chainById.get(a.id)?.length || 1;
              const lenB = pathInfo.chainById.get(b.id)?.length || 1;
              if (lenA !== lenB) return lenA - lenB;
              return (a.rank ?? "") < (b.rank ?? "") ? -1 : 1;
            })
        : [];

    const allowedFolderResourceIds = new Set(allowedFolderResources.map((r) => r.id));

    // Clean up any legacy folders that are not allowed in the current folderMode
    const legacyFolders = journalFolders().filter((f) => {
      if (rootFolder && f.id === rootFolder.id) return false;
      const rId = f.getFlag(MODULE_ID, FLAGS.RESOURCE_ID);
      if (rId && !allowedFolderResourceIds.has(rId)) return true;
      if (folderMode !== "nestedFolders") {
        const parentId = (typeof f.folder === "string" ? f.folder : f.folder?.id) ?? f._source?.folder ?? null;
        if (rootFolder && parentId === rootFolder.id) return true;
      }
      const isOverflowRoot =
        Boolean(f.getFlag(MODULE_ID, FLAGS.IS_ROOT_FOLDER)) &&
        (f.getFlag(MODULE_ID, FLAGS.OVERFLOW_TIER) ?? 1) > 1;
      return isOverflowRoot;
    });

    if (legacyFolders.length > 0) {
      const legacyIds = new Set(legacyFolders.map((f) => f.id));
      for (const entry of game.journal ?? []) {
        const fId = entry.folder?.id ?? entry._source?.folder ?? null;
        if (fId && legacyIds.has(fId)) {
          try {
            await entry.update({ folder: rootFolder?.id || null });
          } catch {
            // Ignore move errors during cleanup
          }
        }
      }

      const sortedLegacy = [...legacyFolders].sort((a, b) => (b.depth || 1) - (a.depth || 1));
      for (const f of sortedLegacy) {
        try {
          await f.delete();
        } catch {
          // Ignore delete errors during cleanup
        }
      }
    }

    const existingFolderByResourceId = new Map();
    for (const f of journalFolders()) {
      const rId = f.getFlag(MODULE_ID, FLAGS.RESOURCE_ID);
      if (rId) existingFolderByResourceId.set(rId, f);
    }

    const folderByResourceId = new Map();

    for (const res of allowedFolderResources) {
      const parentFolder =
        res.parentId && folderByResourceId.has(res.parentId)
          ? folderByResourceId.get(res.parentId)
          : rootFolder;
      const desiredParentId = parentFolder?.id || null;
      const desiredName = res.name.slice(0, 100);

      let folder = existingFolderByResourceId.get(res.id) || null;
      try {
        if (!folder) {
          const folderData = {
            name: desiredName,
            type: "JournalEntry",
            folder: desiredParentId,
            sorting: "a",
            flags: {
              [MODULE_ID]: {
                [FLAGS.RESOURCE_ID]: res.id,
                [FLAGS.PARENT_ID]: res.parentId || null
              }
            }
          };
          if (res.iconColor && /^#[0-9A-Fa-f]{6}$/.test(res.iconColor)) {
            folderData.color = res.iconColor;
          }
          folder = await Folder.create(folderData);
        } else {
          const currentParentId =
            (typeof folder.folder === "string" ? folder.folder : folder.folder?.id) ??
            folder._source?.folder ??
            null;
          if (folder.name !== desiredName || currentParentId !== desiredParentId) {
            await folder.update({
              name: desiredName,
              folder: desiredParentId
            });
          }
        }
      } catch (err) {
        console.warn(`LegendKeeper Sync | Falling back to parent folder for "${res.name}":`, err?.message || err);
        folder = parentFolder;
      }

      if (folder) {
        folderByResourceId.set(res.id, folder);
      }
    }

    return {
      rootFolder,
      folderMode,
      folderByResourceId,
      pathInfo,
      getTargetFolderForResource: (res) => {
        if (folderMode !== "nestedFolders" || !res) return rootFolder;
        const chain = pathInfo.chainById.get(res.id) || [res];
        const strictAncestors = chain.slice(0, -1);
        if (strictAncestors.length === 0 || maxLkFolderDepth === 0) {
          return rootFolder;
        }
        const folderAncestor =
          strictAncestors[Math.min(strictAncestors.length, maxLkFolderDepth) - 1];
        return (folderAncestor && folderByResourceId.get(folderAncestor.id)) || rootFolder;
      },
      getJournalNameForResource: (res) => {
        if (!res) return "Untitled";
        if (folderMode !== "nestedFolders") {
          return res.name || "Untitled";
        }
        const chain = pathInfo.chainById.get(res.id) || [res];
        const strictAncestors = chain.slice(0, -1);
        if (strictAncestors.length <= maxLkFolderDepth) {
          return res.name || "Untitled";
        }
        const overflowAncestors = strictAncestors.slice(maxLkFolderDepth);
        return [...overflowAncestors.map((a) => a.name), res.name].join(" / ");
      }
    };
  }

  /**
   * Builds the collapsible HTML tree for the Wiki Directory Index (used both by the standalone
   * "📖 LegendKeeper Wiki Index" journal and by the first page of "📖 LegendKeeper Wiki" in singleJournal mode).
   */
  #buildWikiDirectoryPagesData(remoteResources = [], localIndex = null) {
    const idx = localIndex || this.buildLocalIndex();
    const pathInfo = this.buildResourcePathInfo(remoteResources);
    const { remoteById, childrenByParentId } = pathInfo;
    const hiddenHandling = this.getSetting(SETTINGS.HIDDEN_RESOURCE_HANDLING, "gmOnly");
    const noneLevel = globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS?.NONE ?? 0;
    const inheritLevel = globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS?.INHERIT ?? -1;

    const escapeHtml = (str) =>
      String(str ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");

    const countDescendants = (resId, visited = new Set()) => {
      if (visited.has(resId)) return 0;
      visited.add(resId);
      const children = childrenByParentId.get(resId) || [];
      let total = children.length;
      for (const cId of children) {
        total += countDescendants(cId, visited);
      }
      return total;
    };

    const renderNodeLink = (res) => {
      const entry = idx.byResourceId.get(res.id);
      const primaryMasterPage = idx.pagesByResourceId?.get(res.id)?.[0];
      const rawName = res.name || "Untitled";
      const cleanName = escapeHtml(rawName);
      let linkHtml = `<strong>${cleanName}</strong>`;
      if (entry) {
        linkHtml = renderFoundryContentLink(`JournalEntry.${entry.id}`, rawName);
      } else if (primaryMasterPage && idx.masterJournal) {
        linkHtml = renderFoundryContentLink(
          `JournalEntry.${idx.masterJournal.id}.JournalEntryPage.${primaryMasterPage.id}`,
          rawName
        );
      }
      const tags = Array.isArray(res.tags) && res.tags.length > 0
        ? ` <span class="lk-index-tags">${res.tags.slice(0, 4).map((t) => `<span class="lk-tag-pill">${escapeHtml(t)}</span>`).join(" ")}</span>`
        : "";
      return `${linkHtml}${tags}`;
    };

    const renderSubtreeHtml = (resId, depth = 0, visited = new Set(), ancestorWrappedSecret = false) => {
      if (visited.has(resId)) return "";
      visited.add(resId);
      const res = remoteById.get(resId);
      if (!res) return "";

      const isGmHidden = Boolean(res.isHidden && hiddenHandling === "gmOnly");
      const shouldWrapSecret = isGmHidden && !ancestorWrappedSecret;

      const childIds = childrenByParentId.get(resId) || [];
      const linkAndTags = renderNodeLink(res);

      let nodeHtml = "";
      if (childIds.length === 0) {
        nodeHtml = `<li class="lk-index-leaf" style="margin: 3px 0;"><i class="fas fa-file-alt" style="opacity: 0.65; margin-right: 4px;"></i> ${linkAndTags}</li>`;
      } else {
        const descCount = countDescendants(resId);
        const childrenHtml = childIds
          .map((cId) =>
            renderSubtreeHtml(cId, depth + 1, new Set(visited), ancestorWrappedSecret || shouldWrapSecret)
          )
          .join("");

        const openAttr = depth < 2 ? " open" : "";
        nodeHtml = `<li class="lk-index-branch" style="margin: 5px 0; list-style: none;">
          <details${openAttr}>
            <summary style="cursor: pointer; font-weight: 600;">
              <i class="fas fa-folder-open" style="color: #d9a441; margin-right: 4px;"></i> ${linkAndTags}
              <small style="opacity: 0.65; font-weight: normal; margin-left: 4px;">(${descCount})</small>
            </summary>
            <ul class="lk-wiki-tree" style="margin: 4px 0 6px 18px; padding-left: 10px; border-left: 2px solid rgba(128,128,128,0.25);">
              ${childrenHtml}
            </ul>
          </details>
        </li>`;
      }

      if (shouldWrapSecret) {
        return `<section class="secret">${nodeHtml}</section>`;
      }
      return nodeHtml;
    };

    const topLevelIds = childrenByParentId.get(null) || [];
    const fullTreeItemsHtml = topLevelIds
      .map((id) => renderSubtreeHtml(id, 0, new Set(), false))
      .join("");

    const syncedTime = new Date().toLocaleString();
    const overviewHtml = `<div class="lk-wiki-index" data-lk-generated="true">
      <div style="padding: 10px 14px; margin-bottom: 12px; border-radius: 6px; background: rgba(0, 0, 0, 0.06); border: 1px solid rgba(128, 128, 128, 0.25);">
        <h2 style="margin: 0 0 4px 0;">📖 LegendKeeper Wiki Directory</h2>
        <p style="margin: 0; font-size: 0.9em; opacity: 0.8;">
          <strong>${remoteResources.length}</strong> articles synced • Last updated: ${escapeHtml(syncedTime)}<br/>
          <em>Click any article below to open it, or click a folder header to expand/collapse its branch.</em>
        </p>
      </div>
      <ul class="lk-wiki-tree" style="margin: 0; padding-left: 8px; list-style: none;">
        ${fullTreeItemsHtml || "<li><em>No resources found in LegendKeeper.</em></li>"}
      </ul>
    </div>`;

    const desiredPages = [
      {
        name: "📖 Full Wiki Tree",
        sort: 10000,
        html: overviewHtml,
        ownership: { default: inheritLevel }
      }
    ];

    let sortCounter = 20000;
    for (const topId of topLevelIds) {
      const topRes = remoteById.get(topId);
      const topChildren = childrenByParentId.get(topId) || [];
      if (!topRes || topChildren.length === 0) continue;

      const isTopHidden = Boolean(topRes.isHidden && hiddenHandling === "gmOnly");
      const branchHtml = `<div class="lk-wiki-index" data-lk-generated="true">
        <p style="margin: 0 0 10px 0;">
          <strong>Category Root:</strong> ${renderNodeLink(topRes)}
        </p>
        <ul class="lk-wiki-tree" style="margin: 0; padding-left: 8px; list-style: none;">
          ${topChildren.map((cId) => renderSubtreeHtml(cId, 0, new Set(), isTopHidden)).join("")}
        </ul>
      </div>`;

      desiredPages.push({
        name: `📂 ${topRes.name}`.slice(0, 100),
        sort: sortCounter,
        html: branchHtml,
        ownership: { default: isTopHidden ? noneLevel : inheritLevel }
      });
      sortCounter += 10000;
    }

    return { overviewHtml, desiredPages };
  }

  /**
   * Creates or updates the pinned "📖 LegendKeeper Wiki Index" JournalEntry inside the root folder,
   * containing a full collapsible tree of clickable `@UUID` links for the entire LegendKeeper wiki
   * plus dedicated tabs for each top-level category that has sub-resources.
   */
  async ensureWikiIndexJournal(remoteResources = [], localIndex = null, rootFolder = null) {
    const observerLevel = globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OBSERVER ?? 2;
    const { desiredPages } = this.#buildWikiDirectoryPagesData(remoteResources, localIndex);

    let indexEntry = (game.journal ?? []).find((j) => j.getFlag(MODULE_ID, FLAGS.IS_INDEX_JOURNAL));
    if (!indexEntry) {
      indexEntry = await JournalEntry.create({
        name: "📖 LegendKeeper Wiki Index",
        folder: rootFolder?.id || null,
        sort: 0,
        ownership: { default: observerLevel },
        flags: {
          [MODULE_ID]: {
            [FLAGS.IS_INDEX_JOURNAL]: true
          }
        }
      });
    } else if (
      indexEntry.name !== "📖 LegendKeeper Wiki Index" ||
      (indexEntry.folder?.id || null) !== (rootFolder?.id || null) ||
      (indexEntry.ownership?.default ?? 0) !== observerLevel
    ) {
      await indexEntry.update({
        name: "📖 LegendKeeper Wiki Index",
        folder: rootFolder?.id || null,
        sort: 0,
        ownership: { ...(indexEntry.ownership || {}), default: observerLevel }
      });
    }

    const existingPages = Array.from(indexEntry.pages ?? []).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
    const pagesToUpdate = [];
    const pagesToCreate = [];
    const pagesToDelete = [];

    for (let i = 0; i < desiredPages.length; i++) {
      const dp = desiredPages[i];
      if (i < existingPages.length) {
        pagesToUpdate.push({
          _id: existingPages[i].id,
          name: dp.name,
          type: "text",
          sort: dp.sort,
          ownership: dp.ownership,
          text: { content: dp.html, format: 1 }
        });
      } else {
        pagesToCreate.push({
          name: dp.name,
          type: "text",
          sort: dp.sort,
          ownership: dp.ownership,
          text: { content: dp.html, format: 1 }
        });
      }
    }

    for (let i = desiredPages.length; i < existingPages.length; i++) {
      pagesToDelete.push(existingPages[i].id);
    }

    if (pagesToUpdate.length > 0) {
      await indexEntry.updateEmbeddedDocuments("JournalEntryPage", pagesToUpdate);
    }
    if (pagesToCreate.length > 0) {
      await indexEntry.createEmbeddedDocuments("JournalEntryPage", pagesToCreate);
    }
    if (pagesToDelete.length > 0) {
      await indexEntry.deleteEmbeddedDocuments("JournalEntryPage", pagesToDelete);
    }

    return indexEntry;
  }

  /**
   * Pulls all resources from LegendKeeper into Foundry VTT using a 2-pass strategy
   * so all cross-resource `@UUID` mentions resolve cleanly, while checking per-page
   * local modifications to prevent accidental overwrites.
   */
  async pullAll({ onProgress } = {}) {
    const lk = this.getClient();
    const conflictPolicy = this.getSetting(SETTINGS.CONFLICT_POLICY, "ask");
    const folderMode = this.getSetting(SETTINGS.FOLDER_MODE, "singleFolder");

    this.isSyncingInternal = true;
    let created = 0;
    let updated = 0;
    let skipped = 0;

    try {
      onProgress?.({ phase: "Listing LegendKeeper resources...", current: 0, total: 1 });
      const remoteList = await this.fetchAllRemoteResources();
      const total = remoteList.length;

      const childrenByParentId = new Map();
      const sortedResources = [...remoteList].sort((a, b) => ((a.rank ?? "") < (b.rank ?? "") ? -1 : 1));
      for (const r of sortedResources) {
        if (r.parentId) {
          const list = childrenByParentId.get(r.parentId) ?? [];
          list.push(r.id);
          childrenByParentId.set(r.parentId, list);
        }
      }

      const folderHelper = await this.ensureFolderHierarchy(sortedResources);

      if (folderMode === "singleJournal") {
        const singleRes = await this.#pullAllSingleJournalMode(
          lk,
          sortedResources,
          folderHelper,
          childrenByParentId,
          { onProgress }
        );
        await game.settings.set(MODULE_ID, SETTINGS.LAST_FULL_SYNC, new Date().toISOString());
        return singleRes;
      }

      // Clean up any master journal from singleJournal mode when switching back to multi-journal mode
      const oldMasterJournals = (game.journal ?? []).filter((j) =>
        j.getFlag(MODULE_ID, FLAGS.IS_MASTER_JOURNAL)
      );
      for (const mj of oldMasterJournals) {
        try {
          await mj.delete();
        } catch {
          // Ignore delete error
        }
      }

      // Pass 1: Ensure shell JournalEntries exist for all resources
      const localIndex = this.buildLocalIndex();

      for (let i = 0; i < sortedResources.length; i++) {
        const item = sortedResources[i];
        if (!localIndex.byResourceId.has(item.id)) {
          const targetFolder = folderHelper.getTargetFolderForResource(item);
          const displayPathName = folderHelper.getJournalNameForResource(item);
          const ownership = this.#computeJournalOwnership(item.isHidden);
          const entry = await JournalEntry.create({
            name: displayPathName,
            folder: targetFolder?.id || null,
            ...(ownership ? { ownership } : {}),
            flags: {
              [MODULE_ID]: {
                [FLAGS.RESOURCE_ID]: item.id,
                [FLAGS.RESOURCE_NAME]: item.name,
                [FLAGS.PATH_NAME]: displayPathName,
                [FLAGS.PARENT_ID]: item.parentId || null
              }
            }
          });
          localIndex.byResourceId.set(item.id, entry);
          created++;
        }
      }

      // Pass 2: Pull full resource details, documents, and blocks
      for (let i = 0; i < sortedResources.length; i++) {
        const listItem = sortedResources[i];
        onProgress?.({
          phase: `Syncing "${listItem.name}" (${i + 1}/${total})`,
          current: i + 1,
          total
        });

        const entry = localIndex.byResourceId.get(listItem.id);
        const wasJustCreated = !entry.getFlag(MODULE_ID, FLAGS.LAST_SYNCED_AT);
        const expectedPathName = folderHelper.getJournalNameForResource(listItem);
        const targetFolder = folderHelper.getTargetFolderForResource(listItem);

        if (!wasJustCreated) {
          const storedLkUpdatedAt = entry.getFlag(MODULE_ID, FLAGS.LK_UPDATED_AT);
          const remoteChanged = Boolean(listItem.updatedAt && listItem.updatedAt !== storedLkUpdatedAt);
          const localChanged = hasJournalChangedLocally(entry);
          const needsHashUpgrade = entry.getFlag(MODULE_ID, FLAGS.HASH_VERSION) !== CURRENT_HASH_VERSION;

          if (!remoteChanged && !localChanged && entry.pages?.size > 0) {
            const expectedOwnership = this.#computeJournalOwnership(listItem.isHidden);
            const ownershipChanged = (entry.ownership?.default ?? 0) !== expectedOwnership.default;
            if (
              entry.name !== expectedPathName ||
              (entry.folder?.id || null) !== (targetFolder?.id || null) ||
              ownershipChanged ||
              needsHashUpgrade
            ) {
              await entry.update({
                name: expectedPathName,
                folder: targetFolder?.id || null,
                ownership: { ...(entry.ownership || {}), ...expectedOwnership },
                flags: {
                  [MODULE_ID]: {
                    [FLAGS.RESOURCE_NAME]: listItem.name,
                    [FLAGS.PATH_NAME]: expectedPathName,
                    [FLAGS.IS_HIDDEN]: Boolean(listItem.isHidden),
                    [FLAGS.HASH_VERSION]: CURRENT_HASH_VERSION
                  }
                }
              });
              await entry.setFlag(MODULE_ID, FLAGS.CONTENT_HASH, computeJournalHash(entry));
              updated++;
            } else {
              skipped++;
            }
            continue;
          }

          if (localChanged && !remoteChanged && entry.pages?.size > 0 && conflictPolicy !== "preferLK") {
            skipped++;
            continue;
          }

          if (localChanged && remoteChanged && conflictPolicy === "skip") {
            skipped++;
            continue;
          }
        }

        const resResult = await this.#pullSingleResourceIntoEntry(lk, listItem.id, entry, {
          remoteResources: sortedResources,
          localIndex,
          folderHelper,
          childResourceIds: childrenByParentId.get(listItem.id) || []
        });

        if (resResult?.abandoned) {
          skipped++;
        } else if (!wasJustCreated) {
          updated++;
        }
      }

      onProgress?.({ phase: "Building LegendKeeper Wiki Index...", current: total, total });
      await this.ensureWikiIndexJournal(sortedResources, localIndex, folderHelper.rootFolder);

      await game.settings.set(MODULE_ID, SETTINGS.LAST_FULL_SYNC, new Date().toISOString());
      return { created, updated, skipped, total };
    } finally {
      this.isSyncingInternal = false;
    }
  }

  /**
   * Pulls all LegendKeeper resources into a single master JournalEntry ("📖 LegendKeeper Wiki")
   * with each resource/tab organized as a JournalEntryPage in depth-first tree order.
   */
  async #pullAllSingleJournalMode(lk, sortedResources, folderHelper, childrenByParentId, { onProgress } = {}) {
    const conflictPolicy = this.getSetting(SETTINGS.CONFLICT_POLICY, "ask");
    const observerLevel = globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OBSERVER ?? 2;
    const inheritLevel = globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS?.INHERIT ?? -1;

    // Clean up any individual synced JournalEntries or standalone Wiki Index from other modes
    const legacyEntries = (game.journal ?? []).filter(
      (j) =>
        !j.getFlag(MODULE_ID, FLAGS.IS_MASTER_JOURNAL) &&
        (Boolean(j.getFlag(MODULE_ID, FLAGS.RESOURCE_ID)) ||
          Boolean(j.getFlag(MODULE_ID, FLAGS.IS_INDEX_JOURNAL)))
    );
    if (legacyEntries.length > 0) {
      try {
        await JournalEntry.deleteDocuments(legacyEntries.map((j) => j.id));
      } catch {
        for (const j of legacyEntries) {
          try {
            await j.delete();
          } catch {
            // Ignore cleanup error
          }
        }
      }
    }

    let masterJournal = (game.journal ?? []).find((j) => j.getFlag(MODULE_ID, FLAGS.IS_MASTER_JOURNAL));
    if (!masterJournal) {
      masterJournal = await JournalEntry.create({
        name: "📖 LegendKeeper Wiki",
        folder: folderHelper.rootFolder?.id || null,
        sort: 0,
        ownership: { default: observerLevel },
        flags: {
          [MODULE_ID]: {
            [FLAGS.IS_MASTER_JOURNAL]: true
          }
        }
      });
    } else if (
      masterJournal.name !== "📖 LegendKeeper Wiki" ||
      (masterJournal.folder?.id || null) !== (folderHelper.rootFolder?.id || null) ||
      (masterJournal.ownership?.default ?? 0) !== observerLevel
    ) {
      await masterJournal.update({
        name: "📖 LegendKeeper Wiki",
        folder: folderHelper.rootFolder?.id || null,
        sort: 0,
        ownership: { ...(masterJournal.ownership || {}), default: observerLevel }
      });
    }

    const pathInfo = folderHelper.pathInfo;
    const orderedResources = [];
    const visitedOrder = new Set();
    const walkTree = (parentId, depth) => {
      const kids = pathInfo.childrenByParentId.get(parentId) || [];
      for (const id of kids) {
        if (visitedOrder.has(id)) continue;
        visitedOrder.add(id);
        const r = pathInfo.remoteById.get(id);
        if (r) {
          orderedResources.push({ res: r, depth });
          walkTree(id, depth + 1);
        }
      }
    };
    walkTree(null, 0);
    for (const r of sortedResources) {
      if (!visitedOrder.has(r.id)) {
        orderedResources.push({ res: r, depth: 0 });
      }
    }

    let localIndex = this.buildLocalIndex();
    let created = 0;
    let updated = 0;
    let skipped = 0;
    const total = orderedResources.length;

    // Pass 1: Batch-create placeholder primary JournalEntryPages for any new resources so @UUID links resolve
    const shellPagesToCreate = [];
    for (let i = 0; i < orderedResources.length; i++) {
      const { res, depth } = orderedResources[i];
      if (!localIndex.pagesByResourceId.has(res.id)) {
        const pageOwnership = this.#computePageOwnership(res.isHidden);
        const headingLevel = Math.min(Math.max(depth + 1, 1), 3);
        const hasChildren = (childrenByParentId.get(res.id)?.length || 0) > 0;
        shellPagesToCreate.push({
          name: res.name || "Untitled",
          type: "text",
          sort: (i + 1) * 1000,
          title: { show: true, level: headingLevel },
          ownership: pageOwnership,
          text: { content: "", format: 1 },
          flags: {
            [MODULE_ID]: {
              [FLAGS.RESOURCE_ID]: res.id,
              [FLAGS.RESOURCE_NAME]: res.name,
              [FLAGS.PARENT_ID]: res.parentId || null,
              [FLAGS.IS_PRIMARY_DOC]: true,
              [FLAGS.TREE_DEPTH]: depth,
              [FLAGS.HAS_CHILDREN]: hasChildren,
              [FLAGS.IS_HIDDEN]: Boolean(res.isHidden)
            }
          }
        });
        created++;
      }
    }

    if (shellPagesToCreate.length > 0) {
      await masterJournal.createEmbeddedDocuments("JournalEntryPage", shellPagesToCreate);
      localIndex = this.buildLocalIndex();
    }

    const fastPathUpdates = [];

    // Pass 2: Pull full resource details & blocks into masterJournal pages
    for (let i = 0; i < orderedResources.length; i++) {
      const { res: listItem, depth } = orderedResources[i];
      onProgress?.({
        phase: `Syncing "${listItem.name}" (${i + 1}/${total})`,
        current: i + 1,
        total
      });

      const baseSort = (i + 1) * 1000;
      const existingResPages = localIndex.pagesByResourceId.get(listItem.id) || [];
      const primaryPage = existingResPages[0];
      const wasJustCreated = !primaryPage?.getFlag(MODULE_ID, FLAGS.LAST_SYNCED_AT);
      const childIds = childrenByParentId.get(listItem.id) || [];
      const chain = pathInfo.chainById.get(listItem.id) || [];
      const ancestorIds = chain.slice(0, -1).map((a) => a.id);

      if (!wasJustCreated && primaryPage) {
        const storedLkUpdatedAt = primaryPage.getFlag(MODULE_ID, FLAGS.LK_UPDATED_AT);
        const remoteChanged = Boolean(listItem.updatedAt && listItem.updatedAt !== storedLkUpdatedAt);
        const localChanged = existingResPages.some((p) => hasPageChangedLocally(p));
        const needsTabMerge =
          existingResPages.length > 1 || primaryPage.name !== (listItem.name || "Untitled");

        if (!remoteChanged && !localChanged && !needsTabMerge) {
          let anyMetaChanged = false;
          for (let pIdx = 0; pIdx < existingResPages.length; pIdx++) {
            const p = existingResPages[pIdx];
            const desiredSort = baseSort + pIdx * 10;
            const desiredTreeDepth = depth + (pIdx > 0 ? 1 : 0);
            const desiredHasChildren = pIdx === 0 && childIds.length > 0;
            const desiredLevel = Math.min(Math.max(desiredTreeDepth + 1, 1), 3);
            const isDocHidden = Boolean(listItem.isHidden || p.getFlag(MODULE_ID, FLAGS.IS_HIDDEN));
            const desiredOwnership = this.#computePageOwnership(isDocHidden);

            const oldContent = p.text?.content || "";
            const hasLegacyUuidMacro = oldContent.includes("@UUID[JournalEntry.");
            const needsMultiCrumbUpgrade =
              pIdx === 0 && ancestorIds.length > 1 && oldContent.includes("<strong>Parent:</strong>");
            let newContent = hasLegacyUuidMacro
              ? oldContent.replace(/@UUID\[([^\]]+)\](?:\{([^}]*)\})?/g, (_m, u, lbl) =>
                  renderFoundryContentLink(u, lbl || listItem.name)
                )
              : oldContent;

            if (needsMultiCrumbUpgrade) {
              const crumbHtml = ancestorIds
                .map((ancId) => {
                  const ancPages = localIndex.pagesByResourceId.get(ancId);
                  const ancPage = ancPages?.[0];
                  const ancRes = pathInfo.remoteById.get(ancId);
                  const ancName = ancRes?.name || ancPage?.name || "Parent";
                  return ancPage
                    ? renderFoundryContentLink(
                        `JournalEntry.${masterJournal.id}.JournalEntryPage.${ancPage.id}`,
                        ancName
                      )
                    : ancName;
                })
                .filter(Boolean)
                .join(' <span class="lk-breadcrumb-sep">›</span> ');
              if (crumbHtml) {
                newContent = newContent.replace(
                  /<span class="lk-meta-parent">[\s\S]*?<\/span>/,
                  `<span class="lk-meta-parent"><strong>Path:</strong> ${crumbHtml}</span>`
                );
              }
            }

            const contentUpgraded = newContent !== oldContent;
            const currentActualHash = computePageHash(p);
            const storedHash = p.getFlag(MODULE_ID, FLAGS.PAGE_HASH);
            const storedHashVersion = p.getFlag(MODULE_ID, FLAGS.HASH_VERSION);
            const needsHashRepair =
              storedHashVersion !== CURRENT_HASH_VERSION || currentActualHash !== storedHash;
            const newPageHash = contentUpgraded
              ? computeContentHash(`${p.name}|${stripGeneratedHtml(newContent)}`)
              : currentActualHash;

            const storedDepth = p.getFlag(MODULE_ID, FLAGS.TREE_DEPTH);
            const storedHasChildren = p.getFlag(MODULE_ID, FLAGS.HAS_CHILDREN);

            if (
              p.sort !== desiredSort ||
              p.title?.level !== desiredLevel ||
              (p.ownership?.default ?? inheritLevel) !== desiredOwnership.default ||
              storedDepth !== desiredTreeDepth ||
              storedHasChildren !== desiredHasChildren ||
              contentUpgraded ||
              needsHashRepair
            ) {
              fastPathUpdates.push({
                _id: p.id,
                sort: desiredSort,
                title: { show: true, level: desiredLevel },
                ownership: { ...(p.ownership || {}), ...desiredOwnership },
                ...(contentUpgraded ? { text: { content: newContent, format: 1 } } : {}),
                flags: {
                  [MODULE_ID]: {
                    [FLAGS.TREE_DEPTH]: desiredTreeDepth,
                    [FLAGS.HAS_CHILDREN]: desiredHasChildren,
                    [FLAGS.IS_HIDDEN]: isDocHidden,
                    [FLAGS.PAGE_HASH]: newPageHash,
                    [FLAGS.HASH_VERSION]: CURRENT_HASH_VERSION
                  }
                }
              });
              anyMetaChanged = true;
            }
          }
          if (anyMetaChanged) updated++;
          else skipped++;
          continue;
        }

        if (localChanged && !remoteChanged && conflictPolicy !== "preferLK") {
          skipped++;
          continue;
        }

        if (localChanged && remoteChanged && conflictPolicy === "skip") {
          skipped++;
          continue;
        }
      }

      const resResult = await this.#pullResourceIntoMasterJournal(lk, listItem.id, masterJournal, {
        remoteResources: sortedResources,
        localIndex,
        childResourceIds: childIds,
        ancestorIds,
        baseSort,
        depth
      });

      if (resResult?.abandoned) {
        skipped++;
      } else if (!wasJustCreated) {
        updated++;
      }
    }

    if (fastPathUpdates.length > 0) {
      await masterJournal.updateEmbeddedDocuments("JournalEntryPage", fastPathUpdates);
      const postSaveHashFixes = [];
      for (const upd of fastPathUpdates) {
        const savedPage = masterJournal.pages?.get?.(upd._id);
        if (!savedPage) continue;
        const actualHash = computePageHash(savedPage);
        if (actualHash !== savedPage.getFlag(MODULE_ID, FLAGS.PAGE_HASH)) {
          postSaveHashFixes.push({
            _id: savedPage.id,
            flags: {
              [MODULE_ID]: {
                [FLAGS.PAGE_HASH]: actualHash,
                [FLAGS.HASH_VERSION]: CURRENT_HASH_VERSION
              }
            }
          });
        }
      }
      if (postSaveHashFixes.length > 0) {
        await masterJournal.updateEmbeddedDocuments("JournalEntryPage", postSaveHashFixes);
      }
    }

    onProgress?.({ phase: "Building LegendKeeper Wiki Directory Page...", current: total, total });
    localIndex = this.buildLocalIndex();
    await this.#ensureMasterIndexPage(masterJournal, sortedResources, localIndex);

    return { created, updated, skipped, total };
  }

  /**
   * Ensures the first page (sort: 0) of the single master JournalEntry is the "📖 Wiki Directory" tree.
   */
  async #ensureMasterIndexPage(masterJournal, remoteResources, localIndex) {
    const inheritLevel = globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS?.INHERIT ?? -1;
    const { overviewHtml } = this.#buildWikiDirectoryPagesData(remoteResources, localIndex);

    const existingIndexPage = (masterJournal.pages ?? []).find((p) =>
      p.getFlag(MODULE_ID, FLAGS.IS_INDEX_PAGE)
    );

    if (existingIndexPage) {
      await masterJournal.updateEmbeddedDocuments("JournalEntryPage", [
        {
          _id: existingIndexPage.id,
          name: "📖 Wiki Directory",
          type: "text",
          sort: 0,
          title: { show: true, level: 1 },
          ownership: { default: inheritLevel },
          text: { content: overviewHtml, format: 1 },
          flags: {
            [MODULE_ID]: {
              [FLAGS.IS_INDEX_PAGE]: true
            }
          }
        }
      ]);
    } else {
      await masterJournal.createEmbeddedDocuments("JournalEntryPage", [
        {
          name: "📖 Wiki Directory",
          type: "text",
          sort: 0,
          title: { show: true, level: 1 },
          ownership: { default: inheritLevel },
          text: { content: overviewHtml, format: 1 },
          flags: {
            [MODULE_ID]: {
              [FLAGS.IS_INDEX_PAGE]: true
            }
          }
        }
      ]);
    }
  }

  async #pullResourceIntoMasterJournal(
    lk,
    resourceId,
    masterJournal,
    { remoteResources, localIndex, childResourceIds, ancestorIds = [], baseSort = 1000, depth = 0 }
  ) {
    const resource = await lk.resources.get({ resourceId });
    const hiddenHandling = this.getSetting(SETTINGS.HIDDEN_RESOURCE_HANDLING, "gmOnly");
    const includeSidebarProperties = this.getSetting(SETTINGS.INCLUDE_SIDEBAR_PROPERTIES, true);
    const includeNavigationLinks = this.getSetting(SETTINGS.INCLUDE_NAVIGATION_LINKS, true);
    const secretHandling = this.getSetting(SETTINGS.SECRET_HANDLING, "secretBlock");
    const conflictPolicy = this.getSetting(SETTINGS.CONFLICT_POLICY, "ask");

    const converterContext = this.createConverterContext(remoteResources, localIndex);
    const listRes = remoteResources?.find((r) => r.id === resource.id);
    const effectiveResourceHidden = Boolean(resource.isHidden || listRes?.isHidden);

    const docs = [...(resource.documents || [])]
      .filter((d) => !(hiddenHandling === "skip" && d.isHidden))
      .sort((a, b) => ((a.rank ?? "") < (b.rank ?? "") ? -1 : 1));

    const { headerHtml, footerHtml } = renderResourceDecorationHtml(resource, {
      includeSidebarProperties,
      includeNavigationLinks,
      secretHandling,
      resolveMention: converterContext.resolveMention,
      evaluateCollectionFilter: converterContext.evaluateCollectionFilter,
      childResourceIds,
      ancestorIds
    });

    const existingResPages = localIndex.pagesByResourceId.get(resource.id) || [];
    const primaryPage = existingResPages[0] || null;
    const extraLegacyPages = existingResPages.slice(1);
    const storedTabsMeta = primaryPage?.getFlag(MODULE_ID, FLAGS.TAB_DOCS_META) || [];
    const storedMetaByDocId = new Map(
      Array.isArray(storedTabsMeta) ? storedTabsMeta.map((m) => [m.documentId, m]) : []
    );

    if (primaryPage && primaryPage.getFlag(MODULE_ID, FLAGS.LAST_SYNCED_AT) && extraLegacyPages.length === 0) {
      const localChanged = hasPageChangedLocally(primaryPage);

      if (localChanged && conflictPolicy === "skip") {
        return { abandoned: true };
      }
    }

    const tabSectionsHtml = [];
    const tabDocsMeta = [];
    const isMultiTab = docs.length > 1;

    for (let idx = 0; idx < docs.length; idx++) {
      const doc = docs[idx];
      const cleanDocName = doc.name || "Main";
      let docBodyHtml = "";
      let blockVersion = null;
      const strippedBlocks = [];

      if (doc.type === "page" || doc.type === "blank") {
        const docBlocks = await lk.documents.getBlocks({
          resourceId: resource.id,
          documentId: doc.id
        });
        blockVersion = docBlocks.version;
        docBodyHtml = blocksToHtml(docBlocks.blocks || [], {
          ...converterContext,
          currentResourceId: resource.id,
          strippedBlocks
        });
      } else if (doc.type === "map") {
        const fullDoc = await lk.documents.get({ resourceId: resource.id, documentId: doc.id });
        const featuresPage = await lk.features.list({ resourceId: resource.id, documentId: doc.id });
        docBodyHtml = renderMapDocumentHtml(fullDoc, featuresPage.data || [], converterContext);
      } else if (doc.type === "time") {
        const lanesPage = await lk.timelines.listLanes({ resourceId: resource.id, documentId: doc.id });
        const events = [];
        for await (const ev of await lk.timelines.listEvents({
          resourceId: resource.id,
          documentId: doc.id,
          limit: 100
        })) {
          events.push(ev);
        }
        docBodyHtml = renderTimelineDocumentHtml(doc, lanesPage.data || [], events, converterContext);
      } else {
        docBodyHtml = `<div class="lk-board-placeholder" data-lk-generated="true"><p><em>LegendKeeper ${escapeHtml(doc.type)} document ("${escapeHtml(cleanDocName)}").</em></p></div>`;
      }

      tabDocsMeta.push({
        documentId: doc.id,
        name: cleanDocName,
        type: doc.type,
        version: blockVersion,
        isHidden: Boolean(doc.isHidden),
        preservedBlocks: strippedBlocks
      });

      if (!isMultiTab) {
        tabSectionsHtml.push(docBodyHtml);
      } else {
        const showFirstTabHeading =
          idx === 0 &&
          cleanDocName.toLowerCase() !== "main" &&
          cleanDocName.toLowerCase() !== (resource.name || "").toLowerCase();

        let separatorHtml = "";
        if (idx > 0) {
          separatorHtml = `<div class="lk-tab-separator" data-lk-generated="true"><hr class="lk-tab-hr" /><h2 class="lk-tab-title"><i class="fas fa-bookmark"></i> ${escapeHtml(cleanDocName)}</h2></div>\n`;
        } else if (showFirstTabHeading) {
          separatorHtml = `<div class="lk-tab-separator lk-tab-first" data-lk-generated="true"><h2 class="lk-tab-title"><i class="fas fa-bookmark"></i> ${escapeHtml(cleanDocName)}</h2></div>\n`;
        }

        const sectionInner = `<div class="lk-doc-tab-section" data-lk-doc-id="${escapeHtml(doc.id)}" data-lk-doc-type="${escapeHtml(doc.type)}" data-lk-doc-name="${escapeHtml(cleanDocName)}">${separatorHtml}${docBodyHtml}</div>`;
        if (doc.isHidden && !effectiveResourceHidden && hiddenHandling === "gmOnly") {
          tabSectionsHtml.push(`<section class="secret">${sectionInner}</section>`);
        } else {
          tabSectionsHtml.push(sectionInner);
        }
      }
    }

    const combinedBodyHtml = tabSectionsHtml.join("\n");
    const pageHtml = `${headerHtml}${combinedBodyHtml}${footerHtml}`;
    const pageName = resource.name || "Untitled";
    const headingLevel = Math.min(Math.max(depth + 1, 1), 3);
    const newPageHash = computeContentHash(`${pageName}|${stripGeneratedHtml(pageHtml)}`);
    const pageOwnership = this.#computePageOwnership(effectiveResourceHidden);
    const pageHasChildren = Boolean(Array.isArray(childResourceIds) && childResourceIds.length > 0);
    const firstDoc = docs[0];
    const firstMeta = tabDocsMeta[0];

    const pageFlags = {
      [FLAGS.RESOURCE_ID]: resource.id,
      [FLAGS.RESOURCE_NAME]: resource.name,
      [FLAGS.PARENT_ID]: resource.parentId || null,
      [FLAGS.DOCUMENT_ID]: firstDoc?.id || null,
      [FLAGS.DOCUMENT_TYPE]: firstDoc?.type || "page",
      [FLAGS.IS_PRIMARY_DOC]: true,
      [FLAGS.TAB_DOCS_META]: tabDocsMeta,
      [FLAGS.TREE_DEPTH]: depth,
      [FLAGS.HAS_CHILDREN]: pageHasChildren,
      [FLAGS.VERSION]: firstMeta?.version || null,
      [FLAGS.PAGE_HASH]: newPageHash,
      [FLAGS.HASH_VERSION]: CURRENT_HASH_VERSION,
      [FLAGS.LK_UPDATED_AT]: resource.updatedAt || new Date().toISOString(),
      [FLAGS.LAST_SYNCED_AT]: Date.now(),
      [FLAGS.IS_HIDDEN]: effectiveResourceHidden,
      [FLAGS.TAGS]: resource.tags || [],
      [FLAGS.ALIASES]: resource.aliases || [],
      [FLAGS.PRESERVED_BLOCKS]: firstMeta?.preservedBlocks || []
    };

    let targetPage = primaryPage;
    if (primaryPage) {
      await masterJournal.updateEmbeddedDocuments("JournalEntryPage", [
        {
          _id: primaryPage.id,
          name: pageName,
          type: "text",
          sort: baseSort,
          title: { show: true, level: headingLevel },
          text: { content: pageHtml, format: 1 },
          ownership: { ...(primaryPage.ownership || {}), ...pageOwnership },
          flags: { [MODULE_ID]: pageFlags }
        }
      ]);
      targetPage = masterJournal.pages?.get?.(primaryPage.id) || primaryPage;
    } else {
      const createdPages = await masterJournal.createEmbeddedDocuments("JournalEntryPage", [
        {
          name: pageName,
          type: "text",
          sort: baseSort,
          title: { show: true, level: headingLevel },
          text: { content: pageHtml, format: 1 },
          ownership: pageOwnership,
          flags: { [MODULE_ID]: pageFlags }
        }
      ]);
      targetPage = createdPages[0] || null;
    }

    // Recompute hash from the actual server-saved page content (in case Foundry's server sanitizer normalized HTML)
    if (targetPage) {
      const postSaveHash = computePageHash(targetPage);
      if (postSaveHash !== newPageHash) {
        await masterJournal.updateEmbeddedDocuments("JournalEntryPage", [
          {
            _id: targetPage.id,
            flags: {
              [MODULE_ID]: {
                [FLAGS.PAGE_HASH]: postSaveHash,
                [FLAGS.HASH_VERSION]: CURRENT_HASH_VERSION
              }
            }
          }
        ]);
      }
    }

    if (extraLegacyPages.length > 0) {
      try {
        await masterJournal.deleteEmbeddedDocuments(
          "JournalEntryPage",
          extraLegacyPages.map((p) => p.id)
        );
      } catch {
        // Ignore cleanup errors
      }
    }

    if (targetPage) {
      localIndex.pagesByResourceId.set(resource.id, [targetPage]);
      for (const tm of tabDocsMeta) {
        if (tm.documentId) {
          localIndex.byDocumentId.set(tm.documentId, { entry: masterJournal, page: targetPage });
        }
      }
    }

    return { abandoned: false };
  }

  /**
   * Pulls a single resource by its LegendKeeper resourceId into Foundry VTT.
   */
  async pullResource(resourceId) {
    const lk = this.getClient();
    const folderMode = this.getSetting(SETTINGS.FOLDER_MODE, "singleFolder");
    this.isSyncingInternal = true;
    try {
      const remoteResources = await this.fetchAllRemoteResources();
      const folderHelper = await this.ensureFolderHierarchy(remoteResources);
      let localIndex = this.buildLocalIndex();

      const childResourceIds = remoteResources
        .filter((r) => r.parentId === resourceId)
        .sort((a, b) => ((a.rank ?? "") < (b.rank ?? "") ? -1 : 1))
        .map((r) => r.id);

      if (folderMode === "singleJournal") {
        const observerLevel = globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OBSERVER ?? 2;
        let masterJournal = localIndex.masterJournal;
        if (!masterJournal) {
          masterJournal = await JournalEntry.create({
            name: "📖 LegendKeeper Wiki",
            folder: folderHelper.rootFolder?.id || null,
            sort: 0,
            ownership: { default: observerLevel },
            flags: { [MODULE_ID]: { [FLAGS.IS_MASTER_JOURNAL]: true } }
          });
          localIndex = this.buildLocalIndex();
        }
        const chain = folderHelper.pathInfo.chainById.get(resourceId) || [];
        const ancestorIds = chain.slice(0, -1).map((a) => a.id);
        const depth = Math.max(0, chain.length - 1);
        const existingResPages = localIndex.pagesByResourceId.get(resourceId) || [];
        const baseSort = existingResPages[0]?.sort || (masterJournal.pages.size + 1) * 1000;

        await this.#pullResourceIntoMasterJournal(lk, resourceId, masterJournal, {
          remoteResources,
          localIndex,
          childResourceIds,
          ancestorIds,
          baseSort,
          depth
        });
        localIndex = this.buildLocalIndex();
        await this.#ensureMasterIndexPage(masterJournal, remoteResources, localIndex);
        return masterJournal;
      }

      let entry = localIndex.byResourceId.get(resourceId);
      if (!entry) {
        const fullRes = await lk.resources.get({ resourceId });
        const targetFolder = folderHelper.getTargetFolderForResource(fullRes);
        const displayPathName = folderHelper.getJournalNameForResource(fullRes);
        const ownership = this.#computeJournalOwnership(fullRes.isHidden);
        entry = await JournalEntry.create({
          name: displayPathName,
          folder: targetFolder?.id || null,
          ...(ownership ? { ownership } : {}),
          flags: {
            [MODULE_ID]: {
              [FLAGS.RESOURCE_ID]: fullRes.id,
              [FLAGS.RESOURCE_NAME]: fullRes.name,
              [FLAGS.PATH_NAME]: displayPathName,
              [FLAGS.PARENT_ID]: fullRes.parentId || null
            }
          }
        });
        localIndex.byResourceId.set(fullRes.id, entry);
      }

      await this.#pullSingleResourceIntoEntry(lk, resourceId, entry, {
        remoteResources,
        localIndex,
        folderHelper,
        childResourceIds
      });

      await this.ensureWikiIndexJournal(remoteResources, localIndex, folderHelper.rootFolder);

      return entry;
    } finally {
      this.isSyncingInternal = false;
    }
  }

  #computeJournalOwnership(isHidden) {
    const hiddenHandling = this.getSetting(SETTINGS.HIDDEN_RESOURCE_HANDLING, "gmOnly");
    const noneLevel = globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS?.NONE ?? 0;
    const observerLevel = globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OBSERVER ?? 2;
    if (isHidden && hiddenHandling === "gmOnly") {
      return { default: noneLevel };
    }
    return { default: observerLevel };
  }

  #computePageOwnership(isHidden) {
    const hiddenHandling = this.getSetting(SETTINGS.HIDDEN_RESOURCE_HANDLING, "gmOnly");
    const noneLevel = globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS?.NONE ?? 0;
    const inheritLevel = globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS?.INHERIT ?? -1;
    if (isHidden && hiddenHandling === "gmOnly") {
      return { default: noneLevel };
    }
    return { default: inheritLevel };
  }

  async #pullSingleResourceIntoEntry(
    lk,
    resourceId,
    entry,
    { remoteResources, localIndex, folderHelper, childResourceIds }
  ) {
    const resource = await lk.resources.get({ resourceId });
    const targetFolder = folderHelper.getTargetFolderForResource(resource);
    const hiddenHandling = this.getSetting(SETTINGS.HIDDEN_RESOURCE_HANDLING, "gmOnly");
    const includeSidebarProperties = this.getSetting(SETTINGS.INCLUDE_SIDEBAR_PROPERTIES, true);
    const includeNavigationLinks = this.getSetting(SETTINGS.INCLUDE_NAVIGATION_LINKS, true);
    const secretHandling = this.getSetting(SETTINGS.SECRET_HANDLING, "secretBlock");
    const conflictPolicy = this.getSetting(SETTINGS.CONFLICT_POLICY, "ask");

    const converterContext = this.createConverterContext(remoteResources, localIndex);

    const docs = [...(resource.documents || [])]
      .filter((d) => !(hiddenHandling === "skip" && d.isHidden))
      .sort((a, b) => ((a.rank ?? "") < (b.rank ?? "") ? -1 : 1));

    const chain = folderHelper.pathInfo?.chainById?.get(resource.id) || [];
    const ancestorIds = chain.slice(0, -1).map((a) => a.id);

    const { headerHtml, footerHtml } = renderResourceDecorationHtml(resource, {
      includeSidebarProperties,
      includeNavigationLinks,
      secretHandling,
      resolveMention: converterContext.resolveMention,
      evaluateCollectionFilter: converterContext.evaluateCollectionFilter,
      childResourceIds,
      ancestorIds
    });

    const existingPagesByDocId = new Map();
    for (const p of entry.pages ?? []) {
      const dId = p.getFlag(MODULE_ID, FLAGS.DOCUMENT_ID);
      if (dId) existingPagesByDocId.set(dId, p);
    }

    const pagesToCreate = [];
    const pagesToUpdate = [];
    let abandonedAny = false;

    for (let idx = 0; idx < docs.length; idx++) {
      const doc = docs[idx];
      const isPrimaryPage = idx === 0;
      const sortValue = (idx + 1) * 10000;
      const existingPage = existingPagesByDocId.get(doc.id);

      let pageHtml = "";
      let blockVersion = null;
      const strippedBlocks = [];

      if (doc.type === "page" || doc.type === "blank") {
        const docBlocks = await lk.documents.getBlocks({
          resourceId: resource.id,
          documentId: doc.id
        });
        blockVersion = docBlocks.version;

        // Check for page-level conflict before overwriting an existing Foundry page!
        if (existingPage) {
          const storedVersion = existingPage.getFlag(MODULE_ID, FLAGS.VERSION);
          const localChanged = hasPageChangedLocally(existingPage);
          const remoteChanged = !storedVersion || storedVersion !== blockVersion;

          if (localChanged && !remoteChanged && conflictPolicy !== "preferLK") {
            continue;
          }

          if (localChanged && remoteChanged) {
            if (conflictPolicy === "skip") {
              abandonedAny = true;
              continue;
            }
            if (conflictPolicy === "ask") {
              const decision = await promptPageConflictResolution({
                resourceName: resource.name,
                pageName: doc.name || existingPage.name || "Main",
                remoteText: docBlocks.text || "",
                localHtml: existingPage.text?.content || "",
                operation: "pull"
              });

              if (decision === "cancel") {
                abandonedAny = true;
                ui.notifications?.warn(
                  `Skipped syncing "${resource.name} → ${doc.name || existingPage.name}" due to conflict.`
                );
                continue;
              }

              if (decision === "keep-foundry") {
                const preserved = existingPage.getFlag(MODULE_ID, FLAGS.PRESERVED_BLOCKS) || [];
                const blocksToPush = await htmlToBlocks(existingPage.text?.content || "", {
                  ...converterContext,
                  preservedBlocks: preserved
                });
                const written = await lk.documents.replaceBlocks(
                  { resourceId: resource.id, documentId: doc.id },
                  { blocks: blocksToPush, ifMatch: blockVersion }
                );
                await existingPage.update({
                  flags: {
                    [MODULE_ID]: {
                      [FLAGS.VERSION]: written.version,
                      [FLAGS.PAGE_HASH]: computePageHash(existingPage)
                    }
                  }
                });
                continue;
              }
            }
          }
        }

        const bodyHtml = blocksToHtml(docBlocks.blocks || [], {
          ...converterContext,
          currentResourceId: resource.id,
          strippedBlocks
        });
        pageHtml = isPrimaryPage ? `${headerHtml}${bodyHtml}${footerHtml}` : bodyHtml;
      } else if (doc.type === "map") {
        const fullDoc = await lk.documents.get({ resourceId: resource.id, documentId: doc.id });
        const featuresPage = await lk.features.list({ resourceId: resource.id, documentId: doc.id });
        const mapHtml = renderMapDocumentHtml(fullDoc, featuresPage.data || [], converterContext);
        pageHtml = isPrimaryPage ? `${headerHtml}${mapHtml}${footerHtml}` : mapHtml;
      } else if (doc.type === "time") {
        const lanesPage = await lk.timelines.listLanes({ resourceId: resource.id, documentId: doc.id });
        const events = [];
        for await (const ev of await lk.timelines.listEvents({
          resourceId: resource.id,
          documentId: doc.id,
          limit: 100
        })) {
          events.push(ev);
        }
        const timelineHtml = renderTimelineDocumentHtml(doc, lanesPage.data || [], events, converterContext);
        pageHtml = isPrimaryPage ? `${headerHtml}${timelineHtml}${footerHtml}` : timelineHtml;
      } else {
        const fallbackHtml = `<div class="lk-board-placeholder" data-lk-generated="true"><p><em>LegendKeeper ${doc.type} document ("${doc.name}").</em></p></div>`;
        pageHtml = isPrimaryPage ? `${headerHtml}${fallbackHtml}${footerHtml}` : fallbackHtml;
      }

      const pageName = doc.name || "Main";
      const newPageHash = computeContentHash(`${pageName}|${stripGeneratedHtml(pageHtml)}`);

      const pageFlags = {
        [FLAGS.RESOURCE_ID]: resource.id,
        [FLAGS.DOCUMENT_ID]: doc.id,
        [FLAGS.DOCUMENT_TYPE]: doc.type,
        [FLAGS.VERSION]: blockVersion,
        [FLAGS.PAGE_HASH]: newPageHash,
        [FLAGS.IS_HIDDEN]: Boolean(doc.isHidden),
        [FLAGS.PRESERVED_BLOCKS]: strippedBlocks
      };

      const pageOwnership = this.#computePageOwnership(doc.isHidden);

      if (existingPage) {
        pagesToUpdate.push({
          _id: existingPage.id,
          name: pageName,
          type: "text",
          sort: sortValue,
          text: { content: pageHtml, format: 1 },
          ownership: { ...(existingPage.ownership || {}), ...pageOwnership },
          flags: { [MODULE_ID]: pageFlags }
        });
      } else {
        pagesToCreate.push({
          name: pageName,
          type: "text",
          sort: sortValue,
          text: { content: pageHtml, format: 1 },
          ownership: pageOwnership,
          flags: { [MODULE_ID]: pageFlags }
        });
      }
    }

    if (pagesToCreate.length > 0) {
      const createdPages = await entry.createEmbeddedDocuments("JournalEntryPage", pagesToCreate);
      for (const p of createdPages) {
        const dId = p.getFlag(MODULE_ID, FLAGS.DOCUMENT_ID);
        if (dId) localIndex.byDocumentId.set(dId, { entry, page: p });
      }
    }

    if (pagesToUpdate.length > 0) {
      await entry.updateEmbeddedDocuments("JournalEntryPage", pagesToUpdate);
    }

    // Ensure all page hashes match post-save server-sanitized HTML
    const pageHashFixes = [];
    for (const p of entry.pages ?? []) {
      const actualPageHash = computePageHash(p);
      if (
        actualPageHash !== p.getFlag(MODULE_ID, FLAGS.PAGE_HASH) ||
        p.getFlag(MODULE_ID, FLAGS.HASH_VERSION) !== CURRENT_HASH_VERSION
      ) {
        pageHashFixes.push({
          _id: p.id,
          flags: {
            [MODULE_ID]: {
              [FLAGS.PAGE_HASH]: actualPageHash,
              [FLAGS.HASH_VERSION]: CURRENT_HASH_VERSION
            }
          }
        });
      }
    }
    if (pageHashFixes.length > 0) {
      await entry.updateEmbeddedDocuments("JournalEntryPage", pageHashFixes);
    }

    const listRes = remoteResources?.find((r) => r.id === resource.id);
    const effectiveResourceHidden = Boolean(resource.isHidden || listRes?.isHidden);
    const entryOwnership = this.#computeJournalOwnership(effectiveResourceHidden);
    const displayPathName = folderHelper.getJournalNameForResource(resource);
    const updatedHash = computeJournalHash(entry);

    await entry.update({
      name: displayPathName,
      folder: targetFolder?.id || null,
      ownership: { ...(entry.ownership || {}), ...entryOwnership },
      flags: {
        [MODULE_ID]: {
          [FLAGS.RESOURCE_ID]: resource.id,
          [FLAGS.RESOURCE_NAME]: resource.name,
          [FLAGS.PATH_NAME]: displayPathName,
          [FLAGS.PARENT_ID]: resource.parentId || null,
          [FLAGS.LK_UPDATED_AT]: resource.updatedAt || new Date().toISOString(),
          [FLAGS.LAST_SYNCED_AT]: Date.now(),
          [FLAGS.CONTENT_HASH]: updatedHash,
          [FLAGS.HASH_VERSION]: CURRENT_HASH_VERSION,
          [FLAGS.TAGS]: resource.tags || [],
          [FLAGS.ALIASES]: resource.aliases || [],
          [FLAGS.ICON_GLYPH]: resource.iconGlyph || null,
          [FLAGS.ICON_COLOR]: resource.iconColor || null,
          [FLAGS.ICON_SHAPE]: resource.iconShape || null,
          [FLAGS.ICON_SIZE]: resource.iconSize || null,
          [FLAGS.IS_HIDDEN]: effectiveResourceHidden,
          [FLAGS.IS_LOCKED]: Boolean(resource.isLocked),
          [FLAGS.BANNER]: resource.banner || null,
          [FLAGS.PROPERTIES]: resource.properties || []
        }
      }
    });

    const finalHash = computeJournalHash(entry);
    if (finalHash !== updatedHash) {
      await entry.setFlag(MODULE_ID, FLAGS.CONTENT_HASH, finalHash);
    }

    return { abandoned: abandonedAny };
  }

  /**
   * Pushes a single Foundry JournalEntry (or a specific resource's pages inside the single master journal)
   * to LegendKeeper, always checking LegendKeeper's latest version first and prompting on conflicts.
   */
  async pushJournal(journalEntry, { resourceId: targetResourceId = null } = {}) {
    if (!journalEntry) throw new Error("No JournalEntry provided to push.");
    if (journalEntry.getFlag(MODULE_ID, FLAGS.IS_INDEX_JOURNAL)) {
      return null;
    }
    const lk = this.getClient();
    const conflictPolicy = this.getSetting(SETTINGS.CONFLICT_POLICY, "ask");
    this.isSyncingInternal = true;

    try {
      const localIndex = this.buildLocalIndex();
      const converterContext = this.createConverterContext([], localIndex);

      if (journalEntry.getFlag(MODULE_ID, FLAGS.IS_MASTER_JOURNAL)) {
        return await this.#pushMasterJournalResources(
          lk,
          journalEntry,
          localIndex,
          converterContext,
          targetResourceId
        );
      }

      let resourceId = journalEntry.getFlag(MODULE_ID, FLAGS.RESOURCE_ID);
      const folderResourceId = journalEntry.folder?.getFlag?.(MODULE_ID, FLAGS.RESOURCE_ID) || null;
      const storedParentId = journalEntry.getFlag(MODULE_ID, FLAGS.PARENT_ID) || null;
      const storedPathName = journalEntry.getFlag(MODULE_ID, FLAGS.PATH_NAME) || "";
      const storedResourceName = journalEntry.getFlag(MODULE_ID, FLAGS.RESOURCE_NAME) || "";

      const rawSegments = String(journalEntry.name || "Untitled")
        .split(/\s*(?:\/|▸)\s*/)
        .map((s) => s.trim())
        .filter(Boolean);
      const leafName = rawSegments[rawSegments.length - 1] || journalEntry.name || "Untitled";
      const parentPathPrefix = rawSegments.slice(0, -1).join(" / ");

      let desiredResourceName = leafName;
      let targetParentId = storedParentId;

      if (resourceId && journalEntry.name === storedPathName && storedResourceName) {
        desiredResourceName = storedResourceName;
      } else if (parentPathPrefix) {
        const currentFolderId = journalEntry.folder?.id || null;
        const matchingParentEntry = Array.from(localIndex.byResourceId.values()).find((e) => {
          const sameFolder = (e.folder?.id || null) === currentFolderId;
          const pName = e.getFlag(MODULE_ID, FLAGS.PATH_NAME) || e.name;
          return sameFolder && pName.toLowerCase() === parentPathPrefix.toLowerCase();
        });
        if (matchingParentEntry) {
          targetParentId = matchingParentEntry.getFlag(MODULE_ID, FLAGS.RESOURCE_ID) || storedParentId;
        } else if (folderResourceId && folderResourceId !== resourceId) {
          targetParentId = folderResourceId;
        }
      } else if (!resourceId && folderResourceId) {
        targetParentId = folderResourceId;
      }

      const tags = journalEntry.getFlag(MODULE_ID, FLAGS.TAGS) || [];
      const aliases = journalEntry.getFlag(MODULE_ID, FLAGS.ALIASES) || [];

      let remoteResource = null;
      let isNewResource = false;
      if (resourceId) {
        try {
          remoteResource = await lk.resources.get({ resourceId });
        } catch (err) {
          if (err instanceof NotFoundError) {
            resourceId = null;
          } else {
            throw err;
          }
        }
      }

      if (!resourceId) {
        isNewResource = true;
        const createPayload = {
          name: desiredResourceName
        };
        if (targetParentId) createPayload.parentId = targetParentId;
        if (Array.isArray(tags) && tags.length > 0) createPayload.tags = tags;
        if (Array.isArray(aliases) && aliases.length > 0) createPayload.aliases = aliases;

        remoteResource = await lk.resources.create(createPayload);
        resourceId = remoteResource.id;
        localIndex.byResourceId.set(resourceId, journalEntry);
      } else {
        const patch = {};
        if (remoteResource.name !== desiredResourceName) patch.name = desiredResourceName;
        if (Object.keys(patch).length > 0) {
          remoteResource = await lk.resources.update({ resourceId }, patch);
        }

        const currentRemoteParent = remoteResource.parentId || null;
        if (currentRemoteParent !== (targetParentId || null)) {
          remoteResource = await lk.resources.move(
            { resourceId },
            { parentId: targetParentId || null }
          );
        }
      }

      const remoteDocs = [...(remoteResource.documents || [])].sort((a, b) =>
        (a.rank ?? "") < (b.rank ?? "") ? -1 : 1
      );
      const remoteDocsById = new Map(remoteDocs.map((d) => [d.id, d]));
      const usedRemoteDocIds = new Set();

      const sortedPages = Array.from(journalEntry.pages ?? []).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));

      for (let i = 0; i < sortedPages.length; i++) {
        const page = sortedPages[i];
        if (page.type !== "text") continue;

        const docTypeFlag = page.getFlag(MODULE_ID, FLAGS.DOCUMENT_TYPE);
        if (docTypeFlag && docTypeFlag !== "page" && docTypeFlag !== "blank") {
          continue;
        }

        let docId = page.getFlag(MODULE_ID, FLAGS.DOCUMENT_ID);
        let remoteDoc = docId ? remoteDocsById.get(docId) : null;
        let isNewlyPairedDoc = false;

        if (!remoteDoc && i === 0 && isNewResource && remoteDocs.length > 0 && !usedRemoteDocIds.has(remoteDocs[0].id)) {
          const candidate = remoteDocs[0];
          if (candidate.type === "blank" || candidate.type === "page") {
            remoteDoc = candidate;
            docId = candidate.id;
            isNewlyPairedDoc = true;
          }
        }

        if (!remoteDoc) {
          remoteDoc = await lk.documents.create(
            { resourceId },
            {
              name: (page.name || "Main").slice(0, 500),
              type: "page"
            }
          );
          docId = remoteDoc.id;
          remoteDocsById.set(docId, remoteDoc);
          isNewlyPairedDoc = true;
        }

        usedRemoteDocIds.add(docId);

        const remoteDocBlocks = await lk.documents.getBlocks({ resourceId, documentId: docId });
        const storedVersion = page.getFlag(MODULE_ID, FLAGS.VERSION);
        const storedPageHash = page.getFlag(MODULE_ID, FLAGS.PAGE_HASH);
        const currentPageHash = computePageHash(page);

        const remoteChanged = Boolean(
          !isNewlyPairedDoc && storedVersion && remoteDocBlocks.version !== storedVersion
        );
        const localChanged = Boolean(
          isNewlyPairedDoc || !storedPageHash || currentPageHash !== storedPageHash
        );

        if (!localChanged && !remoteChanged) {
          if (remoteDoc.name !== page.name && page.name) {
            await lk.documents.update({ resourceId, documentId: docId }, { name: page.name.slice(0, 500) });
          }
          continue;
        }

        if (!localChanged && remoteChanged) {
          await this.#applyRemoteBlocksToLocalPage(page, resourceId, remoteDoc, remoteDocBlocks, converterContext);
          continue;
        }

        if (localChanged && remoteChanged) {
          let decision = "keep-foundry";
          if (conflictPolicy === "skip") {
            decision = "cancel";
          } else if (conflictPolicy === "preferLK") {
            decision = "keep-lk";
          } else {
            decision = await promptPageConflictResolution({
              resourceName: journalEntry.name,
              pageName: page.name || remoteDoc.name || "Main",
              remoteText: remoteDocBlocks.text || "",
              localHtml: page.text?.content || "",
              operation: "push"
            });
          }

          if (decision === "cancel") {
            ui.notifications?.warn(
              `Skipped syncing "${journalEntry.name} → ${page.name}" (conflict left untouched).`
            );
            continue;
          }

          if (decision === "keep-lk") {
            await this.#applyRemoteBlocksToLocalPage(page, resourceId, remoteDoc, remoteDocBlocks, converterContext);
            continue;
          }
        }

        if (remoteDoc.name !== page.name && page.name) {
          await lk.documents.update(
            { resourceId, documentId: docId },
            { name: page.name.slice(0, 500) }
          );
        }

        const preservedBlocks = page.getFlag(MODULE_ID, FLAGS.PRESERVED_BLOCKS) || [];
        const blocks = await htmlToBlocks(page.text?.content || "", {
          ...converterContext,
          preservedBlocks
        });

        const written = await lk.documents.replaceBlocks(
          { resourceId, documentId: docId },
          {
            blocks,
            ifMatch: remoteDocBlocks.version
          }
        );

        await page.update({
          flags: {
            [MODULE_ID]: {
              [FLAGS.RESOURCE_ID]: resourceId,
              [FLAGS.DOCUMENT_ID]: docId,
              [FLAGS.DOCUMENT_TYPE]: "page",
              [FLAGS.VERSION]: written.version,
              [FLAGS.PAGE_HASH]: computePageHash(page)
            }
          }
        });
      }

      for (const remoteDoc of remoteDocs) {
        if (usedRemoteDocIds.has(remoteDoc.id)) continue;
        if (remoteDoc.type === "page" || remoteDoc.type === "blank") {
          const remoteDocBlocks = await lk.documents.getBlocks({
            resourceId,
            documentId: remoteDoc.id
          });
          const strippedBlocks = [];
          const bodyHtml = blocksToHtml(remoteDocBlocks.blocks || [], {
            ...converterContext,
            currentResourceId: resourceId,
            strippedBlocks
          });
          const pageName = remoteDoc.name || "Page";
          const pageHash = computeContentHash(`${pageName}|${stripGeneratedHtml(bodyHtml)}`);
          await journalEntry.createEmbeddedDocuments("JournalEntryPage", [
            {
              name: pageName,
              type: "text",
              sort: (journalEntry.pages.size + 1) * 10000,
              text: { content: bodyHtml, format: 1 },
              flags: {
                [MODULE_ID]: {
                  [FLAGS.RESOURCE_ID]: resourceId,
                  [FLAGS.DOCUMENT_ID]: remoteDoc.id,
                  [FLAGS.DOCUMENT_TYPE]: remoteDoc.type,
                  [FLAGS.VERSION]: remoteDocBlocks.version,
                  [FLAGS.PAGE_HASH]: pageHash,
                  [FLAGS.PRESERVED_BLOCKS]: strippedBlocks
                }
              }
            }
          ]);
        }
      }

      const finalRemote = await lk.resources.get({ resourceId });
      const finalHash = computeJournalHash(journalEntry);

      await journalEntry.update({
        flags: {
          [MODULE_ID]: {
            [FLAGS.RESOURCE_ID]: resourceId,
            [FLAGS.RESOURCE_NAME]: finalRemote.name,
            [FLAGS.PATH_NAME]: journalEntry.name,
            [FLAGS.PARENT_ID]: finalRemote.parentId || null,
            [FLAGS.LK_UPDATED_AT]: finalRemote.updatedAt || new Date().toISOString(),
            [FLAGS.LAST_SYNCED_AT]: Date.now(),
            [FLAGS.CONTENT_HASH]: finalHash
          }
        }
      });

      return finalRemote;
    } finally {
      this.isSyncingInternal = false;
    }
  }

  /**
   * Pushes modified pages from the single master JournalEntry ("📖 LegendKeeper Wiki") to LegendKeeper.
   */
  async #pushMasterJournalResources(lk, masterJournal, localIndex, converterContext, targetResourceId = null) {
    const conflictPolicy = this.getSetting(SETTINGS.CONFLICT_POLICY, "ask");
    const resourceIdsToPush = [];

    if (targetResourceId && localIndex.pagesByResourceId.has(targetResourceId)) {
      resourceIdsToPush.push(targetResourceId);
    } else {
      for (const [resId, pages] of localIndex.pagesByResourceId.entries()) {
        const hasLocalEdit = pages.some((p) => hasPageChangedLocally(p));
        if (hasLocalEdit) resourceIdsToPush.push(resId);
      }
    }

    let lastRemote = null;
    for (const resourceId of resourceIdsToPush) {
      const pages = localIndex.pagesByResourceId.get(resourceId) || [];
      if (pages.length === 0) continue;

      const remoteResource = await lk.resources.get({ resourceId });
      const remoteDocs = [...(remoteResource.documents || [])].sort((a, b) =>
        (a.rank ?? "") < (b.rank ?? "") ? -1 : 1
      );
      const remoteDocsById = new Map(remoteDocs.map((d) => [d.id, d]));

      for (const page of pages) {
        if (page.type !== "text") continue;
        const pageContent = page.text?.content || "";
        const storedPageHash = page.getFlag(MODULE_ID, FLAGS.PAGE_HASH);
        const currentPageHash = computePageHash(page);
        const localChanged = Boolean(!storedPageHash || currentPageHash !== storedPageHash);

        const parser = new DOMParser();
        const parsedDom = parser.parseFromString(pageContent, "text/html");
        const tabSectionEls = Array.from(parsedDom.querySelectorAll(".lk-doc-tab-section[data-lk-doc-id]"));

        if (tabSectionEls.length > 0) {
          const storedTabMeta = page.getFlag(MODULE_ID, FLAGS.TAB_DOCS_META) || [];
          const metaByDocId = new Map(
            Array.isArray(storedTabMeta) ? storedTabMeta.map((m) => [m.documentId, { ...m }]) : []
          );
          let anyPushed = false;

          for (const secEl of tabSectionEls) {
            const tabDocId = secEl.getAttribute("data-lk-doc-id");
            const tabDocType = secEl.getAttribute("data-lk-doc-type") || "page";
            if (!tabDocId || (tabDocType !== "page" && tabDocType !== "blank")) continue;

            const remoteDoc = remoteDocsById.get(tabDocId);
            if (!remoteDoc) continue;

            const remoteDocBlocks = await lk.documents.getBlocks({ resourceId, documentId: tabDocId });
            const tabMeta = metaByDocId.get(tabDocId) || { documentId: tabDocId, type: tabDocType };
            const storedVersion = tabMeta.version;
            const remoteChanged = Boolean(storedVersion && remoteDocBlocks.version !== storedVersion);

            if (!localChanged && !remoteChanged) continue;

            if (localChanged && remoteChanged) {
              let decision = "keep-foundry";
              if (conflictPolicy === "skip") {
                decision = "cancel";
              } else if (conflictPolicy === "preferLK") {
                decision = "keep-lk";
              } else {
                decision = await promptPageConflictResolution({
                  resourceName: remoteResource.name,
                  pageName: remoteDoc.name || "Tab",
                  remoteText: remoteDocBlocks.text || "",
                  localHtml: secEl.innerHTML || "",
                  operation: "push"
                });
              }
              if (decision === "cancel" || decision === "keep-lk") continue;
            }

            const blocks = await htmlToBlocks(secEl.innerHTML || "", {
              ...converterContext,
              preservedBlocks: tabMeta.preservedBlocks || []
            });

            const written = await lk.documents.replaceBlocks(
              { resourceId, documentId: tabDocId },
              { blocks, ifMatch: remoteDocBlocks.version }
            );
            tabMeta.version = written.version;
            metaByDocId.set(tabDocId, tabMeta);
            anyPushed = true;
          }

          if (anyPushed) {
            const updatedTabMeta = Array.from(metaByDocId.values());
            await page.update({
              flags: {
                [MODULE_ID]: {
                  [FLAGS.TAB_DOCS_META]: updatedTabMeta,
                  [FLAGS.VERSION]: updatedTabMeta[0]?.version || page.getFlag(MODULE_ID, FLAGS.VERSION),
                  [FLAGS.PAGE_HASH]: computePageHash(page),
                  [FLAGS.HASH_VERSION]: CURRENT_HASH_VERSION
                }
              }
            });
          }
          continue;
        }

        const docTypeFlag = page.getFlag(MODULE_ID, FLAGS.DOCUMENT_TYPE);
        if (docTypeFlag && docTypeFlag !== "page" && docTypeFlag !== "blank") continue;

        const docId = page.getFlag(MODULE_ID, FLAGS.DOCUMENT_ID);
        const remoteDoc = docId ? remoteDocsById.get(docId) : null;
        if (!remoteDoc) continue;

        const remoteDocBlocks = await lk.documents.getBlocks({ resourceId, documentId: docId });
        const storedVersion = page.getFlag(MODULE_ID, FLAGS.VERSION);
        const remoteChanged = Boolean(storedVersion && remoteDocBlocks.version !== storedVersion);

        if (!localChanged && !remoteChanged) continue;

        if (!localChanged && remoteChanged) {
          await this.#applyRemoteBlocksToLocalPage(page, resourceId, remoteDoc, remoteDocBlocks, converterContext);
          continue;
        }

        if (localChanged && remoteChanged) {
          let decision = "keep-foundry";
          if (conflictPolicy === "skip") {
            decision = "cancel";
          } else if (conflictPolicy === "preferLK") {
            decision = "keep-lk";
          } else {
            decision = await promptPageConflictResolution({
              resourceName: remoteResource.name,
              pageName: remoteDoc.name || page.name || "Main",
              remoteText: remoteDocBlocks.text || "",
              localHtml: page.text?.content || "",
              operation: "push"
            });
          }

          if (decision === "cancel") continue;
          if (decision === "keep-lk") {
            await this.#applyRemoteBlocksToLocalPage(page, resourceId, remoteDoc, remoteDocBlocks, converterContext);
            continue;
          }
        }

        const preservedBlocks = page.getFlag(MODULE_ID, FLAGS.PRESERVED_BLOCKS) || [];
        const blocks = await htmlToBlocks(page.text?.content || "", {
          ...converterContext,
          preservedBlocks
        });

        const written = await lk.documents.replaceBlocks(
          { resourceId, documentId: docId },
          { blocks, ifMatch: remoteDocBlocks.version }
        );

        await page.update({
          flags: {
            [MODULE_ID]: {
              [FLAGS.VERSION]: written.version,
              [FLAGS.PAGE_HASH]: computePageHash(page),
              [FLAGS.HASH_VERSION]: CURRENT_HASH_VERSION
            }
          }
        });
      }

      const finalRemote = await lk.resources.get({ resourceId });
      for (const page of pages) {
        await page.setFlag(MODULE_ID, FLAGS.LK_UPDATED_AT, finalRemote.updatedAt || new Date().toISOString());
        await page.setFlag(MODULE_ID, FLAGS.LAST_SYNCED_AT, Date.now());
      }
      lastRemote = finalRemote;
    }

    return lastRemote;
  }

  async #applyRemoteBlocksToLocalPage(page, resourceId, remoteDoc, remoteDocBlocks, converterContext) {
    const strippedBlocks = [];
    const bodyHtml = blocksToHtml(remoteDocBlocks.blocks || [], {
      ...converterContext,
      currentResourceId: resourceId,
      strippedBlocks
    });
    const pageName = page.getFlag(MODULE_ID, FLAGS.IS_PRIMARY_DOC)
      ? page.name
      : remoteDoc.name || page.name || "Main";
    const newPageHash = computeContentHash(`${pageName}|${stripGeneratedHtml(bodyHtml)}`);

    await page.update({
      name: pageName,
      text: { content: bodyHtml, format: 1 },
      flags: {
        [MODULE_ID]: {
          [FLAGS.RESOURCE_ID]: resourceId,
          [FLAGS.DOCUMENT_ID]: remoteDoc.id,
          [FLAGS.DOCUMENT_TYPE]: "page",
          [FLAGS.VERSION]: remoteDocBlocks.version,
          [FLAGS.PAGE_HASH]: newPageHash,
          [FLAGS.PRESERVED_BLOCKS]: strippedBlocks
        }
      }
    });
  }

  /**
   * Pushes multiple Foundry JournalEntries to LegendKeeper.
   * Pulls any remote-newer entries first if they have no local edits, and prompts on conflicts.
   */
  async pushAll({ includeUnlinked = false, onProgress } = {}) {
    const overview = await this.getSyncOverview();
    const conflictPolicy = this.getSetting(SETTINGS.CONFLICT_POLICY, "ask");

    const targets = overview.items.filter((item) => {
      if (!item.journalId) return false;
      if (item.status === "local-newer") return true;
      if (item.status === "local-only" && includeUnlinked) return true;
      if (item.status === "conflict" && conflictPolicy !== "skip") return true;
      return false;
    });

    let created = 0;
    let updated = 0;
    let skipped = 0;
    const total = targets.length;

    for (let i = 0; i < targets.length; i++) {
      const item = targets[i];
      const entry = game.journal?.get?.(item.journalId);
      if (!entry) {
        skipped++;
        continue;
      }

      onProgress?.({
        phase: `Syncing "${item.name || entry.name}" (${i + 1}/${total})`,
        current: i + 1,
        total
      });

      const isMaster = Boolean(entry.getFlag(MODULE_ID, FLAGS.IS_MASTER_JOURNAL));
      const wasUnlinked = !isMaster && !entry.getFlag(MODULE_ID, FLAGS.RESOURCE_ID);
      await this.pushJournal(entry, { resourceId: item.resourceId || null });
      if (wasUnlinked) created++;
      else updated++;
    }

    return { created, updated, skipped, total };
  }

  /**
   * Unlinks a Foundry JournalEntry (or a resource's pages inside the master journal) from LegendKeeper.
   */
  async unlinkJournal(journalEntry, { resourceId = null } = {}) {
    if (!journalEntry) return;
    this.isSyncingInternal = true;
    try {
      if (journalEntry.getFlag(MODULE_ID, FLAGS.IS_MASTER_JOURNAL) && resourceId) {
        for (const page of journalEntry.pages ?? []) {
          if (page.getFlag(MODULE_ID, FLAGS.RESOURCE_ID) === resourceId) {
            await page.unsetFlag(MODULE_ID, FLAGS.RESOURCE_ID);
            await page.unsetFlag(MODULE_ID, FLAGS.DOCUMENT_ID);
            await page.unsetFlag(MODULE_ID, FLAGS.VERSION);
            await page.unsetFlag(MODULE_ID, FLAGS.PAGE_HASH);
          }
        }
        return;
      }
      await journalEntry.unsetFlag(MODULE_ID, FLAGS.RESOURCE_ID);
      await journalEntry.unsetFlag(MODULE_ID, FLAGS.LK_UPDATED_AT);
      await journalEntry.unsetFlag(MODULE_ID, FLAGS.LAST_SYNCED_AT);
      await journalEntry.unsetFlag(MODULE_ID, FLAGS.CONTENT_HASH);
      for (const page of journalEntry.pages ?? []) {
        await page.unsetFlag(MODULE_ID, FLAGS.RESOURCE_ID);
        await page.unsetFlag(MODULE_ID, FLAGS.DOCUMENT_ID);
        await page.unsetFlag(MODULE_ID, FLAGS.VERSION);
        await page.unsetFlag(MODULE_ID, FLAGS.PAGE_HASH);
      }
    } finally {
      this.isSyncingInternal = false;
    }
  }
}

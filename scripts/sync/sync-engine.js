import { MODULE_ID, SETTINGS, FLAGS, DEFAULT_BASE_URL } from "../constants.js";
import {
  LegendKeeper,
  NotFoundError,
  VersionMismatchError
} from "../sdk/client.js";
import {
  blocksToHtml,
  renderResourceDecorationHtml,
  renderMapDocumentHtml,
  renderTimelineDocumentHtml
} from "../converter/blocks-to-html.js";
import { htmlToBlocks, isLkAssetUrl } from "../converter/html-to-blocks.js";

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
 * Computes a combined content hash for a Foundry JournalEntry and all its pages.
 */
export function computeJournalHash(journalEntry) {
  if (!journalEntry) return "";
  const pages = Array.from(journalEntry.pages ?? []).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
  const pageSignatures = pages.map((p) => {
    const docId = p.getFlag(MODULE_ID, FLAGS.DOCUMENT_ID) || "";
    const body = stripGeneratedHtml(p.text?.content || "");
    return `${docId}:${p.name}:${body}`;
  });
  const folderResourceId = journalEntry.folder?.getFlag?.(MODULE_ID, FLAGS.RESOURCE_ID) || "";
  return computeContentHash(`${journalEntry.name}|${folderResourceId}|${pageSignatures.join("||")}`);
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
    const unlinkedJournals = [];

    for (const entry of game.journal ?? []) {
      const resId = entry.getFlag(MODULE_ID, FLAGS.RESOURCE_ID);
      if (resId) {
        byResourceId.set(resId, entry);
        for (const page of entry.pages ?? []) {
          const docId = page.getFlag(MODULE_ID, FLAGS.DOCUMENT_ID);
          if (docId) {
            byDocumentId.set(docId, { entry, page });
          }
        }
      } else {
        unlinkedJournals.push(entry);
      }
    }

    return { byResourceId, byDocumentId, unlinkedJournals };
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
          name: label || page.name || entry.name
        };
      }
      if (resourceId && idx.byResourceId.has(resourceId)) {
        const entry = idx.byResourceId.get(resourceId);
        return {
          uuid: `JournalEntry.${entry.id}`,
          name: label || entry.name
        };
      }
      const remote = resourceId ? remoteById.get(resourceId) : null;
      return remote ? { uuid: null, name: label || remote.name } : null;
    };

    const resolveUuidToLk = (uuid) => {
      if (!uuid || typeof uuid !== "string") return null;
      // Format: JournalEntry.<entryId> or JournalEntry.<entryId>.JournalEntryPage.<pageId>
      const m = /^JournalEntry\.([^.]+)(?:\.JournalEntryPage\.([^.]+))?/.exec(uuid.trim());
      if (!m) return null;
      const entryId = m[1];
      const pageId = m[2];
      const entry = game.journal?.get?.(entryId);
      if (!entry) return null;
      const resourceId = entry.getFlag(MODULE_ID, FLAGS.RESOURCE_ID);
      if (!resourceId) return null;
      if (pageId) {
        const page = entry.pages?.get?.(pageId);
        const documentId = page?.getFlag?.(MODULE_ID, FLAGS.DOCUMENT_ID);
        if (documentId) {
          return { resourceId, documentId, name: page.name };
        }
      }
      return { resourceId, name: entry.name };
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
    const { byResourceId, unlinkedJournals } = this.buildLocalIndex();
    const remoteById = new Map(remoteResources.map((r) => [r.id, r]));

    const items = [];

    // 1. All remote resources (and their linked Foundry JournalEntries if present)
    for (const res of remoteResources) {
      const localEntry = byResourceId.get(res.id);
      const parentName = res.parentId && remoteById.has(res.parentId) ? remoteById.get(res.parentId).name : "";

      if (!localEntry) {
        items.push({
          id: res.id,
          resourceId: res.id,
          journalId: null,
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

      const storedLkUpdatedAt = localEntry.getFlag(MODULE_ID, FLAGS.LK_UPDATED_AT);
      const storedHash = localEntry.getFlag(MODULE_ID, FLAGS.CONTENT_HASH);
      const currentHash = computeJournalHash(localEntry);

      const remoteChanged = Boolean(res.updatedAt && storedLkUpdatedAt && res.updatedAt !== storedLkUpdatedAt);
      const localChanged = Boolean(storedHash && currentHash !== storedHash);

      let status = "in-sync";
      if (remoteChanged && localChanged) status = "conflict";
      else if (remoteChanged) status = "remote-newer";
      else if (localChanged) status = "local-newer";

      items.push({
        id: res.id,
        resourceId: res.id,
        journalId: localEntry.id,
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
    }

    // 2. Local journals that are either unlinked OR linked to a deleted remote resource
    for (const [resId, entry] of byResourceId.entries()) {
      if (!remoteById.has(resId)) {
        items.push({
          id: entry.id,
          resourceId: resId,
          journalId: entry.id,
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
   * Ensures Foundry JournalEntry Folders exist for the root sync folder (if configured)
   * and for every LegendKeeper resource that has child resources, respecting Foundry's max folder depth.
   */
  async ensureFolderHierarchy(remoteResources = []) {
    const maxDepth = globalThis.CONST?.FOLDER_MAX_DEPTH ?? 4;
    const rootFolderName = (this.getSetting(SETTINGS.ROOT_FOLDER_NAME, "LegendKeeper") || "").trim();

    const journalFolders = () => (game.folders ?? []).filter((f) => f.type === "JournalEntry");

    let rootFolder = null;
    if (rootFolderName) {
      rootFolder = journalFolders().find(
        (f) => !f.folder && (f.getFlag(MODULE_ID, FLAGS.IS_ROOT_FOLDER) || f.name === rootFolderName)
      );
      if (!rootFolder) {
        rootFolder = await Folder.create({
          name: rootFolderName,
          type: "JournalEntry",
          sorting: "m",
          flags: {
            [MODULE_ID]: {
              [FLAGS.IS_ROOT_FOLDER]: true
            }
          }
        });
      }
    }

    // Identify all resource IDs that act as parents to at least one other resource
    const parentResourceIds = new Set();
    const remoteById = new Map();
    for (const res of remoteResources) {
      remoteById.set(res.id, res);
      if (res.parentId && res.parentId !== "templates") {
        parentResourceIds.add(res.parentId);
      }
    }

    const folderByResourceId = new Map();
    for (const f of journalFolders()) {
      const rId = f.getFlag(MODULE_ID, FLAGS.RESOURCE_ID);
      if (rId) folderByResourceId.set(rId, f);
    }

    const getFolderDepth = (folder) => {
      let depth = 0;
      let cur = folder;
      while (cur) {
        depth++;
        cur = cur.folder;
      }
      return depth;
    };

    const ensureFolderForResource = async (resId, visiting = new Set()) => {
      if (!resId || !remoteById.has(resId)) return rootFolder;
      if (folderByResourceId.has(resId)) return folderByResourceId.get(resId);
      if (visiting.has(resId)) return rootFolder;
      visiting.add(resId);

      const res = remoteById.get(resId);
      let parentFolder = rootFolder;
      if (res.parentId && remoteById.has(res.parentId)) {
        parentFolder = await ensureFolderForResource(res.parentId, visiting);
      }

      // Check Foundry folder depth limit
      const parentDepth = getFolderDepth(parentFolder);
      if (parentDepth >= maxDepth) {
        // Cannot nest further in Foundry; reuse deepest allowed ancestor folder
        folderByResourceId.set(resId, parentFolder);
        return parentFolder;
      }

      let folder = journalFolders().find(
        (f) => f.getFlag(MODULE_ID, FLAGS.RESOURCE_ID) === res.id
      );
      if (!folder) {
        const folderData = {
          name: res.name.slice(0, 100),
          type: "JournalEntry",
          folder: parentFolder?.id || null,
          sorting: "m",
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
      } else if (folder.name !== res.name || (folder.folder?.id || null) !== (parentFolder?.id || null)) {
        await folder.update({
          name: res.name.slice(0, 100),
          folder: parentFolder?.id || null
        });
      }

      folderByResourceId.set(res.id, folder);
      return folder;
    };

    for (const parentId of parentResourceIds) {
      await ensureFolderForResource(parentId);
    }

    return {
      rootFolder,
      folderByResourceId,
      getTargetFolderForResource: (res) => {
        if (res.parentId && folderByResourceId.has(res.parentId)) {
          return folderByResourceId.get(res.parentId);
        }
        return rootFolder;
      }
    };
  }

  /**
   * Pulls all resources from LegendKeeper into Foundry VTT using a 2-pass strategy
   * so all cross-resource `@UUID` mentions resolve cleanly.
   */
  async pullAll({ onProgress } = {}) {
    const lk = this.getClient();
    const conflictPolicy = this.getSetting(SETTINGS.CONFLICT_POLICY, "preferLK");

    this.isSyncingInternal = true;
    let created = 0;
    let updated = 0;
    let skipped = 0;

    try {
      onProgress?.({ phase: "Listing LegendKeeper resources...", current: 0, total: 1 });
      const remoteList = await this.fetchAllRemoteResources();
      const total = remoteList.length;

      // Build parent -> children map in tree rank order
      const childrenByParentId = new Map();
      const sortedResources = [...remoteList].sort((a, b) => ((a.rank ?? "") < (b.rank ?? "") ? -1 : 1));
      for (const r of sortedResources) {
        if (r.parentId) {
          const list = childrenByParentId.get(r.parentId) ?? [];
          list.push(r.id);
          childrenByParentId.set(r.parentId, list);
        }
      }

      // Pass 1: Ensure Folders and shell JournalEntries exist for all resources
      const folderHelper = await this.ensureFolderHierarchy(sortedResources);
      const localIndex = this.buildLocalIndex();

      for (let i = 0; i < sortedResources.length; i++) {
        const item = sortedResources[i];
        if (!localIndex.byResourceId.has(item.id)) {
          const targetFolder = folderHelper.getTargetFolderForResource(item);
          const ownership = this.#computeJournalOwnership(item.isHidden);
          const entry = await JournalEntry.create({
            name: item.name,
            folder: targetFolder?.id || null,
            ...(ownership ? { ownership } : {}),
            flags: {
              [MODULE_ID]: {
                [FLAGS.RESOURCE_ID]: item.id,
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

        if (!wasJustCreated) {
          const storedHash = entry.getFlag(MODULE_ID, FLAGS.CONTENT_HASH);
          const currentHash = computeJournalHash(entry);
          const storedLkUpdatedAt = entry.getFlag(MODULE_ID, FLAGS.LK_UPDATED_AT);
          const remoteChanged = Boolean(listItem.updatedAt && listItem.updatedAt !== storedLkUpdatedAt);
          const localChanged = Boolean(storedHash && currentHash !== storedHash);

          if (!remoteChanged && !localChanged && entry.pages?.size > 0) {
            skipped++;
            continue;
          }

          if (localChanged && remoteChanged && conflictPolicy === "skip") {
            skipped++;
            continue;
          }
        }

        await this.#pullSingleResourceIntoEntry(lk, listItem.id, entry, {
          remoteResources: sortedResources,
          localIndex,
          folderHelper,
          childResourceIds: childrenByParentId.get(listItem.id) || []
        });

        if (!wasJustCreated) updated++;
      }

      await game.settings.set(MODULE_ID, SETTINGS.LAST_FULL_SYNC, new Date().toISOString());
      return { created, updated, skipped, total };
    } finally {
      this.isSyncingInternal = false;
    }
  }

  /**
   * Pulls a single resource by its LegendKeeper resourceId into Foundry VTT.
   */
  async pullResource(resourceId) {
    const lk = this.getClient();
    this.isSyncingInternal = true;
    try {
      const remoteResources = await this.fetchAllRemoteResources();
      const folderHelper = await this.ensureFolderHierarchy(remoteResources);
      const localIndex = this.buildLocalIndex();

      const childResourceIds = remoteResources
        .filter((r) => r.parentId === resourceId)
        .sort((a, b) => ((a.rank ?? "") < (b.rank ?? "") ? -1 : 1))
        .map((r) => r.id);

      let entry = localIndex.byResourceId.get(resourceId);
      if (!entry) {
        const fullRes = await lk.resources.get({ resourceId });
        const targetFolder = folderHelper.getTargetFolderForResource(fullRes);
        const ownership = this.#computeJournalOwnership(fullRes.isHidden);
        entry = await JournalEntry.create({
          name: fullRes.name,
          folder: targetFolder?.id || null,
          ...(ownership ? { ownership } : {}),
          flags: {
            [MODULE_ID]: {
              [FLAGS.RESOURCE_ID]: fullRes.id,
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

      return entry;
    } finally {
      this.isSyncingInternal = false;
    }
  }

  #computeJournalOwnership(isHidden) {
    const hiddenHandling = this.getSetting(SETTINGS.HIDDEN_RESOURCE_HANDLING, "gmOnly");
    if (isHidden && hiddenHandling === "gmOnly") {
      const noneLevel = globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS?.NONE ?? 0;
      return { default: noneLevel };
    }
    return null;
  }

  async #pullSingleResourceIntoEntry(lk, resourceId, entry, { remoteResources, localIndex, folderHelper, childResourceIds }) {
    const resource = await lk.resources.get({ resourceId });
    const targetFolder = folderHelper.getTargetFolderForResource(resource);
    const hiddenHandling = this.getSetting(SETTINGS.HIDDEN_RESOURCE_HANDLING, "gmOnly");
    const includeSidebarProperties = this.getSetting(SETTINGS.INCLUDE_SIDEBAR_PROPERTIES, true);
    const includeNavigationLinks = this.getSetting(SETTINGS.INCLUDE_NAVIGATION_LINKS, true);
    const secretHandling = this.getSetting(SETTINGS.SECRET_HANDLING, "secretBlock");

    const converterContext = this.createConverterContext(remoteResources, localIndex);

    // Sort documents by rank
    const docs = [...(resource.documents || [])]
      .filter((d) => !(hiddenHandling === "skip" && d.isHidden))
      .sort((a, b) => ((a.rank ?? "") < (b.rank ?? "") ? -1 : 1));

    const { headerHtml, footerHtml } = renderResourceDecorationHtml(resource, {
      includeSidebarProperties,
      includeNavigationLinks,
      secretHandling,
      resolveMention: converterContext.resolveMention,
      evaluateCollectionFilter: converterContext.evaluateCollectionFilter,
      childResourceIds
    });

    const existingPagesByDocId = new Map();
    for (const p of entry.pages ?? []) {
      const dId = p.getFlag(MODULE_ID, FLAGS.DOCUMENT_ID);
      if (dId) existingPagesByDocId.set(dId, p);
    }

    const pagesToCreate = [];
    const pagesToUpdate = [];

    for (let idx = 0; idx < docs.length; idx++) {
      const doc = docs[idx];
      const isPrimaryPage = idx === 0;
      const sortValue = (idx + 1) * 10000;

      let pageHtml = "";
      let blockVersion = null;
      const strippedBlocks = [];

      if (doc.type === "page" || doc.type === "blank") {
        const docBlocks = await lk.documents.getBlocks({
          resourceId: resource.id,
          documentId: doc.id
        });
        blockVersion = docBlocks.version;
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

      const pageFlags = {
        [FLAGS.RESOURCE_ID]: resource.id,
        [FLAGS.DOCUMENT_ID]: doc.id,
        [FLAGS.DOCUMENT_TYPE]: doc.type,
        [FLAGS.VERSION]: blockVersion,
        [FLAGS.IS_HIDDEN]: Boolean(doc.isHidden),
        [FLAGS.PRESERVED_BLOCKS]: strippedBlocks
      };

      const pageOwnership = this.#computeJournalOwnership(doc.isHidden);
      const existingPage = existingPagesByDocId.get(doc.id);

      if (existingPage) {
        pagesToUpdate.push({
          _id: existingPage.id,
          name: doc.name || "Main",
          type: "text",
          sort: sortValue,
          text: { content: pageHtml, format: 1 },
          ...(pageOwnership ? { ownership: pageOwnership } : {}),
          flags: { [MODULE_ID]: pageFlags }
        });
      } else {
        pagesToCreate.push({
          name: doc.name || "Main",
          type: "text",
          sort: sortValue,
          text: { content: pageHtml, format: 1 },
          ...(pageOwnership ? { ownership: pageOwnership } : {}),
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

    // Update JournalEntry metadata & flags
    const entryOwnership = this.#computeJournalOwnership(resource.isHidden);
    const updatedHash = computeJournalHash(entry);

    await entry.update({
      name: resource.name,
      folder: targetFolder?.id || null,
      ...(entryOwnership ? { ownership: entryOwnership } : {}),
      flags: {
        [MODULE_ID]: {
          [FLAGS.RESOURCE_ID]: resource.id,
          [FLAGS.PARENT_ID]: resource.parentId || null,
          [FLAGS.LK_UPDATED_AT]: resource.updatedAt || new Date().toISOString(),
          [FLAGS.LAST_SYNCED_AT]: Date.now(),
          [FLAGS.CONTENT_HASH]: updatedHash,
          [FLAGS.TAGS]: resource.tags || [],
          [FLAGS.ALIASES]: resource.aliases || [],
          [FLAGS.ICON_GLYPH]: resource.iconGlyph || null,
          [FLAGS.ICON_COLOR]: resource.iconColor || null,
          [FLAGS.ICON_SHAPE]: resource.iconShape || null,
          [FLAGS.ICON_SIZE]: resource.iconSize || null,
          [FLAGS.IS_HIDDEN]: Boolean(resource.isHidden),
          [FLAGS.IS_LOCKED]: Boolean(resource.isLocked),
          [FLAGS.BANNER]: resource.banner || null,
          [FLAGS.PROPERTIES]: resource.properties || []
        }
      }
    });

    // Recompute hash after name/folder update to ensure exact match
    const finalHash = computeJournalHash(entry);
    if (finalHash !== updatedHash) {
      await entry.setFlag(MODULE_ID, FLAGS.CONTENT_HASH, finalHash);
    }
  }

  /**
   * Pushes a single Foundry JournalEntry (and all its text JournalEntryPages) to LegendKeeper.
   */
  async pushJournal(journalEntry) {
    if (!journalEntry) throw new Error("No JournalEntry provided to push.");
    const lk = this.getClient();
    this.isSyncingInternal = true;

    try {
      const localIndex = this.buildLocalIndex();
      const converterContext = this.createConverterContext([], localIndex);

      let resourceId = journalEntry.getFlag(MODULE_ID, FLAGS.RESOURCE_ID);
      const folderResourceId = journalEntry.folder?.getFlag?.(MODULE_ID, FLAGS.RESOURCE_ID) || null;
      const isRootFolder = Boolean(journalEntry.folder?.getFlag?.(MODULE_ID, FLAGS.IS_ROOT_FOLDER));
      const storedParentId = journalEntry.getFlag(MODULE_ID, FLAGS.PARENT_ID) || null;

      // Determine target parentId in LegendKeeper
      let targetParentId = storedParentId;
      if (journalEntry.folder) {
        if (isRootFolder) {
          targetParentId = null;
        } else if (folderResourceId && folderResourceId !== resourceId) {
          targetParentId = folderResourceId;
        }
      } else {
        targetParentId = null;
      }

      const tags = journalEntry.getFlag(MODULE_ID, FLAGS.TAGS) || [];
      const aliases = journalEntry.getFlag(MODULE_ID, FLAGS.ALIASES) || [];

      let remoteResource = null;
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

      // Create resource if not yet in LegendKeeper
      if (!resourceId) {
        const createPayload = {
          name: journalEntry.name
        };
        if (targetParentId) createPayload.parentId = targetParentId;
        if (Array.isArray(tags) && tags.length > 0) createPayload.tags = tags;
        if (Array.isArray(aliases) && aliases.length > 0) createPayload.aliases = aliases;

        remoteResource = await lk.resources.create(createPayload);
        resourceId = remoteResource.id;
        localIndex.byResourceId.set(resourceId, journalEntry);
      } else {
        // Update resource name/tags/aliases if changed
        const patch = {};
        if (remoteResource.name !== journalEntry.name) patch.name = journalEntry.name;
        if (Object.keys(patch).length > 0) {
          remoteResource = await lk.resources.update({ resourceId }, patch);
        }

        // Move resource if parentId changed
        const currentRemoteParent = remoteResource.parentId || null;
        if (currentRemoteParent !== (targetParentId || null)) {
          remoteResource = await lk.resources.move(
            { resourceId },
            { parentId: targetParentId || null }
          );
        }
      }

      // Sync JournalEntryPages -> LegendKeeper Documents
      const remoteDocs = [...(remoteResource.documents || [])].sort((a, b) =>
        (a.rank ?? "") < (b.rank ?? "") ? -1 : 1
      );
      const remoteDocsById = new Map(remoteDocs.map((d) => [d.id, d]));
      const usedRemoteDocIds = new Set();

      const sortedPages = Array.from(journalEntry.pages ?? []).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));

      // If the Foundry JournalEntry has 0 pages, ensure the initial LK blank document is left intact
      for (let i = 0; i < sortedPages.length; i++) {
        const page = sortedPages[i];
        if (page.type !== "text") continue;

        const docTypeFlag = page.getFlag(MODULE_ID, FLAGS.DOCUMENT_TYPE);
        if (docTypeFlag && docTypeFlag !== "page" && docTypeFlag !== "blank") {
          // Do not overwrite map/timeline/board documents with text blocks
          continue;
        }

        let docId = page.getFlag(MODULE_ID, FLAGS.DOCUMENT_ID);
        let remoteDoc = docId ? remoteDocsById.get(docId) : null;

        // Pair with the initial blank/first document on a newly created resource
        if (!remoteDoc && i === 0 && remoteDocs.length > 0 && !usedRemoteDocIds.has(remoteDocs[0].id)) {
          const candidate = remoteDocs[0];
          if (candidate.type === "blank" || candidate.type === "page") {
            remoteDoc = candidate;
            docId = candidate.id;
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
        } else if (remoteDoc.name !== page.name && page.name) {
          remoteDoc = await lk.documents.update(
            { resourceId, documentId: docId },
            { name: page.name.slice(0, 500) }
          );
        }

        usedRemoteDocIds.add(docId);

        const preservedBlocks = page.getFlag(MODULE_ID, FLAGS.PRESERVED_BLOCKS) || [];
        const blocks = await htmlToBlocks(page.text?.content || "", {
          ...converterContext,
          preservedBlocks
        });

        const storedVersion = page.getFlag(MODULE_ID, FLAGS.VERSION) || undefined;
        let written;
        try {
          written = await lk.documents.replaceBlocks(
            { resourceId, documentId: docId },
            {
              blocks,
              ...(storedVersion ? { ifMatch: storedVersion } : {})
            }
          );
        } catch (err) {
          if (err instanceof VersionMismatchError) {
            // Fetch fresh version and apply replaceBlocks
            const fresh = await lk.documents.getBlocks({ resourceId, documentId: docId });
            written = await lk.documents.replaceBlocks(
              { resourceId, documentId: docId },
              {
                blocks,
                ifMatch: fresh.version
              }
            );
          } else {
            throw err;
          }
        }

        await page.update({
          flags: {
            [MODULE_ID]: {
              [FLAGS.RESOURCE_ID]: resourceId,
              [FLAGS.DOCUMENT_ID]: docId,
              [FLAGS.DOCUMENT_TYPE]: "page",
              [FLAGS.VERSION]: written.version
            }
          }
        });
      }

      // Fetch updated resource from LK so we record the latest updatedAt timestamp
      const finalRemote = await lk.resources.get({ resourceId });
      const finalHash = computeJournalHash(journalEntry);

      await journalEntry.update({
        flags: {
          [MODULE_ID]: {
            [FLAGS.RESOURCE_ID]: resourceId,
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
   * Pushes multiple Foundry JournalEntries to LegendKeeper.
   *
   * @param {Object} options
   * @param {boolean} options.includeUnlinked - Whether to also push local-only unlinked journals
   * @param {Function} options.onProgress - Progress callback
   */
  async pushAll({ includeUnlinked = false, onProgress } = {}) {
    const overview = await this.getSyncOverview();
    const conflictPolicy = this.getSetting(SETTINGS.CONFLICT_POLICY, "preferLK");

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
        phase: `Pushing "${entry.name}" (${i + 1}/${total})`,
        current: i + 1,
        total
      });

      const wasUnlinked = !entry.getFlag(MODULE_ID, FLAGS.RESOURCE_ID);
      await this.pushJournal(entry);
      if (wasUnlinked) created++;
      else updated++;
    }

    return { created, updated, skipped, total };
  }

  /**
   * Unlinks a Foundry JournalEntry from LegendKeeper without deleting either side.
   */
  async unlinkJournal(journalEntry) {
    if (!journalEntry) return;
    this.isSyncingInternal = true;
    try {
      await journalEntry.unsetFlag(MODULE_ID, FLAGS.RESOURCE_ID);
      await journalEntry.unsetFlag(MODULE_ID, FLAGS.LK_UPDATED_AT);
      await journalEntry.unsetFlag(MODULE_ID, FLAGS.LAST_SYNCED_AT);
      await journalEntry.unsetFlag(MODULE_ID, FLAGS.CONTENT_HASH);
      for (const page of journalEntry.pages ?? []) {
        await page.unsetFlag(MODULE_ID, FLAGS.RESOURCE_ID);
        await page.unsetFlag(MODULE_ID, FLAGS.DOCUMENT_ID);
        await page.unsetFlag(MODULE_ID, FLAGS.VERSION);
      }
    } finally {
      this.isSyncingInternal = false;
    }
  }
}

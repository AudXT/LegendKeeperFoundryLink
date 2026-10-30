import { MODULE_ID, MODULE_VERSION } from "../constants.js?v=1.2.10";

const BaseApp = globalThis.foundry?.applications?.api?.ApplicationV2
  ? globalThis.foundry.applications.api.HandlebarsApplicationMixin(
      globalThis.foundry.applications.api.ApplicationV2
    )
  : class FallbackApp {};

export class LegendKeeperSyncManagerApp extends BaseApp {
  static DEFAULT_OPTIONS = {
    id: "legendkeeper-sync-manager",
    tag: "div",
    classes: ["legendkeeper-sync-window"],
    window: {
      title: "LK_SYNC.Title",
      icon: "fas fa-book-atlas",
      resizable: true
    },
    position: {
      width: 900,
      height: 660
    }
  };

  static PARTS = {
    main: {
      template: `modules/${MODULE_ID}/templates/sync-manager.hbs`
    }
  };

  constructor(syncEngine, options = {}) {
    super(options);
    this.syncEngine = syncEngine;
    this.connection = { ok: false, project: null, error: null };
    this.overview = {
      items: [],
      counts: {
        total: 0,
        inSync: 0,
        remoteOnly: 0,
        remoteNewer: 0,
        localOnly: 0,
        localNewer: 0,
        conflict: 0
      }
    };
    this.searchQuery = "";
    this.statusFilter = "all";
    this.isLoading = false;
    this.isBusy = false;
    this.progress = { active: false, phase: "", current: 0, total: 1, percent: 0 };
    this._initialized = false;
  }

  async _prepareContext(_options) {
    if (!this._initialized && !this.isLoading) {
      this._initialized = true;
      // Trigger initial load asynchronously so window opens immediately
      queueMicrotask(() => this.refreshData());
    }

    const q = (this.searchQuery || "").trim().toLowerCase();
    const filteredItems = (this.overview.items || []).filter((item) => {
      if (this.statusFilter === "needs-action") {
        if (item.status === "in-sync") return false;
      } else if (this.statusFilter !== "all" && item.status !== this.statusFilter) {
        return false;
      }
      if (!q) return true;
      const inName = item.name?.toLowerCase().includes(q);
      const inParent = item.parentName?.toLowerCase().includes(q);
      const inTags = Array.isArray(item.tags) && item.tags.some((t) => t.toLowerCase().includes(q));
      return inName || inParent || inTags;
    });

    return {
      moduleVersion: MODULE_VERSION,
      connection: this.connection,
      counts: this.overview.counts,
      filteredItems,
      searchQuery: this.searchQuery,
      statusFilter: this.statusFilter,
      isLoading: this.isLoading,
      isBusy: this.isBusy || this.isLoading,
      progress: this.progress
    };
  }

  _onRender(_context, _options) {
    const root = this.element;
    if (!root) return;

    // Search input
    const searchInput = root.querySelector(".lk-search-input");
    if (searchInput) {
      searchInput.addEventListener("input", (ev) => {
        this.searchQuery = ev.target.value;
        this.render();
      });
      // Keep focus at end of search input if user was typing
      if (document.activeElement === searchInput || this._focusSearch) {
        this._focusSearch = false;
        searchInput.focus();
        const len = searchInput.value.length;
        searchInput.setSelectionRange(len, len);
      }
    }

    const searchInputFocusTracker = root.querySelector(".lk-search-input");
    searchInputFocusTracker?.addEventListener("keydown", () => {
      this._focusSearch = true;
    });

    // Status select
    const statusSelect = root.querySelector(".lk-status-select");
    if (statusSelect) {
      statusSelect.addEventListener("change", (ev) => {
        this.statusFilter = ev.target.value;
        this.render();
      });
    }

    // Action buttons & cards
    for (const el of root.querySelectorAll("[data-action]")) {
      el.addEventListener("click", (ev) => this.#handleActionClick(ev, el));
    }
  }

  async #handleActionClick(ev, el) {
    ev.preventDefault();
    const action = el.dataset.action;

    switch (action) {
      case "test-connection":
        await this.testConnection(true);
        break;

      case "refresh":
        await this.refreshData();
        break;

      case "open-settings":
        game.settings?.sheet?.render?.(true);
        break;

      case "filter-status":
        this.statusFilter = el.dataset.status || "all";
        this.render();
        break;

      case "pull-all":
        await this.handlePullAll();
        break;

      case "push-linked":
        await this.handlePushAll(false);
        break;

      case "push-all":
        await this.handlePushAll(true);
        break;

      case "pull-single": {
        const resourceId = el.dataset.resourceId;
        const name = el.dataset.name || resourceId;
        if (resourceId) await this.handlePullSingle(resourceId, name);
        break;
      }

      case "push-single": {
        const journalId = el.dataset.journalId;
        const resourceId = el.dataset.resourceId || null;
        const name = el.dataset.name || journalId;
        if (journalId) await this.handlePushSingle(journalId, name, resourceId);
        break;
      }

      case "open-journal": {
        const journalId = el.dataset.journalId;
        const pageId = el.dataset.pageId || undefined;
        const entry = game.journal?.get?.(journalId);
        if (entry) {
          entry.sheet?.render?.(true, pageId ? { pageId } : {});
        }
        break;
      }

      case "unlink-journal": {
        const journalId = el.dataset.journalId;
        const resourceId = el.dataset.resourceId || null;
        const name = el.dataset.name || "";
        const entry = game.journal?.get?.(journalId);
        if (entry) {
          await this.syncEngine.unlinkJournal(entry, { resourceId });
          ui.notifications?.info(game.i18n.format("LK_SYNC.Notifications.Unlinked", { name }));
          await this.refreshData();
        }
        break;
      }
    }
  }

  async testConnection(notify = false) {
    this.isLoading = true;
    this.render();
    try {
      this.connection = await this.syncEngine.testConnection();
      if (notify) {
        if (this.connection.ok) {
          ui.notifications?.info(
            game.i18n.format("LK_SYNC.Notifications.Connected", {
              name: this.connection.project.name,
              id: this.connection.project.id
            })
          );
        } else {
          ui.notifications?.error(`LegendKeeper Sync: ${this.connection.error}`);
        }
      }
    } finally {
      this.isLoading = false;
      this.render();
    }
  }

  async refreshData() {
    this.isLoading = true;
    this.render();
    try {
      this.connection = await this.syncEngine.testConnection();
      if (this.connection.ok) {
        this.overview = await this.syncEngine.getSyncOverview();
      } else {
        const localIndex = this.syncEngine.buildLocalIndex();
        const localOnlyItems = [
          ...Array.from(localIndex.byResourceId.values()),
          ...localIndex.unlinkedJournals
        ].map((entry) => ({
          id: entry.id,
          resourceId: entry.getFlag(MODULE_ID, "resourceId") || null,
          journalId: entry.id,
          name: entry.name,
          parentName: entry.folder?.name || "",
          tags: entry.getFlag(MODULE_ID, "tags") || [],
          documentCount: entry.pages?.size || 0,
          status: "local-only",
          statusLabel: game.i18n.localize("LK_SYNC.Status.local-only")
        }));
        this.overview = {
          items: localOnlyItems,
          counts: {
            total: localOnlyItems.length,
            inSync: 0,
            remoteOnly: 0,
            remoteNewer: 0,
            localOnly: localOnlyItems.length,
            localNewer: 0,
            conflict: 0
          }
        };
      }
    } catch (err) {
      ui.notifications?.error(`LegendKeeper Sync: ${err.message || err}`);
    } finally {
      this.isLoading = false;
      this.render();
    }
  }

  #setProgress(phase, current, total) {
    const safeTotal = Math.max(1, Number(total) || 1);
    const percent = Math.min(100, Math.round((Number(current) / safeTotal) * 100));
    this.progress = { active: true, phase, current, total: safeTotal, percent };
    this.render();
  }

  async handlePullAll() {
    this.isBusy = true;
    this.#setProgress("Starting pull from LegendKeeper...", 0, 1);
    try {
      const result = await this.syncEngine.pullAll({
        onProgress: ({ phase, current, total }) => this.#setProgress(phase, current, total)
      });
      ui.notifications?.info(
        game.i18n.format("LK_SYNC.Notifications.PullComplete", {
          created: result.created,
          updated: result.updated,
          skipped: result.skipped
        })
      );
    } catch (err) {
      console.error("LegendKeeper Sync | Pull All error:", err);
      ui.notifications?.error(`LegendKeeper Pull failed: ${err.message || err}`);
    } finally {
      this.isBusy = false;
      this.progress = { active: false, phase: "", current: 0, total: 1, percent: 0 };
      await this.refreshData();
    }
  }

  async handlePushAll(includeUnlinked = false) {
    this.isBusy = true;
    this.#setProgress("Starting push to LegendKeeper...", 0, 1);
    try {
      const result = await this.syncEngine.pushAll({
        includeUnlinked,
        onProgress: ({ phase, current, total }) => this.#setProgress(phase, current, total)
      });
      ui.notifications?.info(
        game.i18n.format("LK_SYNC.Notifications.PushComplete", {
          created: result.created,
          updated: result.updated,
          skipped: result.skipped
        })
      );
    } catch (err) {
      console.error("LegendKeeper Sync | Push All error:", err);
      ui.notifications?.error(`LegendKeeper Push failed: ${err.message || err}`);
    } finally {
      this.isBusy = false;
      this.progress = { active: false, phase: "", current: 0, total: 1, percent: 0 };
      await this.refreshData();
    }
  }

  async handlePullSingle(resourceId, name) {
    this.isBusy = true;
    this.#setProgress(`Pulling "${name}"...`, 1, 2);
    try {
      await this.syncEngine.pullResource(resourceId);
      ui.notifications?.info(game.i18n.format("LK_SYNC.Notifications.SinglePullSuccess", { name }));
    } catch (err) {
      console.error("LegendKeeper Sync | Pull Single error:", err);
      ui.notifications?.error(`Failed to pull "${name}": ${err.message || err}`);
    } finally {
      this.isBusy = false;
      this.progress = { active: false, phase: "", current: 0, total: 1, percent: 0 };
      await this.refreshData();
    }
  }

  async handlePushSingle(journalId, name, resourceId = null) {
    const entry = game.journal?.get?.(journalId);
    if (!entry) return;
    this.isBusy = true;
    this.#setProgress(`Pushing "${name}"...`, 1, 2);
    try {
      await this.syncEngine.pushJournal(entry, { resourceId });
      ui.notifications?.info(game.i18n.format("LK_SYNC.Notifications.SinglePushSuccess", { name }));
    } catch (err) {
      console.error("LegendKeeper Sync | Push Single error:", err);
      ui.notifications?.error(`Failed to push "${name}": ${err.message || err}`);
    } finally {
      this.isBusy = false;
      this.progress = { active: false, phase: "", current: 0, total: 1, percent: 0 };
      await this.refreshData();
    }
  }
}

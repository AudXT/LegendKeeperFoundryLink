import { MODULE_ID, MODULE_VERSION, SETTINGS, FLAGS, DEFAULT_BASE_URL } from "./constants.js?v=1.2.7";
import { LegendKeeperSyncEngine } from "./sync/sync-engine.js?v=1.2.7";
import { LegendKeeperSyncManagerApp } from "./ui/sync-manager-app.js?v=1.2.7";

console.log(`LegendKeeper Sync | Loaded v${MODULE_VERSION}`);

let syncEngine = null;
let syncManagerApp = null;
const autoSyncTimers = new Map();
const collapsedFoldersByJournalId = new Map();

/**
 * Opens or focuses the LegendKeeper Sync Manager window.
 */
export function openSyncManager() {
  if (!game.user?.isGM) {
    ui.notifications?.warn("Only a Game Master can use LegendKeeper Sync.");
    return null;
  }
  if (!syncEngine) {
    syncEngine = new LegendKeeperSyncEngine();
  }
  if (!syncManagerApp) {
    syncManagerApp = new LegendKeeperSyncManagerApp(syncEngine);
  }
  syncManagerApp.render({ force: true });
  return syncManagerApp;
}

/**
 * Registers all Foundry VTT module settings.
 */
function registerSettings() {
  // Menu launcher in Module Settings
  game.settings.registerMenu(MODULE_ID, "syncManagerMenu", {
    name: "LK_SYNC.Title",
    label: "LK_SYNC.Buttons.OpenSyncManager",
    hint: "Open the LegendKeeper two-way Journal Sync Manager to pull, push, and resolve conflicts between LegendKeeper and Foundry VTT.",
    icon: "fas fa-book-atlas",
    type: class SyncMenuLauncher extends FormApplication {
      render() {
        openSyncManager();
        return this;
      }
      async _updateObject() {}
    },
    restricted: true
  });

  game.settings.register(MODULE_ID, SETTINGS.API_KEY, {
    name: "LK_SYNC.Settings.ApiKey.Name",
    hint: "LK_SYNC.Settings.ApiKey.Hint",
    scope: "world",
    config: true,
    restricted: true,
    type: String,
    default: ""
  });

  game.settings.register(MODULE_ID, SETTINGS.BASE_URL, {
    name: "LK_SYNC.Settings.BaseUrl.Name",
    hint: "LK_SYNC.Settings.BaseUrl.Hint",
    scope: "world",
    config: true,
    restricted: true,
    type: String,
    default: DEFAULT_BASE_URL
  });

  game.settings.register(MODULE_ID, SETTINGS.PROJECT_ID, {
    name: "LK_SYNC.Settings.ProjectId.Name",
    hint: "LK_SYNC.Settings.ProjectId.Hint",
    scope: "world",
    config: true,
    restricted: true,
    type: String,
    default: ""
  });

  game.settings.register(MODULE_ID, SETTINGS.ROOT_FOLDER_NAME, {
    name: "LK_SYNC.Settings.RootFolderName.Name",
    hint: "LK_SYNC.Settings.RootFolderName.Hint",
    scope: "world",
    config: true,
    restricted: true,
    type: String,
    default: "LegendKeeper"
  });

  game.settings.register(MODULE_ID, SETTINGS.FOLDER_MODE, {
    name: "LK_SYNC.Settings.FolderMode.Name",
    hint: "LK_SYNC.Settings.FolderMode.Hint",
    scope: "world",
    config: true,
    restricted: true,
    type: String,
    choices: {
      singleFolder: "LK_SYNC.Settings.FolderMode.Choices.singleFolder",
      nestedFolders: "LK_SYNC.Settings.FolderMode.Choices.nestedFolders",
      singleJournal: "LK_SYNC.Settings.FolderMode.Choices.singleJournal"
    },
    default: "singleFolder"
  });

  game.settings.register(MODULE_ID, SETTINGS.SECRET_HANDLING, {
    name: "LK_SYNC.Settings.SecretHandling.Name",
    hint: "LK_SYNC.Settings.SecretHandling.Hint",
    scope: "world",
    config: true,
    restricted: true,
    type: String,
    choices: {
      secretBlock: "LK_SYNC.Settings.SecretHandling.Choices.secretBlock",
      strip: "LK_SYNC.Settings.SecretHandling.Choices.strip",
      normal: "LK_SYNC.Settings.SecretHandling.Choices.normal"
    },
    default: "secretBlock"
  });

  game.settings.register(MODULE_ID, SETTINGS.HIDDEN_RESOURCE_HANDLING, {
    name: "LK_SYNC.Settings.HiddenResourceHandling.Name",
    hint: "LK_SYNC.Settings.HiddenResourceHandling.Hint",
    scope: "world",
    config: true,
    restricted: true,
    type: String,
    choices: {
      gmOnly: "LK_SYNC.Settings.HiddenResourceHandling.Choices.gmOnly",
      skip: "LK_SYNC.Settings.HiddenResourceHandling.Choices.skip",
      default: "LK_SYNC.Settings.HiddenResourceHandling.Choices.default"
    },
    default: "gmOnly"
  });

  game.settings.register(MODULE_ID, SETTINGS.CONFLICT_POLICY, {
    name: "LK_SYNC.Settings.ConflictPolicy.Name",
    hint: "LK_SYNC.Settings.ConflictPolicy.Hint",
    scope: "world",
    config: true,
    restricted: true,
    type: String,
    choices: {
      ask: "LK_SYNC.Settings.ConflictPolicy.Choices.ask",
      preferLK: "LK_SYNC.Settings.ConflictPolicy.Choices.preferLK",
      skip: "LK_SYNC.Settings.ConflictPolicy.Choices.skip"
    },
    default: "ask"
  });

  game.settings.register(MODULE_ID, SETTINGS.INCLUDE_SIDEBAR_PROPERTIES, {
    name: "LK_SYNC.Settings.IncludeSidebarProperties.Name",
    hint: "LK_SYNC.Settings.IncludeSidebarProperties.Hint",
    scope: "world",
    config: true,
    restricted: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, SETTINGS.INCLUDE_NAVIGATION_LINKS, {
    name: "LK_SYNC.Settings.IncludeNavigationLinks.Name",
    hint: "LK_SYNC.Settings.IncludeNavigationLinks.Hint",
    scope: "world",
    config: true,
    restricted: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, SETTINGS.UPLOAD_LOCAL_IMAGES, {
    name: "LK_SYNC.Settings.UploadLocalImages.Name",
    hint: "LK_SYNC.Settings.UploadLocalImages.Hint",
    scope: "world",
    config: true,
    restricted: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, SETTINGS.AUTO_SYNC_ON_SAVE, {
    name: "LK_SYNC.Settings.AutoSyncOnSave.Name",
    hint: "LK_SYNC.Settings.AutoSyncOnSave.Hint",
    scope: "world",
    config: true,
    restricted: true,
    type: Boolean,
    default: false
  });

  game.settings.register(MODULE_ID, SETTINGS.LAST_FULL_SYNC, {
    scope: "world",
    config: false,
    type: String,
    default: ""
  });
}

/**
 * Schedules a debounced auto-push for a linked JournalEntry when autoSyncOnSave is enabled.
 */
function scheduleAutoPush(journalEntry) {
  if (!game.user?.isGM) return;
  if (!syncEngine || syncEngine.isSyncingInternal) return;
  if (!syncEngine.getSetting(SETTINGS.AUTO_SYNC_ON_SAVE, false)) return;

  const resourceId = journalEntry?.getFlag?.(MODULE_ID, FLAGS.RESOURCE_ID);
  const isMaster = journalEntry?.getFlag?.(MODULE_ID, FLAGS.IS_MASTER_JOURNAL);
  if (!resourceId && !isMaster) return;

  const existingTimer = autoSyncTimers.get(journalEntry.id);
  if (existingTimer) clearTimeout(existingTimer);

  const timer = setTimeout(async () => {
    autoSyncTimers.delete(journalEntry.id);
    if (syncEngine.isSyncingInternal) return;
    try {
      await syncEngine.pushJournal(journalEntry);
      ui.notifications?.info(
        game.i18n.format("LK_SYNC.Notifications.SinglePushSuccess", { name: journalEntry.name })
      );
    } catch (err) {
      console.error("LegendKeeper Sync | Auto-push failed:", err);
      ui.notifications?.error(`LegendKeeper auto-push failed for "${journalEntry.name}": ${err.message || err}`);
    }
  }, 1500);

  autoSyncTimers.set(journalEntry.id, timer);
}

/* -------------------------------------------- */
/*  Foundry Lifecycle Hooks                     */
/* -------------------------------------------- */

Hooks.once("init", () => {
  console.log(`${MODULE_ID} | Initializing LegendKeeper Journal Sync`);
  registerSettings();
  syncEngine = new LegendKeeperSyncEngine();

  const moduleData = game.modules.get(MODULE_ID);
  if (moduleData) {
    moduleData.api = {
      syncEngine,
      openSyncManager,
      pullAll: (opts) => syncEngine.pullAll(opts),
      pullResource: (resourceId) => syncEngine.pullResource(resourceId),
      pushJournal: (entry) => syncEngine.pushJournal(entry),
      pushAll: (opts) => syncEngine.pushAll(opts),
      getSyncOverview: () => syncEngine.getSyncOverview()
    };
  }
});

Hooks.once("ready", () => {
  // Mask the API key input in the Settings Configuration sheet as a password field
  Hooks.on("renderSettingsConfig", (_app, html) => {
    const root = html instanceof HTMLElement ? html : html?.[0];
    if (!root) return;
    const apiKeyInput = root.querySelector(`input[name="${MODULE_ID}.${SETTINGS.API_KEY}"]`);
    if (apiKeyInput) {
      apiKeyInput.type = "password";
      apiKeyInput.autocomplete = "off";
    }
  });
});

// Add "LegendKeeper Sync" button to the Journal Directory sidebar (supports both v12 and v13)
Hooks.on("renderJournalDirectory", (_app, html) => {
  if (!game.user?.isGM) return;
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root) return;
  if (root.querySelector(".lk-directory-sync-btn")) return;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "lk-directory-sync-btn";
  btn.title = "Open the LegendKeeper two-way Journal Sync Manager";
  btn.innerHTML = `<i class="fas fa-book-atlas"></i> ${game.i18n.localize("LK_SYNC.Buttons.OpenSyncManager")}`;
  btn.addEventListener("click", (ev) => {
    ev.preventDefault();
    openSyncManager();
  });

  const headerActions =
    root.querySelector(".directory-header .header-actions") ||
    root.querySelector(".directory-header");
  if (headerActions) {
    headerActions.appendChild(btn);
  }
});

// Add Pull / Push header buttons to JournalEntry sheets (ApplicationV1 in v12/v13)
Hooks.on("getJournalSheetHeaderButtons", (sheet, buttons) => {
  if (!game.user?.isGM) return;
  const entry = sheet.document || sheet.object;
  if (!entry || entry.getFlag(MODULE_ID, FLAGS.IS_INDEX_JOURNAL)) return;

  buttons.unshift({
    label: "LK Push",
    class: "lk-sheet-push",
    icon: "fas fa-cloud-upload-alt",
    onclick: async () => {
      try {
        ui.notifications?.info(`Checking LegendKeeper & pushing "${entry.name}"...`);
        await syncEngine.pushJournal(entry);
        ui.notifications?.info(
          game.i18n.format("LK_SYNC.Notifications.SinglePushSuccess", { name: entry.name })
        );
      } catch (err) {
        ui.notifications?.error(`LegendKeeper Push failed: ${err.message || err}`);
      }
    }
  });

  const resourceId = entry.getFlag(MODULE_ID, FLAGS.RESOURCE_ID);
  if (resourceId) {
    buttons.unshift({
      label: "LK Pull",
      class: "lk-sheet-pull",
      icon: "fas fa-cloud-download-alt",
      onclick: async () => {
        try {
          ui.notifications?.info(`Pulling "${entry.name}" from LegendKeeper...`);
          await syncEngine.pullResource(resourceId);
          ui.notifications?.info(
            game.i18n.format("LK_SYNC.Notifications.SinglePullSuccess", { name: entry.name })
          );
        } catch (err) {
          ui.notifications?.error(`LegendKeeper Pull failed: ${err.message || err}`);
        }
      }
    });
  }
});

// Add Pull / Push header controls for ApplicationV2 JournalEntry sheets in Foundry v13
Hooks.on("getHeaderControlsApplicationV2", (app, controls) => {
  if (!game.user?.isGM) return;
  const doc = app.document;
  if (!doc || doc.documentName !== "JournalEntry" || doc.getFlag(MODULE_ID, FLAGS.IS_INDEX_JOURNAL)) return;

  controls.push({
    icon: "fas fa-cloud-upload-alt",
    label: "LK_SYNC.Buttons.PushToLK",
    action: "lkPushJournal",
    onClick: async () => {
      try {
        ui.notifications?.info(`Pushing "${doc.name}" to LegendKeeper...`);
        await syncEngine.pushJournal(doc);
        ui.notifications?.info(
          game.i18n.format("LK_SYNC.Notifications.SinglePushSuccess", { name: doc.name })
        );
      } catch (err) {
        ui.notifications?.error(`LegendKeeper Push failed: ${err.message || err}`);
      }
    }
  });

  const resourceId = doc.getFlag(MODULE_ID, FLAGS.RESOURCE_ID);
  if (resourceId) {
    controls.push({
      icon: "fas fa-cloud-download-alt",
      label: "LK_SYNC.Buttons.PullFromLK",
      action: "lkPullJournal",
      onClick: async () => {
        try {
          ui.notifications?.info(`Pulling "${doc.name}" from LegendKeeper...`);
          await syncEngine.pullResource(resourceId);
          ui.notifications?.info(
            game.i18n.format("LK_SYNC.Notifications.SinglePullSuccess", { name: doc.name })
          );
        } catch (err) {
          ui.notifications?.error(`LegendKeeper Pull failed: ${err.message || err}`);
        }
      }
    });
  }
});

// Auto-Sync hooks when a linked JournalEntry or JournalEntryPage is modified locally
Hooks.on("updateJournalEntry", (document, _change, _options, userId) => {
  if (userId !== game.user?.id) return;
  scheduleAutoPush(document);
});

Hooks.on("updateJournalEntryPage", (pageDocument, _change, _options, userId) => {
  if (userId !== game.user?.id) return;
  if (pageDocument.parent?.documentName === "JournalEntry") {
    scheduleAutoPush(pageDocument.parent);
  }
});

/* -------------------------------------------- */
/*  Single-Journal Hierarchy & Link Enhancers   */
/* -------------------------------------------- */

const LK_WIKI_PREFIX_REGEX = /^\s*(?:📖\s*)?LegendKeeper\s+Wiki(?:\s+Index)?\s*(?:\/|:|-|—|›)\s*/i;

/**
 * Strips any redundant "📖 LegendKeeper Wiki / " or "LegendKeeper Wiki/" prefix that Foundry or
 * third-party modules prepend onto JournalEntryPage content links inside synced journals.
 */
function stripRedundantWikiLinkPrefixes(rootElement) {
  if (!rootElement || typeof rootElement.querySelectorAll !== "function") return;
  const links = rootElement.querySelectorAll("a.content-link, a.lk-content-link");
  for (const a of links) {
    const cleanAttr = a.getAttribute("data-lk-clean-label");
    for (const node of Array.from(a.childNodes)) {
      if (node.nodeType === 3) {
        const val = node.nodeValue || "";
        if (LK_WIKI_PREFIX_REGEX.test(val)) {
          const stripped = val.replace(LK_WIKI_PREFIX_REGEX, "");
          node.nodeValue = stripped || cleanAttr || val;
        }
      }
    }
  }
}

/**
 * Enhances the left-hand page directory sidebar of the Single Master Journal ("📖 LegendKeeper Wiki")
 * with true multi-level tree indentation (beyond Foundry's native 3-level cap), folder/leaf icons,
 * and collapsible folder toggles.
 */
function enhanceMasterJournalSidebar(sheetRoot, journalEntry) {
  if (!sheetRoot || !journalEntry?.getFlag?.(MODULE_ID, FLAGS.IS_MASTER_JOURNAL)) return;

  const parentByResId = new Map();
  const childrenCountByResId = new Map();
  const resNameById = new Map();

  for (const p of journalEntry.pages ?? []) {
    if (p.getFlag(MODULE_ID, FLAGS.IS_INDEX_PAGE)) continue;
    const rId = p.getFlag(MODULE_ID, FLAGS.RESOURCE_ID);
    const pId = p.getFlag(MODULE_ID, FLAGS.PARENT_ID);
    const rName = p.getFlag(MODULE_ID, FLAGS.RESOURCE_NAME) || p.name;
    if (rId && !resNameById.has(rId)) resNameById.set(rId, rName);
    if (rId && pId && pId !== "templates" && !parentByResId.has(rId)) {
      parentByResId.set(rId, pId);
      childrenCountByResId.set(pId, (childrenCountByResId.get(pId) || 0) + 1);
    }
  }

  const metaByPageId = new Map();
  for (const p of journalEntry.pages ?? []) {
    if (p.getFlag(MODULE_ID, FLAGS.IS_INDEX_PAGE)) {
      metaByPageId.set(p.id, {
        depth: 0,
        hasChildren: false,
        isIndex: true,
        isPrimary: true,
        ancestorIds: [],
        pathStr: "",
        resourceId: null
      });
      continue;
    }

    const rId = p.getFlag(MODULE_ID, FLAGS.RESOURCE_ID);
    const isPrimary = p.getFlag(MODULE_ID, FLAGS.IS_PRIMARY_DOC) !== false;
    const ancestorIds = [];
    let cur = rId ? parentByResId.get(rId) : null;
    const seen = new Set();
    while (cur && !seen.has(cur) && resNameById.has(cur)) {
      seen.add(cur);
      ancestorIds.unshift(cur);
      cur = parentByResId.get(cur);
    }

    const storedDepth = p.getFlag(MODULE_ID, FLAGS.TREE_DEPTH);
    const computedDepth = ancestorIds.length + (isPrimary ? 0 : 1);
    const depth = Number.isFinite(storedDepth) ? storedDepth : computedDepth;
    const storedHasChildren = p.getFlag(MODULE_ID, FLAGS.HAS_CHILDREN);
    const hasChildren = Boolean(
      isPrimary && (storedHasChildren ?? (rId && (childrenCountByResId.get(rId) || 0) > 0))
    );
    const pathStr = ancestorIds.map((id) => resNameById.get(id)).filter(Boolean).join(" › ");

    metaByPageId.set(p.id, {
      depth,
      hasChildren,
      isIndex: false,
      isPrimary,
      ancestorIds,
      pathStr,
      resourceId: rId
    });
  }

  if (!collapsedFoldersByJournalId.has(journalEntry.id)) {
    collapsedFoldersByJournalId.set(journalEntry.id, new Set());
  }
  const collapsedSet = collapsedFoldersByJournalId.get(journalEntry.id);

  const applySidebarStyles = () => {
    const sidebarContainer =
      sheetRoot.querySelector(".journal-sidebar, aside.sidebar") || sheetRoot;
    const pageItems = sidebarContainer.querySelectorAll("li[data-page-id], .directory-item[data-page-id], .toc-item[data-page-id]");

    for (const itemEl of pageItems) {
      const pageId = itemEl.getAttribute("data-page-id");
      const meta = pageId ? metaByPageId.get(pageId) : null;
      if (!meta) continue;

      itemEl.classList.add("lk-master-toc-item");
      itemEl.setAttribute("data-lk-depth", String(meta.depth));
      itemEl.setAttribute("data-lk-has-children", meta.hasChildren ? "true" : "false");
      itemEl.classList.toggle("lk-toc-folder", meta.hasChildren);
      itemEl.classList.toggle("lk-toc-index", meta.isIndex);

      const indentPx = meta.isIndex ? 6 : 6 + meta.depth * 14;
      itemEl.style.setProperty("--lk-depth", String(meta.depth));
      itemEl.style.setProperty("padding-left", `${indentPx}px`, "important");

      const headingEl = itemEl.querySelector(".page-heading");
      if (headingEl) {
        headingEl.style.setProperty("padding-left", "0px", "important");
        headingEl.style.setProperty("margin-left", "0px", "important");
      }

      if (meta.pathStr) {
        const pageDoc = journalEntry.pages.get(pageId);
        itemEl.setAttribute("title", `${meta.pathStr} › ${pageDoc?.name || ""}`);
      }

      const isHiddenByCollapse = meta.ancestorIds.some((ancId) => collapsedSet.has(ancId));
      itemEl.classList.toggle("lk-toc-hidden-by-collapse", isHiddenByCollapse);

      const titleEl = itemEl.querySelector(".page-title") || headingEl;
      if (titleEl && !meta.isIndex) {
        let prefixEl = itemEl.querySelector(".lk-toc-prefix");
        if (!prefixEl) {
          prefixEl = document.createElement("span");
          prefixEl.className = "lk-toc-prefix";
          titleEl.parentNode?.insertBefore(prefixEl, titleEl);
        }

        if (meta.hasChildren && meta.resourceId) {
          const isCollapsed = collapsedSet.has(meta.resourceId);
          const desiredState = isCollapsed ? "collapsed" : "expanded";
          if (prefixEl.getAttribute("data-lk-state") !== desiredState) {
            prefixEl.setAttribute("data-lk-state", desiredState);
            prefixEl.innerHTML = `<span class="lk-toc-caret" title="Collapse / Expand Folder">${isCollapsed ? "▸" : "▾"}</span><i class="fas ${isCollapsed ? "fa-folder" : "fa-folder-open"} lk-toc-folder-icon"></i>`;
          }
          if (!prefixEl.dataset.lkBound) {
            prefixEl.dataset.lkBound = "true";
            prefixEl.addEventListener("click", (ev) => {
              ev.preventDefault();
              ev.stopPropagation();
              if (collapsedSet.has(meta.resourceId)) {
                collapsedSet.delete(meta.resourceId);
              } else {
                collapsedSet.add(meta.resourceId);
              }
              applySidebarStyles();
            });
          }
        } else if (!prefixEl.getAttribute("data-lk-state")) {
          prefixEl.setAttribute("data-lk-state", "leaf");
          const branchConnector = meta.depth > 0 ? `<span class="lk-toc-leaf-marker">└</span>` : "";
          prefixEl.innerHTML = `${branchConnector}<i class="fas fa-file-lines lk-toc-leaf-icon"></i>`;
        }
      }
    }
  };

  applySidebarStyles();

  const listEl = sheetRoot.querySelector(
    ".journal-sidebar .directory-list, .journal-sidebar .toc, aside.sidebar .directory-list, aside.sidebar .toc"
  );
  if (listEl && !listEl._lkHierarchyObserver) {
    const observer = new MutationObserver((mutations) => {
      const needsRefresh = mutations.some((m) =>
        Array.from(m.addedNodes).some(
          (n) => n.nodeType === 1 && (n.hasAttribute?.("data-page-id") || n.querySelector?.("[data-page-id]"))
        )
      );
      if (needsRefresh) {
        applySidebarStyles();
      }
    });
    observer.observe(listEl, { childList: true, subtree: true });
    listEl._lkHierarchyObserver = observer;
  }
}

function handleSyncedJournalRender(app, html) {
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root) return;

  const doc = app?.document || app?.object;
  const journalEntry =
    doc?.documentName === "JournalEntry"
      ? doc
      : doc?.parent?.documentName === "JournalEntry"
        ? doc.parent
        : null;

  const isLkJournal = Boolean(
    journalEntry &&
      (journalEntry.getFlag(MODULE_ID, FLAGS.IS_MASTER_JOURNAL) ||
        journalEntry.getFlag(MODULE_ID, FLAGS.IS_INDEX_JOURNAL) ||
        journalEntry.getFlag(MODULE_ID, FLAGS.RESOURCE_ID))
  );
  if (!isLkJournal) return;

  const sheetRoot = root.closest?.(".app, .application, .journal-sheet, .journal-entry") || root;

  const runEnhancements = () => {
    stripRedundantWikiLinkPrefixes(sheetRoot);
    if (journalEntry.getFlag(MODULE_ID, FLAGS.IS_MASTER_JOURNAL)) {
      enhanceMasterJournalSidebar(sheetRoot, journalEntry);
    }
  };

  runEnhancements();
  requestAnimationFrame(runEnhancements);
  setTimeout(runEnhancements, 60);
}

Hooks.on("renderJournalSheet", handleSyncedJournalRender);
Hooks.on("renderJournalPageSheet", handleSyncedJournalRender);
Hooks.on("renderJournalTextPageSheet", handleSyncedJournalRender);
Hooks.on("renderApplicationV2", handleSyncedJournalRender);

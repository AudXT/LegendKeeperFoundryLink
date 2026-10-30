import { MODULE_ID, MODULE_VERSION, SETTINGS, FLAGS, DEFAULT_BASE_URL } from "./constants.js?v=1.2.5";
import { LegendKeeperSyncEngine } from "./sync/sync-engine.js?v=1.2.5";
import { LegendKeeperSyncManagerApp } from "./ui/sync-manager-app.js?v=1.2.5";

console.log(`LegendKeeper Sync | Loaded v${MODULE_VERSION}`);

let syncEngine = null;
let syncManagerApp = null;
const autoSyncTimers = new Map();

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

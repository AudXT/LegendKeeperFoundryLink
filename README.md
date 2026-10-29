# LegendKeeper Journal Sync for Foundry VTT

A Foundry VTT (v12 / v13) module that provides **two-way synchronization** between your **LegendKeeper** worldbuilding project and **Foundry VTT Journal Entries** using the official **LegendKeeper v3 REST API**.

---

## Features

- **Two-Way Sync (Pull & Push)**:
  - **Pull from LegendKeeper → Foundry VTT**: Imports LegendKeeper Resources as Foundry `JournalEntry` documents, their Document tabs (`Main`, sub-pages, maps, timelines) as `JournalEntryPage`s, and organizes hierarchy into Foundry `Folder`s.
  - **Push from Foundry VTT → LegendKeeper**: Creates or updates LegendKeeper Resources and Document tabs from your Foundry `JournalEntry` and `JournalEntryPage` content, including folder-based parent hierarchy and optimistic concurrency (`If-Match` block versioning).
- **Rich Block & HTML Conversion**:
  - Converts LegendKeeper headings, paragraphs, inline formatting (`bold`, `italic`, `underline`, `strike`, `code`, `sub`, `sup`, links), bullet/numbered lists, task checklists, tables, callouts (`info`, `note`, `success`, `warning`, `error`, `custom`), collapsible `expand` sections (`<details>`), multi-column layouts, key-value blocks, meters, infoboxes, and sidebar properties.
  - **Cross-Document Mentions**: Converts LegendKeeper `mention` runs and `resourceLink`/`resourceCollection` blocks into native clickable Foundry `@UUID[JournalEntry...]` links on pull, and converts Foundry `@UUID[JournalEntry...]` links back into native LegendKeeper `mention` runs on push.
- **Secret & Hidden Resource Support**:
  - Converts LegendKeeper `secret` blocks into Foundry `<section class="secret">` blocks (GM-only with a reveal/hide toggle) or strips them on pull (while preserving them in LegendKeeper when pushing back).
  - Imports hidden LegendKeeper resources and document tabs as GM-only (`Observer: None`) or skips them based on your settings.
- **Interactive Sync Manager UI**:
  - Accessible from the **Journal Directory** sidebar (**LegendKeeper Sync** button) or **Module Settings**.
  - Displays live sync statuses (`In Sync`, `In LK Only`, `LK Newer`, `Foundry Only`, `Foundry Newer`, `Conflict`) with search, status filters, bulk Pull/Push actions, and per-entry Pull/Push/Open/Unlink controls.
  - Quick **LK Pull** and **LK Push** buttons in the header of every open Journal Entry sheet.

---

## Installation

### Option 1: Install via Manifest URL in Foundry VTT
1. In Foundry VTT's **Add-on Modules** tab, click **Install Module**.
2. Paste the following **Manifest URL** at the bottom of the window and click **Install**:
   ```text
   https://raw.githubusercontent.com/AudXT/LegendKeeperFoundryLink/main/module.json
   ```
3. Launch your World and enable **LegendKeeper Journal Sync** under **Manage Modules**.

### Option 2: Manual / Symlink Installation
1. Copy or symlink this repository into your Foundry VTT `Data/modules/legendkeeper-foundry-sync` directory:
   ```bash
   ln -s /Users/ischall/repos/LegendKeeperFoundryLink "<FoundryData>/Data/modules/legendkeeper-foundry-sync"
   ```
2. Launch Foundry VTT, open your World, and enable **LegendKeeper Journal Sync** under **Manage Modules**.

---

## Setup & Configuration

1. **Generate a LegendKeeper API Key**:
   - In LegendKeeper, open your project and navigate to **Project Settings → Developers → API Keys**.
   - Create an API key with the **Admin** role (recommended so the key can create/update top-level resources and read hidden content) and copy the `lk_...` secret.
2. **Configure Foundry Module Settings**:
   - In Foundry VTT, go to **Game Settings → Configure Settings → LegendKeeper Journal Sync**.
   - Paste your `lk_...` key into **LegendKeeper API Key**.
3. **Browser CORS / Optional Local Proxy**:
   - LegendKeeper's v3 API is designed for server-side requests and may block direct browser requests due to CORS headers.
   - If clicking **Test Connection** reports a CORS / network error, run the included zero-dependency proxy script:
     ```bash
     node tools/lk-cors-proxy.mjs
     ```
   - Then set **API Base URL / CORS Proxy** in Module Settings to `http://localhost:8787`.

---

## Scripting / Macro API

The module exposes its API at `game.modules.get("legendkeeper-foundry-sync").api`:

```js
const lkApi = game.modules.get("legendkeeper-foundry-sync").api;

// Open the Sync Manager UI
lkApi.openSyncManager();

// Pull all resources from LegendKeeper
await lkApi.pullAll();

// Pull a specific LegendKeeper resource by ID
await lkApi.pullResource("r0123456789abcdefghijklm");

// Push a specific Foundry JournalEntry to LegendKeeper
const entry = game.journal.getName("Candy Kingdom");
await lkApi.pushJournal(entry);
```

import { escapeHtml } from "../converter/blocks-to-html.js";

/**
 * Extracts readable plain text from Foundry HTML for conflict comparison preview.
 */
function htmlToPlainTextPreview(html) {
  if (!html) return "(Empty)";
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    for (const el of doc.querySelectorAll("[data-lk-generated='true']")) {
      el.remove();
    }
    const text = (doc.body.textContent ?? "").replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    return text || "(Empty)";
  } catch {
    return String(html).trim() || "(Empty)";
  }
}

/**
 * Displays an interactive modal dialog when both LegendKeeper and Foundry VTT
 * have modified the same page, allowing the GM to pick which version to keep
 * or abandon the sync.
 *
 * @param {Object} params
 * @param {string} params.resourceName - Name of the Resource / JournalEntry
 * @param {string} params.pageName - Name of the Document tab / JournalEntryPage
 * @param {string} params.remoteText - Plain text from LegendKeeper
 * @param {string} params.localHtml - HTML content from Foundry VTT
 * @param {string} [params.operation] - "push" or "pull"
 * @returns {Promise<"keep-lk" | "keep-foundry" | "cancel">}
 */
export async function promptPageConflictResolution({
  resourceName,
  pageName,
  remoteText,
  localHtml,
  operation = "sync"
}) {
  const localText = htmlToPlainTextPreview(localHtml);
  const remotePreview = (remoteText || "(Empty)").trim().slice(0, 1500);
  const localPreview = localText.slice(0, 1500);

  const content = `
    <div class="lk-conflict-dialog">
      <p class="lk-conflict-intro">
        <i class="fas fa-exclamation-triangle"></i>
        <strong>Conflict Detected</strong> on <strong>${escapeHtml(resourceName)} → ${escapeHtml(pageName)}</strong>
        during ${escapeHtml(operation)}. Both LegendKeeper and Foundry VTT have changes on this page since the last sync.
      </p>
      <div class="lk-conflict-columns">
        <div class="lk-conflict-col">
          <h4><i class="fas fa-cloud"></i> LegendKeeper Version</h4>
          <pre class="lk-conflict-preview">${escapeHtml(remotePreview)}</pre>
        </div>
        <div class="lk-conflict-col">
          <h4><i class="fas fa-dice-d20"></i> Foundry VTT Version</h4>
          <pre class="lk-conflict-preview">${escapeHtml(localPreview)}</pre>
        </div>
      </div>
      <p class="lk-conflict-question">Which version would you like to keep?</p>
    </div>
  `;

  // Use Foundry's DialogV2 if available (v12/v13), otherwise fallback to V1 Dialog
  if (globalThis.foundry?.applications?.api?.DialogV2) {
    try {
      const result = await globalThis.foundry.applications.api.DialogV2.wait({
        window: {
          title: `Sync Conflict: ${resourceName} (${pageName})`,
          icon: "fas fa-exclamation-triangle"
        },
        position: { width: 680 },
        content,
        rejectClose: false,
        buttons: [
          {
            action: "keep-lk",
            label: "Keep LegendKeeper (Pull to Foundry)",
            icon: "fas fa-cloud-download-alt",
            default: true
          },
          {
            action: "keep-foundry",
            label: "Keep Foundry (Push to LK)",
            icon: "fas fa-cloud-upload-alt"
          },
          {
            action: "cancel",
            label: "Abandon Sync",
            icon: "fas fa-times"
          }
        ]
      });
      if (result === "keep-lk" || result === "keep-foundry") return result;
      return "cancel";
    } catch {
      return "cancel";
    }
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (choice) => {
      if (!settled) {
        settled = true;
        resolve(choice);
      }
    };

    const dlg = new Dialog(
      {
        title: `Sync Conflict: ${resourceName} (${pageName})`,
        content,
        buttons: {
          keepLk: {
            icon: '<i class="fas fa-cloud-download-alt"></i>',
            label: "Keep LegendKeeper (Pull)",
            callback: () => finish("keep-lk")
          },
          keepFoundry: {
            icon: '<i class="fas fa-cloud-upload-alt"></i>',
            label: "Keep Foundry (Push)",
            callback: () => finish("keep-foundry")
          },
          cancel: {
            icon: '<i class="fas fa-times"></i>',
            label: "Abandon Sync",
            callback: () => finish("cancel")
          }
        },
        default: "keepLk",
        close: () => finish("cancel")
      },
      { width: 680 }
    );
    dlg.render(true);
  });
}

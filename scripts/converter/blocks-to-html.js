import { BlockKind } from "../sdk/blocks.js";

/**
 * Escapes HTML special characters.
 */
export function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Encodes a JSON object into a UTF-8 safe base64 string for round-trip block preservation.
 */
export function encodeBlockMeta(obj) {
  try {
    const json = JSON.stringify(obj);
    const bytes = new TextEncoder().encode(json);
    let binary = "";
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary);
  } catch {
    return "";
  }
}

/**
 * Decodes a UTF-8 base64 string back into a JSON object.
 */
export function decodeBlockMeta(b64) {
  if (!b64) return null;
  try {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const json = new TextDecoder().decode(bytes);
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/**
 * Renders an array of LegendKeeper inline Run objects to HTML.
 *
 * @param {Array} content - LegendKeeper run array
 * @param {Object} context - Converter context with resolveResourceLink callback
 */
export function runsToHtml(content, context = {}) {
  if (!Array.isArray(content) || content.length === 0) return "";

  return content
    .map((run) => {
      if (!run || typeof run !== "object") return "";

      if ("break" in run && run.break) {
        return "<br />";
      }

      if ("mention" in run && run.mention) {
        const { resourceId, documentId, text, name } = run.mention;
        const label = text ?? name ?? resourceId ?? "Link";
        const resolved = context.resolveMention?.({ resourceId, documentId, label });
        const docAttr = documentId ? ` data-lk-document-id="${escapeHtml(documentId)}"` : "";
        const textAttr = text ? ` data-lk-text="${escapeHtml(text)}"` : "";

        if (resolved?.uuid) {
          return `<span class="lk-mention" data-lk-resource-id="${escapeHtml(resourceId)}"${docAttr}${textAttr}>@UUID[${resolved.uuid}]{${escapeHtml(label)}}</span>`;
        }
        return `<span class="lk-mention lk-mention-unresolved" data-lk-resource-id="${escapeHtml(resourceId)}"${docAttr}${textAttr}>${escapeHtml(label)}</span>`;
      }

      if ("text" in run) {
        let html = escapeHtml(run.text ?? "");
        if (!html) return "";

        if (run.code) {
          html = `<code>${html}</code>`;
        } else {
          if (run.bold) html = `<strong>${html}</strong>`;
          if (run.italic) html = `<em>${html}</em>`;
          if (run.underline) html = `<u>${html}</u>`;
          if (run.strike) html = `<s>${html}</s>`;
          if (run.sub) html = `<sub>${html}</sub>`;
          if (run.sup) html = `<sup>${html}</sup>`;
        }

        if (run.link) {
          const href = String(run.link);
          // Check if it's an internal lk:// link
          const lkMatch = /^lk:\/\/resources\/([^/]+)(?:\/docs\/([^/]+))?|^lk:\/\/documents\/([^/]+)/.exec(href);
          if (lkMatch) {
            const targetResId = lkMatch[1] || "";
            const targetDocId = lkMatch[2] || lkMatch[3] || "";
            const resolved = context.resolveMention?.({
              resourceId: targetResId,
              documentId: targetDocId || undefined,
              label: run.text || "Link"
            });
            if (resolved?.uuid) {
              return `<span class="lk-link-internal" data-lk-href="${escapeHtml(href)}">@UUID[${resolved.uuid}]{${escapeHtml(run.text || "Link")}}</span>`;
            }
          }
          html = `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${html}</a>`;
        }

        return html;
      }

      return "";
    })
    .join("");
}

function layoutClassAndStyle(block) {
  const classes = [];
  const styles = [];
  if (block.layout && block.layout !== "default") {
    classes.push(`lk-layout-${escapeHtml(block.layout)}`);
    if (typeof block.width === "number" && block.width >= 10 && block.width <= 100) {
      styles.push(`width: ${block.width}%`);
    }
  }
  return {
    className: classes.join(" "),
    styleAttr: styles.length > 0 ? ` style="${styles.join("; ")}"` : ""
  };
}

function blockIdAttr(block) {
  return block?.id ? ` data-lk-block-id="${escapeHtml(block.id)}"` : "";
}

/**
 * Renders a single PropertyBlock or KeyValue/Meter/Collection/Image/TextField block inside an infobox or sidebar.
 */
export function renderPropertyBlockHtml(prop, context = {}) {
  if (!prop || typeof prop !== "object") return "";
  if (prop.isHidden && context.secretHandling === "strip") return "";

  const titleHtml =
    !prop.isTitleHidden && prop.title
      ? `<div class="lk-prop-title">${escapeHtml(prop.title)}</div>`
      : "";

  let bodyHtml = "";
  switch (prop.kind) {
    case "image": {
      const fillClass = prop.fill ? " lk-image-fill" : "";
      bodyHtml = `<figure class="lk-prop-image${fillClass}"><img src="${escapeHtml(prop.url || "")}" alt="${escapeHtml(prop.alt || prop.title || "")}" /></figure>`;
      break;
    }
    case "keyValue": {
      const rows = Array.isArray(prop.rows) ? prop.rows : [];
      const display = prop.display || "list";
      const rowsHtml = rows
        .map((row) => {
          const valHtml =
            Array.isArray(row.content) && row.content.length > 0
              ? runsToHtml(row.content, context)
              : escapeHtml(row.text ?? "");
          const rowIdAttr = row.id ? ` data-lk-row-id="${escapeHtml(row.id)}"` : "";
          return `<div class="lk-kv-row"${rowIdAttr}><dt class="lk-kv-key">${escapeHtml(row.key ?? "")}</dt><dd class="lk-kv-val">${valHtml}</dd></div>`;
        })
        .join("");
      bodyHtml = `<dl class="lk-kv-list lk-kv-display-${escapeHtml(display)}">${rowsHtml}</dl>`;
      break;
    }
    case "textField": {
      const childrenHtml = blocksToHtml(prop.children || [], context);
      bodyHtml = `<div class="lk-prop-textfield">${childrenHtml}</div>`;
      break;
    }
    case "meter": {
      bodyHtml = renderMeterInnerHtml(prop);
      break;
    }
    case "resourceLink": {
      bodyHtml = renderResourceLinksInnerHtml(prop.items || [], context);
      break;
    }
    case "resourceCollection": {
      bodyHtml = renderCollectionInnerHtml(prop, context);
      break;
    }
    case "embed": {
      bodyHtml = `<div class="lk-embed-link"><a href="${escapeHtml(prop.url || "")}" target="_blank" rel="noopener noreferrer">${escapeHtml(prop.title || prop.url || "Embedded Media")}</a></div>`;
      break;
    }
    case "map": {
      const resolved = context.resolveMention?.({
        resourceId: prop.resourceId,
        documentId: prop.documentId,
        label: prop.title || "Linked Map"
      });
      bodyHtml = resolved?.uuid
        ? `<div class="lk-map-ref">@UUID[${resolved.uuid}]{${escapeHtml(prop.title || resolved.name || "Open Map")}}</div>`
        : `<div class="lk-map-ref">Map (${escapeHtml(prop.resourceId || "unlinked")})</div>`;
      break;
    }
    default:
      bodyHtml = "";
  }

  const inner = `<div class="lk-property lk-property-${escapeHtml(prop.kind || "unknown")}"${blockIdAttr(prop)} data-lk-prop-b64="${encodeBlockMeta(prop)}">${titleHtml}<div class="lk-prop-body">${bodyHtml}</div></div>`;
  if (prop.isHidden && context.secretHandling === "secretBlock") {
    return `<section class="secret" id="lk-prop-secret-${escapeHtml(prop.id || "0")}">${inner}</section>`;
  }
  return inner;
}

function renderMeterInnerHtml(block) {
  const items = Array.isArray(block.items) ? block.items : [];
  const showMax = block.showMax !== false;
  const rows = items
    .map((item) => {
      const cur = Number(item.current) || 0;
      const max = Number(item.max) || 100;
      const pct = max > 0 ? Math.max(0, Math.min(100, Math.round((cur / max) * 100))) : 0;
      const color = item.color && item.color !== "none" ? item.color : "#4a90e2";
      const valLabel = showMax ? `${cur} / ${max}` : `${cur}`;
      return `<div class="lk-meter-item">
        <div class="lk-meter-header">
          <span class="lk-meter-name">${escapeHtml(item.name || "")}</span>
          <span class="lk-meter-value">${escapeHtml(valLabel)}</span>
        </div>
        <div class="lk-meter-track">
          <div class="lk-meter-fill" style="width: ${pct}%; background-color: ${escapeHtml(color)};"></div>
        </div>
      </div>`;
    })
    .join("");
  return `<div class="lk-meter-items" data-lk-mode="${escapeHtml(block.mode || "bar")}">${rows}</div>`;
}

function renderResourceLinksInnerHtml(items, context) {
  if (!Array.isArray(items) || items.length === 0) return `<p class="lk-empty-links">No linked resources</p>`;
  const lis = items
    .map((item) => {
      const resourceId = typeof item === "string" ? item : item?.resourceId;
      const documentId = typeof item === "object" ? item?.documentId : undefined;
      if (!resourceId) return "";
      const resolved = context.resolveMention?.({ resourceId, documentId });
      if (resolved?.uuid) {
        return `<li data-lk-resource-id="${escapeHtml(resourceId)}">@UUID[${resolved.uuid}]{${escapeHtml(resolved.name || resourceId)}}</li>`;
      }
      return `<li data-lk-resource-id="${escapeHtml(resourceId)}">${escapeHtml(resolved?.name || resourceId)}</li>`;
    })
    .filter(Boolean)
    .join("");
  return `<ul class="lk-resource-links-list">${lis}</ul>`;
}

function renderCollectionInnerHtml(block, context) {
  // Check explicit items first, or evaluate simple filter against known resources
  let matchedIds = [];
  if (Array.isArray(block.items) && block.items.length > 0) {
    matchedIds = block.items.map((it) => (typeof it === "string" ? it : it?.resourceId)).filter(Boolean);
  } else if (block.filter && typeof context.evaluateCollectionFilter === "function") {
    matchedIds = context.evaluateCollectionFilter(block.filter, context.currentResourceId) || [];
  }

  if (matchedIds.length > 0) {
    return renderResourceLinksInnerHtml(matchedIds, context);
  }
  return `<div class="lk-collection-placeholder"><em>Dynamic LegendKeeper Collection</em></div>`;
}

/**
 * Converts a single LegendKeeper Block into Foundry VTT HTML.
 */
export function blockToHtml(block, context = {}, index = 0) {
  if (!block || typeof block !== "object") return "";
  const idAttr = blockIdAttr(block);
  const { className: floatClass, styleAttr } = layoutClassAndStyle(block);

  switch (block.kind) {
    case BlockKind.paragraph: {
      const inner = runsToHtml(block.content || [], context);
      return `<p${idAttr}>${inner}</p>`;
    }

    case BlockKind.heading: {
      const level = Math.max(1, Math.min(6, Number(block.level) || 1));
      const inner = runsToHtml(block.content || [], context);
      return `<h${level}${idAttr}>${inner}</h${level}>`;
    }

    case BlockKind.quote: {
      const childrenHtml = blocksToHtml(block.children || [], context);
      return `<blockquote${idAttr}>${childrenHtml}</blockquote>`;
    }

    case BlockKind.code: {
      const lang = block.language ? ` class="language-${escapeHtml(block.language)}"` : "";
      const langAttr = block.language ? ` data-lk-lang="${escapeHtml(block.language)}"` : "";
      return `<pre${idAttr}${langAttr}><code${lang}>${escapeHtml(block.text ?? "")}</code></pre>`;
    }

    case BlockKind.rule: {
      return `<hr${idAttr} />`;
    }

    case BlockKind.bulletList: {
      const childrenHtml = (block.children || [])
        .map((child, idx) => blockToHtml(child, context, idx))
        .join("");
      return `<ul${idAttr}>${childrenHtml}</ul>`;
    }

    case BlockKind.orderedList: {
      const startAttr =
        block.start !== undefined && block.start !== 1 ? ` start="${Number(block.start) || 1}"` : "";
      const childrenHtml = (block.children || [])
        .map((child, idx) => blockToHtml(child, context, idx))
        .join("");
      return `<ol${idAttr}${startAttr}>${childrenHtml}</ol>`;
    }

    case BlockKind.listItem: {
      const children = Array.isArray(block.children) ? block.children : [];
      // If the listItem has a single paragraph child, unwrap it for cleaner HTML while still valid
      if (children.length === 1 && children[0]?.kind === BlockKind.paragraph) {
        const inner = runsToHtml(children[0].content || [], context);
        return `<li${idAttr}>${inner}</li>`;
      }
      const childrenHtml = blocksToHtml(children, context);
      return `<li${idAttr}>${childrenHtml}</li>`;
    }

    case BlockKind.taskList: {
      const childrenHtml = (block.children || [])
        .map((child, idx) => blockToHtml(child, context, idx))
        .join("");
      return `<ul class="lk-task-list"${idAttr}>${childrenHtml}</ul>`;
    }

    case BlockKind.taskItem: {
      const checked = Boolean(block.checked);
      const checkedAttr = checked ? " checked" : "";
      const inner = runsToHtml(block.content || [], context);
      return `<li class="lk-task-item"${idAttr} data-lk-checked="${checked}"><input type="checkbox"${checkedAttr} disabled /> <span class="lk-task-content">${inner}</span></li>`;
    }

    case BlockKind.table: {
      const rowsHtml = (block.children || [])
        .map((row, idx) => blockToHtml(row, context, idx))
        .join("");
      return `<table class="lk-table"${idAttr}><tbody>${rowsHtml}</tbody></table>`;
    }

    case BlockKind.tableRow: {
      const cellsHtml = (block.children || [])
        .map((cell, idx) => blockToHtml(cell, context, idx))
        .join("");
      return `<tr${idAttr}>${cellsHtml}</tr>`;
    }

    case BlockKind.tableCell: {
      const tag = block.header ? "th" : "td";
      const colspan = block.colspan && block.colspan > 1 ? ` colspan="${Number(block.colspan)}"` : "";
      const rowspan = block.rowspan && block.rowspan > 1 ? ` rowspan="${Number(block.rowspan)}"` : "";
      const children = Array.isArray(block.children) ? block.children : [];
      const childrenHtml = blocksToHtml(children, context);
      return `<${tag}${idAttr}${colspan}${rowspan}>${childrenHtml}</${tag}>`;
    }

    case BlockKind.callout: {
      const tone = block.tone || "note";
      const iconAttr = block.icon ? ` data-lk-icon="${escapeHtml(block.icon)}"` : "";
      const colorAttr = block.color ? ` data-lk-color="${escapeHtml(block.color)}"` : "";
      const customStyle =
        tone === "custom" && block.color ? ` style="border-left-color: ${escapeHtml(block.color)};"` : "";
      const childrenHtml = blocksToHtml(block.children || [], context);
      return `<aside class="lk-callout lk-callout-${escapeHtml(tone)}"${idAttr} data-lk-tone="${escapeHtml(tone)}"${iconAttr}${colorAttr}${customStyle}>${childrenHtml}</aside>`;
    }

    case BlockKind.expand: {
      const title = block.title || "Details";
      const childrenHtml = blocksToHtml(block.children || [], context);
      return `<details class="lk-expand"${idAttr}><summary class="lk-expand-summary">${escapeHtml(title)}</summary><div class="lk-expand-body">${childrenHtml}</div></details>`;
    }

    case BlockKind.layout: {
      const colsHtml = (block.children || [])
        .map((col, idx) => blockToHtml(col, context, idx))
        .join("");
      return `<div class="lk-layout"${idAttr}>${colsHtml}</div>`;
    }

    case BlockKind.layoutColumn: {
      const width = typeof block.width === "number" ? block.width : undefined;
      const widthAttr = width !== undefined ? ` data-lk-width="${width}" style="flex: ${width};"` : "";
      const childrenHtml = blocksToHtml(block.children || [], context);
      return `<div class="lk-layout-column"${idAttr}${widthAttr}>${childrenHtml}</div>`;
    }

    case BlockKind.secret: {
      const mode = context.secretHandling || "secretBlock";
      if (mode === "strip") {
        if (Array.isArray(context.strippedBlocks)) {
          context.strippedBlocks.push({ index, block });
        }
        return "";
      }
      const childrenHtml = blocksToHtml(block.children || [], context);
      if (mode === "normal") {
        return `<div class="lk-secret-visible ${floatClass}"${idAttr}${styleAttr}>${childrenHtml}</div>`;
      }
      const secId = block.id ? `lk-secret-${escapeHtml(block.id)}` : `lk-secret-${index}`;
      return `<section class="secret ${floatClass}" id="${secId}"${idAttr}${styleAttr}>${childrenHtml}</section>`;
    }

    case BlockKind.image: {
      const fillClass = block.fill ? " lk-image-fill" : "";
      const caption =
        !block.isTitleHidden && block.title ? `<figcaption>${escapeHtml(block.title)}</figcaption>` : "";
      return `<figure class="lk-image ${floatClass}${fillClass}"${idAttr}${styleAttr} data-lk-block-b64="${encodeBlockMeta(block)}"><img src="${escapeHtml(block.url || "")}" alt="${escapeHtml(block.alt || "")}" />${caption}</figure>`;
    }

    case BlockKind.embed: {
      const label = block.title || block.url || "Embedded Media";
      return `<div class="lk-embed ${floatClass}"${idAttr}${styleAttr} data-lk-block-b64="${encodeBlockMeta(block)}"><a href="${escapeHtml(block.url || "")}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a></div>`;
    }

    case BlockKind.keyValue: {
      const propHtml = renderPropertyBlockHtml(block, context);
      return `<div class="lk-block-keyvalue ${floatClass}"${idAttr}${styleAttr} data-lk-block-b64="${encodeBlockMeta(block)}">${propHtml}</div>`;
    }

    case BlockKind.infobox: {
      const rows = Array.isArray(block.rows) ? block.rows : [];
      const rowsHtml = rows.map((row) => renderPropertyBlockHtml(row, context)).join("");
      return `<aside class="lk-infobox ${floatClass || "lk-layout-wrapRight"}"${idAttr}${styleAttr} data-lk-block-b64="${encodeBlockMeta(block)}">${rowsHtml}</aside>`;
    }

    case BlockKind.meter: {
      const titleHtml =
        !block.isTitleHidden && block.title ? `<div class="lk-block-title">${escapeHtml(block.title)}</div>` : "";
      return `<div class="lk-meter ${floatClass}"${idAttr}${styleAttr} data-lk-block-b64="${encodeBlockMeta(block)}">${titleHtml}${renderMeterInnerHtml(block)}</div>`;
    }

    case BlockKind.resourceLink: {
      const titleHtml =
        !block.isTitleHidden && block.title ? `<div class="lk-block-title">${escapeHtml(block.title)}</div>` : "";
      return `<div class="lk-resource-link ${floatClass}"${idAttr}${styleAttr} data-lk-block-b64="${encodeBlockMeta(block)}">${titleHtml}${renderResourceLinksInnerHtml(block.items || [], context)}</div>`;
    }

    case BlockKind.resourceCollection: {
      const titleHtml =
        !block.isTitleHidden && block.title ? `<div class="lk-block-title">${escapeHtml(block.title)}</div>` : "";
      return `<div class="lk-resource-collection ${floatClass}"${idAttr}${styleAttr} data-lk-block-b64="${encodeBlockMeta(block)}">${titleHtml}${renderCollectionInnerHtml(block, context)}</div>`;
    }

    case BlockKind.map: {
      const titleHtml =
        !block.isTitleHidden && block.title ? `<div class="lk-block-title">${escapeHtml(block.title)}</div>` : "";
      const resolved = context.resolveMention?.({
        resourceId: block.resourceId,
        documentId: block.documentId,
        label: block.title || "Map"
      });
      const linkHtml = resolved?.uuid
        ? `@UUID[${resolved.uuid}]{${escapeHtml(block.title || resolved.name || "View Map")}}`
        : `Map (${escapeHtml(block.resourceId || "unlinked")})`;
      return `<div class="lk-map-block ${floatClass}"${idAttr}${styleAttr} data-lk-block-b64="${encodeBlockMeta(block)}">${titleHtml}<div class="lk-map-link">${linkHtml}</div></div>`;
    }

    case BlockKind.textField: {
      const titleHtml =
        !block.isTitleHidden && block.title ? `<div class="lk-block-title">${escapeHtml(block.title)}</div>` : "";
      const childrenHtml = blocksToHtml(block.children || [], context);
      return `<div class="lk-text-field ${floatClass}"${idAttr}${styleAttr}>${titleHtml}<div class="lk-text-field-body">${childrenHtml}</div></div>`;
    }

    case BlockKind.unsupported: {
      return `<div class="lk-unsupported"${idAttr} data-lk-unsupported="true" data-lk-block-b64="${encodeBlockMeta(block)}" style="display:none;"></div>`;
    }

    default: {
      return `<div class="lk-unknown-block"${idAttr} data-lk-block-b64="${encodeBlockMeta(block)}"></div>`;
    }
  }
}

/**
 * Converts an array of LegendKeeper Blocks into Foundry VTT HTML.
 */
export function blocksToHtml(blocks = [], context = {}) {
  if (!Array.isArray(blocks) || blocks.length === 0) return "";
  return blocks.map((block, index) => blockToHtml(block, context, index)).filter(Boolean).join("\n");
}

/**
 * Builds the optional auto-generated header/footer for a Resource's primary page
 * (Banner, Tags, Aliases, Breadcrumb/Parent link, Sidebar Properties, Child Resources).
 * Marked with data-lk-generated="true" so HTML-to-Blocks ignores it on push!
 */
export function renderResourceDecorationHtml(resource, options = {}) {
  const {
    includeSidebarProperties = true,
    includeNavigationLinks = true,
    secretHandling = "secretBlock",
    resolveMention,
    evaluateCollectionFilter,
    childResourceIds = []
  } = options;

  const context = {
    secretHandling,
    resolveMention,
    evaluateCollectionFilter,
    currentResourceId: resource.id
  };

  const headerParts = [];

  // Banner
  if (includeSidebarProperties && resource.banner?.enabled && resource.banner?.url) {
    const yPos = Number.isFinite(resource.banner.yPosition) ? resource.banner.yPosition : 50;
    headerParts.push(
      `<div class="lk-resource-banner"><img src="${escapeHtml(resource.banner.url)}" alt="${escapeHtml(resource.name)}" style="object-position: 50% ${yPos}%;" /></div>`
    );
  }

  // Breadcrumb / Parent Link & Tags / Aliases bar
  const metaPills = [];
  if (includeNavigationLinks && resource.parentId && resource.parentId !== "templates") {
    const parentResolved = resolveMention?.({ resourceId: resource.parentId });
    if (parentResolved?.uuid) {
      metaPills.push(
        `<span class="lk-meta-parent"><strong>Parent:</strong> @UUID[${parentResolved.uuid}]{${escapeHtml(parentResolved.name || "Parent")}}</span>`
      );
    }
  }

  if (includeSidebarProperties && Array.isArray(resource.aliases) && resource.aliases.length > 0) {
    metaPills.push(
      `<span class="lk-meta-aliases"><strong>Aliases:</strong> ${resource.aliases.map(escapeHtml).join(", ")}</span>`
    );
  }

  if (includeSidebarProperties && Array.isArray(resource.tags) && resource.tags.length > 0) {
    const tagsHtml = resource.tags
      .map((tag) => `<span class="lk-tag-pill">${escapeHtml(tag)}</span>`)
      .join(" ");
    metaPills.push(`<span class="lk-meta-tags">${tagsHtml}</span>`);
  }

  if (metaPills.length > 0) {
    headerParts.push(`<div class="lk-resource-meta-bar">${metaPills.join(" &bull; ")}</div>`);
  }

  // Sidebar Properties
  if (includeSidebarProperties && Array.isArray(resource.properties) && resource.properties.length > 0) {
    const sortedProps = [...resource.properties].sort((a, b) => ((a.rank ?? "") < (b.rank ?? "") ? -1 : 1));
    const propsHtml = sortedProps.map((prop) => renderPropertyBlockHtml(prop, context)).filter(Boolean).join("");
    if (propsHtml) {
      headerParts.push(
        `<aside class="lk-sidebar-properties"><div class="lk-sidebar-header">Properties</div>${propsHtml}</aside>`
      );
    }
  }

  const headerHtml =
    headerParts.length > 0
      ? `<div class="lk-sync-header" data-lk-generated="true">${headerParts.join("\n")}</div>\n`
      : "";

  // Footer with child links if any
  let footerHtml = "";
  if (includeNavigationLinks && Array.isArray(childResourceIds) && childResourceIds.length > 0) {
    const linksHtml = renderResourceLinksInnerHtml(childResourceIds, context);
    footerHtml = `\n<div class="lk-sync-footer" data-lk-generated="true"><hr /><h4>Sub-Resources</h4>${linksHtml}</div>`;
  }

  return { headerHtml, footerHtml };
}

/**
 * Renders a LegendKeeper `map` Document (with mapImage and features/pins) into Foundry HTML.
 */
export function renderMapDocumentHtml(doc, features = [], context = {}) {
  const parts = [`<div class="lk-map-document" data-lk-generated="true" data-lk-doc-type="map">`];

  if (doc.mapImage?.url) {
    parts.push(
      `<figure class="lk-map-canvas"><img src="${escapeHtml(doc.mapImage.url)}" alt="${escapeHtml(doc.name || "Map")}" /></figure>`
    );
  } else {
    parts.push(`<p><em>This LegendKeeper map document has no image uploaded yet.</em></p>`);
  }

  const pins = features.filter((f) => f.type === "pin" || f.type === "region");
  if (pins.length > 0) {
    const rows = pins
      .map((f) => {
        let linkedHtml = "—";
        if (f.uri) {
          const match = /^lk:\/\/resources\/([^/]+)(?:\/docs\/([^/]+))?|^lk:\/\/documents\/([^/]+)/.exec(f.uri);
          if (match) {
            const resId = match[1] || "";
            const docId = match[2] || match[3] || "";
            const resolved = context.resolveMention?.({
              resourceId: resId,
              documentId: docId || undefined,
              label: f.name || "Linked Entry"
            });
            if (resolved?.uuid) {
              linkedHtml = `@UUID[${resolved.uuid}]{${escapeHtml(resolved.name || f.name || "Open")}}`;
            }
          }
        }
        return `<tr><td><strong>${escapeHtml(f.name || "Unnamed")}</strong></td><td>${escapeHtml(f.type)}</td><td>${linkedHtml}</td></tr>`;
      })
      .join("");
    parts.push(
      `<h3>Map Pins &amp; Regions (${pins.length})</h3><table class="lk-table"><thead><tr><th>Name</th><th>Type</th><th>Linked Journal</th></tr></thead><tbody>${rows}</tbody></table>`
    );
  }

  parts.push(`</div>`);
  return parts.join("\n");
}

/**
 * Renders a LegendKeeper `time` (Timeline) Document (with lanes and events) into Foundry HTML.
 */
export function renderTimelineDocumentHtml(doc, lanes = [], events = [], context = {}) {
  const parts = [`<div class="lk-timeline-document" data-lk-generated="true" data-lk-doc-type="time">`];
  const laneMap = new Map(lanes.map((l) => [l.id, l]));

  if (events.length === 0) {
    parts.push(`<p><em>No events recorded on this timeline.</em></p>`);
  } else {
    const rows = events
      .map((ev) => {
        const laneName = laneMap.get(ev.laneId)?.name || "";
        const dateStr = ev.formattedStart
          ? ev.formattedEnd
            ? `${ev.formattedStart} – ${ev.formattedEnd}`
            : ev.formattedStart
          : "—";
        let linkedHtml = escapeHtml(ev.name || "Event");
        if (ev.uri) {
          const match = /^lk:\/\/resources\/([^/]+)(?:\/docs\/([^/]+))?|^lk:\/\/documents\/([^/]+)/.exec(ev.uri);
          if (match) {
            const resId = match[1] || "";
            const docId = match[2] || match[3] || "";
            const resolved = context.resolveMention?.({
              resourceId: resId,
              documentId: docId || undefined,
              label: ev.name || "Event"
            });
            if (resolved?.uuid) {
              linkedHtml = `@UUID[${resolved.uuid}]{${escapeHtml(ev.name || resolved.name || "Event")}}`;
            }
          }
        }
        return `<tr><td><strong>${escapeHtml(dateStr)}</strong></td><td>${linkedHtml}</td><td>${escapeHtml(laneName)}</td></tr>`;
      })
      .join("");

    parts.push(
      `<h3>Timeline Events (${events.length})</h3><table class="lk-table"><thead><tr><th>Date</th><th>Event</th><th>Lane</th></tr></thead><tbody>${rows}</tbody></table>`
    );
  }

  parts.push(`</div>`);
  return parts.join("\n");
}

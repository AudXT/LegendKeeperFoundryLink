import { BlockKind } from "../sdk/blocks.js";
import { decodeBlockMeta } from "./blocks-to-html.js";

const FOUNDRY_UUID_REGEX = /@UUID\[([^\]]+)\](?:\{([^}]*)\})?/g;

/**
 * Checks whether a URL is valid for a LegendKeeper `link` mark (http, https, mailto, lk).
 */
function isValidLkLinkUrl(href) {
  if (!href || typeof href !== "string") return false;
  return /^(https?:\/\/|mailto:|lk:\/\/)/i.test(href.trim());
}

/**
 * Checks whether an image URL looks like a native LegendKeeper project asset URL.
 */
export function isLkAssetUrl(url) {
  if (!url || typeof url !== "string") return false;
  return /^https?:\/\/[^/]*legendkeeper\.com\//i.test(url) || url.includes("lk-assets") || url.includes("legendkeeper");
}

/**
 * Sanitizes a preserved block before sending it back to LegendKeeper write endpoints:
 * - Strips read-only fields (such as `mention.name` or row `text` when `content` is present)
 * - Ensures block IDs are never duplicated within the same document write
 */
export function sanitizeBlockForWrite(block, usedIds = new Set()) {
  if (!block || typeof block !== "object") return null;
  const clone =
    typeof globalThis.structuredClone === "function"
      ? globalThis.structuredClone(block)
      : JSON.parse(JSON.stringify(block));

  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (node.id) {
      if (usedIds.has(node.id)) {
        delete node.id;
      } else {
        usedIds.add(node.id);
      }
    }

    if (node.kind === "unsupported") {
      // Unsupported blocks only carry { kind: "unsupported", id }
      for (const k of Object.keys(node)) {
        if (k !== "kind" && k !== "id") delete node[k];
      }
      return;
    }

    if (Array.isArray(node.content)) {
      node.content = sanitizeRunsForWrite(node.content);
    }

    if (Array.isArray(node.rows)) {
      node.rows = node.rows.map((row) => {
        const r = { ...row };
        if (r.id) {
          if (usedIds.has(r.id)) delete r.id;
          else usedIds.add(r.id);
        }
        if (node.kind === "infobox") {
          // Infobox rows are PropertyBlocks
          visit(r);
          return r;
        }
        // KeyValue rows: keep key, id?, content or text (not both read-only text + content if content exists)
        if (Array.isArray(r.content) && r.content.length > 0) {
          r.content = sanitizeRunsForWrite(r.content);
          delete r.text;
        }
        delete r.rank;
        return r;
      });
    }

    if (Array.isArray(node.children)) {
      node.children = node.children.map((child) => {
        visit(child);
        return child;
      });
    }
  };

  visit(clone);
  return clone;
}

function sanitizeRunsForWrite(runs) {
  if (!Array.isArray(runs)) return [];
  const out = [];
  for (const run of runs) {
    if (!run || typeof run !== "object") continue;
    if ("break" in run && run.break) {
      out.push({ break: true });
      continue;
    }
    if ("mention" in run && run.mention?.resourceId) {
      const m = { resourceId: String(run.mention.resourceId) };
      if (run.mention.documentId) m.documentId = String(run.mention.documentId);
      if (run.mention.text) m.text = String(run.mention.text);
      out.push({ mention: m });
      continue;
    }
    if ("text" in run && typeof run.text === "string" && run.text.length > 0) {
      const clean = { text: run.text };
      if (run.code) {
        clean.code = true;
      } else {
        if (run.bold) clean.bold = true;
        if (run.italic) clean.italic = true;
        if (run.underline) clean.underline = true;
        if (run.strike) clean.strike = true;
        if (run.sub) clean.sub = true;
        else if (run.sup) clean.sup = true;
      }
      if (run.link && isValidLkLinkUrl(run.link)) {
        clean.link = run.link.trim();
      }
      out.push(clean);
    }
  }
  return out;
}

/**
 * Splits a text node's string on Foundry `@UUID[...]{label}` macros, converting matched
 * journal references to LegendKeeper `mention` runs when resolvable, and plain text runs otherwise.
 */
function parseTextWithFoundryUuids(rawText, activeMarks, context) {
  if (!rawText) return [];
  const runs = [];
  let lastIndex = 0;

  FOUNDRY_UUID_REGEX.lastIndex = 0;
  let match;
  while ((match = FOUNDRY_UUID_REGEX.exec(rawText)) !== null) {
    if (match.index > lastIndex) {
      const slice = rawText.slice(lastIndex, match.index);
      if (slice.length > 0) {
        runs.push(buildMarkedTextRun(slice, activeMarks));
      }
    }

    const uuid = match[1].trim();
    const label = (match[2] ?? "").trim();
    const resolved = context.resolveUuidToLk?.(uuid);

    if (resolved?.resourceId) {
      const mentionObj = { resourceId: resolved.resourceId };
      if (resolved.documentId) mentionObj.documentId = resolved.documentId;
      if (label && label !== resolved.name) mentionObj.text = label;
      runs.push({ mention: mentionObj });
    } else {
      const fallbackText = label || uuid;
      if (fallbackText.length > 0) {
        runs.push(buildMarkedTextRun(fallbackText, activeMarks));
      }
    }

    lastIndex = FOUNDRY_UUID_REGEX.lastIndex;
  }

  if (lastIndex < rawText.length) {
    const tail = rawText.slice(lastIndex);
    if (tail.length > 0) {
      runs.push(buildMarkedTextRun(tail, activeMarks));
    }
  }

  return runs;
}

function buildMarkedTextRun(text, marks = {}) {
  const run = { text };
  if (marks.code) {
    run.code = true;
  } else {
    if (marks.bold) run.bold = true;
    if (marks.italic) run.italic = true;
    if (marks.underline) run.underline = true;
    if (marks.strike) run.strike = true;
    if (marks.sub) run.sub = true;
    else if (marks.sup) run.sup = true;
  }
  if (marks.link && isValidLkLinkUrl(marks.link)) {
    run.link = marks.link;
  }
  return run;
}

/**
 * Extracts inline LegendKeeper runs from a DOM element's childNodes.
 */
export function domNodesToRuns(nodes, activeMarks = {}, context = {}) {
  const out = [];

  for (const node of nodes) {
    if (node.nodeType === 3) {
      // Text node
      const text = node.nodeValue ?? "";
      if (text.length > 0) {
        out.push(...parseTextWithFoundryUuids(text, activeMarks, context));
      }
      continue;
    }

    if (node.nodeType !== 1) continue;
    const el = node;
    const tag = el.tagName.toLowerCase();

    if (el.getAttribute("data-lk-generated") === "true") continue;

    if (tag === "br") {
      out.push({ break: true });
      continue;
    }

    // Explicit LK mention span from pull
    if (el.classList.contains("lk-mention") && el.getAttribute("data-lk-resource-id")) {
      const resourceId = el.getAttribute("data-lk-resource-id");
      const documentId = el.getAttribute("data-lk-document-id") || undefined;
      const customText = el.getAttribute("data-lk-text") || undefined;
      const mentionObj = { resourceId };
      if (documentId) mentionObj.documentId = documentId;
      if (customText) mentionObj.text = customText;
      out.push({ mention: mentionObj });
      continue;
    }

    // Internal lk:// link span
    if (el.classList.contains("lk-link-internal") && el.getAttribute("data-lk-href")) {
      const href = el.getAttribute("data-lk-href");
      const text = el.textContent?.replace(/@UUID\[[^\]]+\]\{([^}]*)\}/, "$1")?.trim() || "Link";
      out.push(buildMarkedTextRun(text, { ...activeMarks, link: href }));
      continue;
    }

    // Foundry enriched content-link anchor: <a class="content-link" data-uuid="...">Label</a>
    if (tag === "a" && (el.classList.contains("content-link") || el.hasAttribute("data-uuid") || el.hasAttribute("data-id"))) {
      const uuid = el.getAttribute("data-uuid") || (el.getAttribute("data-id") ? `JournalEntry.${el.getAttribute("data-id")}` : "");
      const label = (el.textContent ?? "").trim();
      const resolved = uuid ? context.resolveUuidToLk?.(uuid) : null;
      if (resolved?.resourceId) {
        const mentionObj = { resourceId: resolved.resourceId };
        if (resolved.documentId) mentionObj.documentId = resolved.documentId;
        if (label && label !== resolved.name) mentionObj.text = label;
        out.push({ mention: mentionObj });
        continue;
      }
    }

    const nextMarks = { ...activeMarks };
    if (tag === "strong" || tag === "b") nextMarks.bold = true;
    else if (tag === "em" || tag === "i") nextMarks.italic = true;
    else if (tag === "u") nextMarks.underline = true;
    else if (tag === "s" || tag === "del" || tag === "strike") nextMarks.strike = true;
    else if (tag === "code") nextMarks.code = true;
    else if (tag === "sub") {
      nextMarks.sub = true;
      delete nextMarks.sup;
    } else if (tag === "sup") {
      nextMarks.sup = true;
      delete nextMarks.sub;
    } else if (tag === "a") {
      const href = el.getAttribute("href");
      if (href && isValidLkLinkUrl(href)) {
        nextMarks.link = href.trim();
      }
    }

    out.push(...domNodesToRuns(Array.from(el.childNodes), nextMarks, context));
  }

  return mergeAdjacentRuns(out);
}

function sameMarks(a, b) {
  return (
    Boolean(a.bold) === Boolean(b.bold) &&
    Boolean(a.italic) === Boolean(b.italic) &&
    Boolean(a.underline) === Boolean(b.underline) &&
    Boolean(a.strike) === Boolean(b.strike) &&
    Boolean(a.code) === Boolean(b.code) &&
    Boolean(a.sub) === Boolean(b.sub) &&
    Boolean(a.sup) === Boolean(b.sup) &&
    (a.link ?? undefined) === (b.link ?? undefined)
  );
}

function mergeAdjacentRuns(runs) {
  const merged = [];
  for (const run of runs) {
    if ("text" in run) {
      if (run.text.length === 0) continue;
      const prev = merged[merged.length - 1];
      if (prev && "text" in prev && sameMarks(prev, run)) {
        prev.text += run.text;
        continue;
      }
    }
    merged.push(run);
  }
  return merged;
}

function assignBlockIdIfUnique(block, el, usedIds) {
  const id = el?.getAttribute?.("data-lk-block-id");
  if (id && !usedIds.has(id)) {
    usedIds.add(id);
    block.id = id;
  }
  return block;
}

function ensureNonEmptyBlocks(blocks, fallbackText = "") {
  if (Array.isArray(blocks) && blocks.length > 0) return blocks;
  return [
    {
      kind: BlockKind.paragraph,
      content: fallbackText ? [{ text: fallbackText }] : []
    }
  ];
}

/**
 * Converts a single DOM Element into one or more LegendKeeper Blocks.
 */
async function domElementToBlocks(el, context, usedIds) {
  if (!el || el.nodeType !== 1) return [];
  if (el.getAttribute("data-lk-generated") === "true") return [];

  // Check if this element carries a preserved base64 block representation
  const preservedB64 = el.getAttribute("data-lk-block-b64");
  if (preservedB64) {
    const decoded = decodeBlockMeta(preservedB64);
    if (decoded && typeof decoded === "object" && decoded.kind) {
      // If it's a keyValue block, sync any inline-edited key/value rows from DOM
      if (decoded.kind === "keyValue") {
        updateKeyValueRowsFromDom(decoded, el, context);
      }
      const sanitized = sanitizeBlockForWrite(decoded, usedIds);
      if (sanitized) return [sanitized];
    }
  }

  const tag = el.tagName.toLowerCase();

  // Headings h1..h6
  if (/^h[1-6]$/.test(tag)) {
    const level = Number(tag[1]);
    const content = domNodesToRuns(Array.from(el.childNodes), {}, context);
    return [assignBlockIdIfUnique({ kind: BlockKind.heading, level, content }, el, usedIds)];
  }

  // Paragraph
  if (tag === "p") {
    // Check if paragraph only contains a single <img>
    const imgs = el.querySelectorAll("img");
    if (imgs.length === 1 && (el.textContent ?? "").trim() === "") {
      return await convertImageElement(imgs[0], el, context, usedIds);
    }
    const content = domNodesToRuns(Array.from(el.childNodes), {}, context);
    return [assignBlockIdIfUnique({ kind: BlockKind.paragraph, content }, el, usedIds)];
  }

  // Horizontal rule
  if (tag === "hr") {
    return [assignBlockIdIfUnique({ kind: BlockKind.rule }, el, usedIds)];
  }

  // Code block
  if (tag === "pre") {
    const codeEl = el.querySelector("code");
    const text = (codeEl ? codeEl.textContent : el.textContent) ?? "";
    let language = el.getAttribute("data-lk-lang") || undefined;
    if (!language && codeEl?.className) {
      const m = /language-([A-Za-z0-9_-]+)/.exec(codeEl.className);
      if (m) language = m[1];
    }
    const block = { kind: BlockKind.code, text };
    if (language) block.language = language;
    return [assignBlockIdIfUnique(block, el, usedIds)];
  }

  // Blockquote
  if (tag === "blockquote") {
    const children = await domChildrenToBlocks(el, context, usedIds);
    return [
      assignBlockIdIfUnique(
        {
          kind: BlockKind.quote,
          children: ensureNonEmptyBlocks(children)
        },
        el,
        usedIds
      )
    ];
  }

  // Foundry Secret section: <section class="secret">
  if (tag === "section" && el.classList.contains("secret")) {
    const children = await domChildrenToBlocks(el, context, usedIds);
    return [
      assignBlockIdIfUnique(
        {
          kind: BlockKind.secret,
          children: ensureNonEmptyBlocks(children)
        },
        el,
        usedIds
      )
    ];
  }

  // Callout: <aside class="lk-callout">
  if (el.classList.contains("lk-callout")) {
    const tone = el.getAttribute("data-lk-tone") || "note";
    const children = await domChildrenToBlocks(el, context, usedIds);
    const block = {
      kind: BlockKind.callout,
      tone,
      children: ensureNonEmptyBlocks(children)
    };
    if (tone === "custom") {
      const icon = el.getAttribute("data-lk-icon");
      const color = el.getAttribute("data-lk-color");
      if (icon) block.icon = icon;
      if (color) block.color = color;
    }
    return [assignBlockIdIfUnique(block, el, usedIds)];
  }

  // Expand / Details: <details>
  if (tag === "details") {
    const summaryEl = el.querySelector(":scope > summary");
    const title = (summaryEl?.textContent ?? "Details").trim() || "Details";
    const bodyEl = el.querySelector(":scope > .lk-expand-body");
    let children;
    if (bodyEl) {
      children = await domChildrenToBlocks(bodyEl, context, usedIds);
    } else {
      const otherNodes = Array.from(el.childNodes).filter((n) => n !== summaryEl);
      children = await domNodeListToBlocks(otherNodes, context, usedIds);
    }
    return [
      assignBlockIdIfUnique(
        {
          kind: BlockKind.expand,
          title,
          children: ensureNonEmptyBlocks(children)
        },
        el,
        usedIds
      )
    ];
  }

  // Multi-column layout: <div class="lk-layout">
  if (el.classList.contains("lk-layout")) {
    const colEls = Array.from(el.querySelectorAll(":scope > .lk-layout-column"));
    if (colEls.length >= 2) {
      const cols = [];
      for (const colEl of colEls.slice(0, 3)) {
        const colChildren = await domChildrenToBlocks(colEl, context, usedIds);
        const colBlock = {
          kind: BlockKind.layoutColumn,
          children: ensureNonEmptyBlocks(colChildren)
        };
        const widthAttr = Number(colEl.getAttribute("data-lk-width"));
        if (Number.isFinite(widthAttr) && widthAttr >= 10 && widthAttr <= 100) {
          colBlock.width = widthAttr;
        }
        assignBlockIdIfUnique(colBlock, colEl, usedIds);
        cols.push(colBlock);
      }
      return [assignBlockIdIfUnique({ kind: BlockKind.layout, children: cols }, el, usedIds)];
    }
  }

  // Lists: <ul> or <ol>
  if (tag === "ul" || tag === "ol") {
    const isTaskList =
      el.classList.contains("lk-task-list") ||
      Boolean(el.querySelector(":scope > li.lk-task-item, :scope > li > input[type='checkbox']"));

    const liEls = Array.from(el.children).filter((c) => c.tagName.toLowerCase() === "li");
    if (liEls.length === 0) return [];

    if (isTaskList) {
      const taskItems = liEls.map((liEl) => {
        const checkbox = liEl.querySelector("input[type='checkbox']");
        const checked =
          liEl.getAttribute("data-lk-checked") === "true" ||
          Boolean(checkbox?.checked) ||
          Boolean(checkbox?.hasAttribute("checked"));
        const contentSpan = liEl.querySelector(".lk-task-content");
        const nodes = contentSpan
          ? Array.from(contentSpan.childNodes)
          : Array.from(liEl.childNodes).filter((n) => n !== checkbox);
        const content = domNodesToRuns(nodes, {}, context);
        return assignBlockIdIfUnique({ kind: BlockKind.taskItem, checked, content }, liEl, usedIds);
      });
      return [assignBlockIdIfUnique({ kind: BlockKind.taskList, children: taskItems }, el, usedIds)];
    }

    const listItems = [];
    for (const liEl of liEls) {
      const itemBlock = await convertListItemElement(liEl, context, usedIds);
      if (itemBlock) listItems.push(itemBlock);
    }
    if (listItems.length === 0) return [];

    if (tag === "ol") {
      const start = Number(el.getAttribute("start"));
      const block = { kind: BlockKind.orderedList, children: listItems };
      if (Number.isFinite(start) && start > 1) block.start = start;
      return [assignBlockIdIfUnique(block, el, usedIds)];
    }
    return [assignBlockIdIfUnique({ kind: BlockKind.bulletList, children: listItems }, el, usedIds)];
  }

  // Tables: <table>
  if (tag === "table") {
    const trEls = Array.from(el.querySelectorAll("tr"));
    if (trEls.length === 0) return [];
    const rows = [];
    for (const trEl of trEls) {
      const cellEls = Array.from(trEl.children).filter((c) => {
        const t = c.tagName.toLowerCase();
        return t === "td" || t === "th";
      });
      if (cellEls.length === 0) continue;
      const cells = [];
      for (const cellEl of cellEls) {
        const isHeader = cellEl.tagName.toLowerCase() === "th";
        const cellChildren = await domChildrenToBlocks(cellEl, context, usedIds);
        const cellBlock = {
          kind: BlockKind.tableCell,
          ...(isHeader ? { header: true } : {}),
          children: ensureNonEmptyBlocks(cellChildren)
        };
        const colspan = Number(cellEl.getAttribute("colspan"));
        const rowspan = Number(cellEl.getAttribute("rowspan"));
        if (Number.isFinite(colspan) && colspan > 1) cellBlock.colspan = colspan;
        if (Number.isFinite(rowspan) && rowspan > 1) cellBlock.rowspan = rowspan;
        assignBlockIdIfUnique(cellBlock, cellEl, usedIds);
        cells.push(cellBlock);
      }
      rows.push(assignBlockIdIfUnique({ kind: BlockKind.tableRow, children: cells }, trEl, usedIds));
    }
    if (rows.length === 0) return [];
    return [assignBlockIdIfUnique({ kind: BlockKind.table, children: rows }, el, usedIds)];
  }

  // Figure / Image
  if (tag === "figure" || tag === "img") {
    const imgEl = tag === "img" ? el : el.querySelector("img");
    if (imgEl) {
      return await convertImageElement(imgEl, el, context, usedIds);
    }
  }

  // Generic container (div, section, article, aside, main)
  if (["div", "section", "article", "aside", "main", "header", "footer"].includes(tag)) {
    return await domChildrenToBlocks(el, context, usedIds);
  }

  // Fallback: treat element's inline content as a paragraph
  const runs = domNodesToRuns(Array.from(el.childNodes), {}, context);
  if (runs.length > 0) {
    return [assignBlockIdIfUnique({ kind: BlockKind.paragraph, content: runs }, el, usedIds)];
  }
  return [];
}

async function convertListItemElement(liEl, context, usedIds) {
  const inlineNodes = [];
  const blockChildEls = [];

  for (const child of Array.from(liEl.childNodes)) {
    if (child.nodeType === 1) {
      const t = child.tagName.toLowerCase();
      if (["p", "ul", "ol", "blockquote", "pre", "table", "div"].includes(t)) {
        blockChildEls.push(child);
        continue;
      }
    }
    inlineNodes.push(child);
  }

  const children = [];
  const headRuns = domNodesToRuns(inlineNodes, {}, context);
  if (headRuns.length > 0 || blockChildEls.length === 0) {
    children.push({ kind: BlockKind.paragraph, content: headRuns });
  }

  for (const childEl of blockChildEls) {
    const subBlocks = await domElementToBlocks(childEl, context, usedIds);
    children.push(...subBlocks);
  }

  // LegendKeeper requires the first child of a listItem to be a block (normally paragraph)
  if (children.length === 0) {
    children.push({ kind: BlockKind.paragraph, content: [] });
  } else if (children[0].kind !== BlockKind.paragraph) {
    children.unshift({ kind: BlockKind.paragraph, content: [] });
  }

  return assignBlockIdIfUnique({ kind: BlockKind.listItem, children }, liEl, usedIds);
}

async function convertImageElement(imgEl, wrapperEl, context, usedIds) {
  const rawSrc = imgEl.getAttribute("src") || "";
  const alt = imgEl.getAttribute("alt") || "";
  const captionEl = wrapperEl?.tagName?.toLowerCase() === "figure" ? wrapperEl.querySelector("figcaption") : null;
  const title = captionEl ? (captionEl.textContent ?? "").trim() : undefined;

  if (!rawSrc) return [];

  let resolvedUrl = isLkAssetUrl(rawSrc) ? rawSrc : null;
  if (!resolvedUrl && typeof context.resolveImageAssetUrl === "function") {
    try {
      resolvedUrl = await context.resolveImageAssetUrl(rawSrc, title || alt || "Journal Image");
    } catch (err) {
      console.warn("LegendKeeper Sync | Failed to upload local image to LK asset storage:", err);
    }
  }

  if (resolvedUrl) {
    const imgBlock = {
      kind: BlockKind.image,
      url: resolvedUrl
    };
    if (alt) imgBlock.alt = alt;
    if (title) {
      imgBlock.title = title;
      imgBlock.isTitleHidden = false;
    }
    if (wrapperEl?.classList?.contains("lk-image-fill")) {
      imgBlock.fill = true;
    }
    return [assignBlockIdIfUnique(imgBlock, wrapperEl || imgEl, usedIds)];
  }

  // Fallback when image is not a LegendKeeper asset URL (LK API rejects non-asset URLs in image blocks):
  if (/^https?:\/\//i.test(rawSrc)) {
    const label = title || alt || rawSrc;
    return [
      {
        kind: BlockKind.paragraph,
        content: [{ text: `[Image: ${label}]`, link: rawSrc }]
      }
    ];
  }

  const label = title || alt || rawSrc;
  return [
    {
      kind: BlockKind.paragraph,
      content: [{ text: `[Local Image: ${label}]`, italic: true }]
    }
  ];
}

function updateKeyValueRowsFromDom(decodedBlock, wrapperEl, context) {
  const rowEls = Array.from(wrapperEl.querySelectorAll(".lk-kv-row"));
  if (rowEls.length === 0) return;
  decodedBlock.rows = rowEls.map((rowEl) => {
    const key = (rowEl.querySelector(".lk-kv-key")?.textContent ?? "").trim();
    const dd = rowEl.querySelector(".lk-kv-val");
    const content = dd ? domNodesToRuns(Array.from(dd.childNodes), {}, context) : [];
    const rowId = rowEl.getAttribute("data-lk-row-id") || undefined;
    const row = { key };
    if (rowId) row.id = rowId;
    if (content.length > 0) row.content = content;
    else row.text = (dd?.textContent ?? "").trim();
    return row;
  });
}

async function domNodeListToBlocks(nodes, context, usedIds) {
  const blocks = [];
  let pendingInlineNodes = [];

  const flushInline = () => {
    if (pendingInlineNodes.length === 0) return;
    const runs = domNodesToRuns(pendingInlineNodes, {}, context);
    pendingInlineNodes = [];
    const hasNonWhitespace = runs.some(
      (r) => "mention" in r || "break" in r || ("text" in r && r.text.trim().length > 0)
    );
    if (hasNonWhitespace) {
      blocks.push({ kind: BlockKind.paragraph, content: runs });
    }
  };

  for (const node of nodes) {
    if (node.nodeType === 3) {
      if ((node.nodeValue ?? "").trim().length > 0 || pendingInlineNodes.length > 0) {
        pendingInlineNodes.push(node);
      }
      continue;
    }
    if (node.nodeType !== 1) continue;
    const el = node;
    const tag = el.tagName.toLowerCase();
    const isInline = [
      "span",
      "strong",
      "b",
      "em",
      "i",
      "u",
      "s",
      "del",
      "strike",
      "code",
      "sub",
      "sup",
      "a",
      "br"
    ].includes(tag);

    if (isInline) {
      pendingInlineNodes.push(el);
    } else {
      flushInline();
      const converted = await domElementToBlocks(el, context, usedIds);
      blocks.push(...converted);
    }
  }

  flushInline();
  return blocks;
}

async function domChildrenToBlocks(parentEl, context, usedIds) {
  return domNodeListToBlocks(Array.from(parentEl.childNodes), context, usedIds);
}

/**
 * Converts a Foundry VTT JournalEntryPage HTML string into an array of LegendKeeper v3 Blocks.
 *
 * @param {string} html - HTML string from page.text.content
 * @param {Object} context - Converter context:
 *   - resolveUuidToLk(uuid) => { resourceId, documentId?, name? }
 *   - resolveImageAssetUrl(src, name) => Promise<string|null>
 *   - preservedBlocks: Array<{ index: number, block: Object }> (for stripped secrets)
 * @returns {Promise<Array>} Valid LegendKeeper v3 Block array
 */
export async function htmlToBlocks(html, context = {}) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html || "", "text/html");
  const usedIds = new Set();

  const blocks = await domChildrenToBlocks(doc.body, context, usedIds);

  // Re-insert any secret blocks that were stripped during pull (when secretHandling === "strip")
  if (Array.isArray(context.preservedBlocks) && context.preservedBlocks.length > 0) {
    const sorted = [...context.preservedBlocks].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    for (const item of sorted) {
      if (!item?.block) continue;
      const sanitized = sanitizeBlockForWrite(item.block, usedIds);
      if (!sanitized) continue;
      const targetIdx = Math.max(0, Math.min(blocks.length, item.index ?? blocks.length));
      blocks.splice(targetIdx, 0, sanitized);
    }
  }

  return blocks;
}

/**
 * LegendKeeper v3 API Block Builders, Enums, and Readers
 * Compatible with @legendkeeper/sdk/blocks v4.1.0
 */

export const BlockKind = Object.freeze({
  paragraph: "paragraph",
  heading: "heading",
  quote: "quote",
  code: "code",
  rule: "rule",
  bulletList: "bulletList",
  orderedList: "orderedList",
  listItem: "listItem",
  taskList: "taskList",
  taskItem: "taskItem",
  table: "table",
  tableRow: "tableRow",
  tableCell: "tableCell",
  callout: "callout",
  expand: "expand",
  layout: "layout",
  layoutColumn: "layoutColumn",
  image: "image",
  embed: "embed",
  keyValue: "keyValue",
  infobox: "infobox",
  meter: "meter",
  resourceCollection: "resourceCollection",
  resourceLink: "resourceLink",
  map: "map",
  secret: "secret",
  textField: "textField",
  unsupported: "unsupported"
});

export const CalloutTone = Object.freeze({
  info: "info",
  note: "note",
  success: "success",
  warning: "warning",
  error: "error",
  custom: "custom"
});

export const EmbedProvider = Object.freeze({
  youtube: "youtube",
  spotify: "spotify",
  soundcloud: "soundcloud"
});

export const KeyValueDisplay = Object.freeze({
  list: "list",
  grid: "grid",
  inline: "inline"
});

export const BlockLayout = Object.freeze({
  default: "default",
  wrapLeft: "wrapLeft",
  wrapRight: "wrapRight",
  center: "center",
  alignStart: "alignStart",
  alignEnd: "alignEnd"
});

export const MeterMode = Object.freeze({
  bar: "bar",
  wheel: "wheel",
  "gauge-180": "gauge-180",
  "gauge-270": "gauge-270",
  pool: "pool",
  rating: "rating"
});

export const PropertyKind = Object.freeze({
  textField: "textField",
  keyValue: "keyValue",
  image: "image",
  meter: "meter",
  resourceCollection: "resourceCollection",
  resourceLink: "resourceLink",
  embed: "embed",
  map: "map",
  unsupported: "unsupported"
});

function isTextRun(run) {
  return typeof run === "object" && run !== null && "text" in run;
}

function collectRuns(input, out) {
  if (input === null || input === undefined) return;
  if (typeof input === "string") {
    if (input.length > 0) {
      out.push({ text: input });
    }
    return;
  }
  if (Array.isArray(input)) {
    for (const item of input) collectRuns(item, out);
    return;
  }
  const run = input;
  if (isTextRun(run) && run.text.length === 0) return;
  out.push(run);
}

export function runs(text) {
  const out = [];
  collectRuns(text, out);
  return out;
}

function mapText(text, apply) {
  return runs(text).map((run) => (isTextRun(run) && run.code !== true ? apply(run) : run));
}

export function bold(...text) {
  return mapText(text, (run) => ({ ...run, bold: true }));
}

export function italic(...text) {
  return mapText(text, (run) => ({ ...run, italic: true }));
}

export function underline(...text) {
  return mapText(text, (run) => ({ ...run, underline: true }));
}

export function strike(...text) {
  return mapText(text, (run) => ({ ...run, strike: true }));
}

export function mono(...text) {
  return runs(text).map((run) => (isTextRun(run) ? { text: run.text, code: true } : run));
}

export function sub(...text) {
  return mapText(text, ({ sup: _sup, ...run }) => ({ ...run, sub: true }));
}

export function sup(...text) {
  return mapText(text, ({ sub: _sub, ...run }) => ({ ...run, sup: true }));
}

export function link(href, ...text) {
  return mapText(text, (run) => ({ ...run, link: href }));
}

export function mention(target) {
  const inner = { resourceId: target.resourceId };
  if (target.documentId !== undefined) inner.documentId = target.documentId;
  if (target.text !== undefined) inner.text = target.text;
  return [{ mention: inner }];
}

export const br = Object.freeze({ break: true });

function asBlocks(children) {
  return children.map((child) => (typeof child === "string" ? p(child) : child));
}

function titleOf(block, options) {
  if (options.title !== undefined) block.title = options.title;
  if (options.isTitleHidden !== undefined) block.isTitleHidden = options.isTitleHidden;
}

function float(block, options) {
  if (options.layout !== undefined) block.layout = options.layout;
  if (options.width !== undefined) block.width = options.width;
}

function withSpans(cell, options) {
  if (options.colspan !== undefined) cell.colspan = options.colspan;
  if (options.rowspan !== undefined) cell.rowspan = options.rowspan;
  return cell;
}

export function p(...text) {
  return {
    kind: "paragraph",
    content: runs(text)
  };
}

export function h(level, ...text) {
  return {
    kind: "heading",
    level: Math.max(1, Math.min(6, Number(level) || 1)),
    content: runs(text)
  };
}

export function quote(first, ...rest) {
  return {
    kind: "quote",
    children: asBlocks([first, ...rest])
  };
}

export function code(text, language) {
  return language === undefined
    ? { kind: "code", text: String(text ?? "") }
    : { kind: "code", language, text: String(text ?? "") };
}

export function rule() {
  return { kind: "rule" };
}

export function li(first, ...rest) {
  const head = typeof first === "object" && first !== null && !Array.isArray(first) && "kind" in first ? first : p(first);
  return {
    kind: "listItem",
    children: [head, ...asBlocks(rest)]
  };
}

function isListItemBlock(item) {
  return typeof item === "object" && item !== null && !Array.isArray(item) && "kind" in item && item.kind === "listItem";
}

function asListItems(items) {
  return items.map((item) => (isListItemBlock(item) ? item : li(item)));
}

export function ul(first, ...rest) {
  return {
    kind: "bulletList",
    children: asListItems([first, ...rest])
  };
}

export function ol(items, options = {}) {
  const children = asListItems(items);
  return options.start === undefined
    ? { kind: "orderedList", children }
    : { kind: "orderedList", start: options.start, children };
}

export function task(checked, ...text) {
  return {
    kind: "taskItem",
    checked: Boolean(checked),
    content: runs(text)
  };
}

export function tasks(first, ...rest) {
  return {
    kind: "taskList",
    children: [first, ...rest]
  };
}

export function table(first, ...rest) {
  return {
    kind: "table",
    children: [first, ...rest]
  };
}

export function tr(...cells) {
  return {
    kind: "tableRow",
    children: cells
  };
}

export function td(children, options = {}) {
  return withSpans(
    {
      kind: "tableCell",
      children: asBlocks(children)
    },
    options
  );
}

export function th(children, options = {}) {
  return withSpans(
    {
      kind: "tableCell",
      header: true,
      children: asBlocks(children)
    },
    options
  );
}

export function callout(tone, children, options = {}) {
  const block = {
    kind: "callout",
    tone: tone || "note",
    children: asBlocks(children)
  };
  if (options.icon !== undefined) block.icon = options.icon;
  if (options.color !== undefined) block.color = options.color;
  return block;
}

export function expand(title, ...children) {
  return {
    kind: "expand",
    title: String(title ?? ""),
    children: asBlocks(children)
  };
}

export function layout(first, second, third) {
  const children = third === undefined ? [first, second] : [first, second, third];
  return {
    kind: "layout",
    children
  };
}

export function column(...args) {
  const [first, ...rest] = args;
  if (typeof first === "number") {
    return {
      kind: "layoutColumn",
      width: first,
      children: asBlocks(rest)
    };
  }
  return {
    kind: "layoutColumn",
    children: asBlocks(args)
  };
}

export function image(url, second) {
  const options = typeof second === "string" ? { alt: second } : second ?? {};
  const block = {
    kind: "image",
    url
  };
  if (options.alt !== undefined) block.alt = options.alt;
  if (options.fill !== undefined) block.fill = options.fill;
  titleOf(block, options);
  float(block, options);
  return block;
}

export function embed(provider, url, options = {}) {
  const block = {
    kind: "embed",
    provider,
    url
  };
  titleOf(block, options);
  float(block, options);
  return block;
}

function toRow(input) {
  if (Array.isArray(input)) {
    const [key, text] = input;
    return { key, text };
  }
  const source = input;
  const row = { key: source.key };
  if (source.id !== undefined) row.id = source.id;
  if (source.rank !== undefined) row.rank = source.rank;
  if (source.content !== undefined) row.content = runs(source.content);
  if (source.text !== undefined) row.text = source.text;
  return row;
}

export function keyValue(rows, options = {}) {
  const block = {
    kind: "keyValue",
    rows: rows.map(toRow)
  };
  if (options.display !== undefined) block.display = options.display;
  titleOf(block, options);
  float(block, options);
  return block;
}

export function infobox(...args) {
  const [first, second] = args;
  if (Array.isArray(first)) {
    const block = {
      kind: "infobox",
      rows: [...first]
    };
    float(block, second ?? {});
    return block;
  }
  return {
    kind: "infobox",
    rows: args
  };
}

export function meter(mode, items, options = {}) {
  const block = {
    kind: "meter",
    mode,
    items: [...items]
  };
  if (options.showText !== undefined) block.showText = options.showText;
  if (options.showIcon !== undefined) block.showIcon = options.showIcon;
  if (options.showMax !== undefined) block.showMax = options.showMax;
  titleOf(block, options);
  float(block, options);
  return block;
}

export function links(items, options = {}) {
  const block = {
    kind: "resourceLink",
    items: items.map((item) => (typeof item === "string" ? { resourceId: item } : item))
  };
  titleOf(block, options);
  float(block, options);
  return block;
}

export function collection(options = {}) {
  const block = {
    kind: "resourceCollection"
  };
  if (options.items !== undefined) {
    block.items = options.items.map((item) => (typeof item === "string" ? { resourceId: item } : item));
  }
  if (options.filter !== undefined) block.filter = options.filter;
  titleOf(block, options);
  float(block, options);
  return block;
}

export function map(target, options = {}) {
  const block = {
    kind: "map",
    resourceId: target.resourceId,
    documentId: target.documentId
  };
  if (options.viewport !== undefined) block.viewport = options.viewport;
  if (options.displayHeight !== undefined) block.displayHeight = options.displayHeight;
  if (options.fill !== undefined) block.fill = options.fill;
  titleOf(block, options);
  float(block, options);
  return block;
}

function container(kind, args) {
  const [first, second] = args;
  if (Array.isArray(first)) {
    const block = {
      kind,
      children: asBlocks(first)
    };
    float(block, second ?? {});
    return block;
  }
  return {
    kind,
    children: asBlocks(args)
  };
}

export function secret(...args) {
  return container("secret", args);
}

export function textField(...args) {
  const block = container("textField", args);
  const [first, second] = args;
  if (Array.isArray(first)) titleOf(block, second ?? {});
  return block;
}

export function withId(id, block) {
  return {
    ...block,
    id
  };
}

export function property(block, envelope = {}) {
  const given = {};
  if (envelope.title !== undefined) given.title = envelope.title;
  if (envelope.isTitleHidden !== undefined) given.isTitleHidden = envelope.isTitleHidden;
  if (envelope.isHidden !== undefined) given.isHidden = envelope.isHidden;
  return {
    ...block,
    ...given
  };
}

function rootEntries(input) {
  if (Array.isArray(input)) return input.map((block, index) => [block, `blocks[${index}]`]);
  if (input && typeof input === "object" && "blocks" in input) {
    return input.blocks.map((block, index) => [block, `blocks[${index}]`]);
  }
  return [[input, "block"]];
}

function runsText(content = []) {
  return content
    .map((run) =>
      "break" in run
        ? "\n"
        : "mention" in run
          ? run.mention.text ?? run.mention.name ?? ""
          : run.text ?? ""
    )
    .join("");
}

function blockLines(block) {
  if (!block || typeof block !== "object") return [];
  const own = [];
  if ("content" in block && Array.isArray(block.content)) own.push(runsText(block.content));
  else if (block.kind === "code") own.push(block.text ?? "");
  const children = "children" in block && Array.isArray(block.children) ? block.children.flatMap(blockLines) : [];
  return [...own, ...children].filter((line) => line.length > 0);
}

export function plainText(input) {
  return rootEntries(input)
    .flatMap(([block]) => blockLines(block))
    .join("\n");
}

export function walk(input, visitor) {
  const visit = (block, path) => {
    if (!block || typeof block !== "object") return;
    visitor(block, path);
    if (block.kind === "infobox" && Array.isArray(block.rows)) {
      block.rows.forEach((row, index) => visit(row, `${path}.rows[${index}]`));
      return;
    }
    if ("children" in block && Array.isArray(block.children)) {
      block.children.forEach((child, index) => visit(child, `${path}.children[${index}]`));
    }
  };
  for (const [block, path] of rootEntries(input)) visit(block, path);
}

export function findBlock(input, id) {
  const pending = rootEntries(input).map(([block]) => block);
  while (pending.length > 0) {
    const block = pending.shift();
    if (!block) continue;
    if (block.id === id) return block;
    if (block.kind === "infobox" && Array.isArray(block.rows)) pending.unshift(...block.rows);
    else if ("children" in block && Array.isArray(block.children)) pending.unshift(...block.children);
  }
  return undefined;
}

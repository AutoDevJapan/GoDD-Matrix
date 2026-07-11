import type { DesignIndexEntry } from "../../src/ds/types.js";
/**
 * GoDD Matrix 静的 Web アプリのエントリ (issue #28)。
 *
 * 完全クライアントサイド。副作用 (index / DESIGN.md fetch, hash 検証, クリップボード, DOM)
 * のみを担い、ドメインロジックは {@link ./lib} (純関数) に委譲する。秘密は一切扱わない。
 */
import { parseDesignIndex } from "../../src/ds/validate.js";
import {
  DS_INDEX_URL,
  EMPTY_SELECTION,
  FACET_AXES,
  type FacetAxis,
  type FacetGroupView,
  type FacetSelection,
  type FacetValueItem,
  type Page,
  type SearchInput,
  colorLabel,
  composePromptForCell,
  computeFacetGroups,
  designRawUrl,
  filterByFacets,
  hasAnyFacet,
  jsicName,
  moodLabel,
  paginate,
  searchCells,
  toggleFacet,
} from "./lib.js";

/** DOM を安全に組むための小さなヘルパ (textContent 経由; innerHTML は使わない)。 */
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: { class?: string; text?: string; title?: string } = {},
  children: readonly Node[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (attrs.class) node.className = attrs.class;
  if (attrs.text !== undefined) node.textContent = attrs.text;
  if (attrs.title !== undefined) node.title = attrs.title;
  for (const child of children) node.appendChild(child);
  return node;
}

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`要素が見つかりません: #${id}`);
  return node as T;
}

/** 現在の全エントリ (index.json 取込後に確定)。 */
let allEntries: readonly DesignIndexEntry[] = [];
/** フォーム検索の結果 (ファセット適用前の母集合)。 */
let baseMatches: readonly DesignIndexEntry[] = [];
/** 直近の検索要望 (プロンプト合成の notices に反映)。 */
let lastRequest: SearchInput = {};
/** 選択中のファセット (同一軸 OR / 軸跨ぎ AND)。 */
let facetSelection: FacetSelection = EMPTY_SELECTION;
/** 現在ページ (1 起点)。 */
let currentPage = 1;
/** 展開済みファセット軸 (多数の値を「もっと見る」で開いた軸)。 */
const expandedFacets = new Set<FacetAxis>();
/** 1 ページの表示件数。 */
const PAGE_SIZE = 24;
/** 折りたたみ時のファセット値の初期表示数。 */
const FACET_COLLAPSE_LIMIT = 16;

/** SHA-256 (hex)。crypto.subtle は secure context (https/localhost) で有効。 */
async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** 旧 API (execCommand) によるコピーのフォールバック。 */
function legacyCopy(text: string): boolean {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.top = "-1000px";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  document.body.removeChild(ta);
  return ok;
}

/** クリップボードへコピーし、ボタンに一時的なフィードバックを出す。 */
async function copyToClipboard(text: string, button: HTMLButtonElement): Promise<void> {
  const original = button.textContent ?? "";
  let ok = false;
  try {
    await navigator.clipboard.writeText(text);
    ok = true;
  } catch {
    // Clipboard API が拒否/未対応の環境では旧 API にフォールバックする。
    ok = legacyCopy(text);
  }
  button.textContent = ok ? "コピーしました" : "コピー失敗";
  window.setTimeout(() => {
    button.textContent = original;
  }, 1400);
}

function copyButton(label: string, getText: () => string): HTMLButtonElement {
  const btn = el("button", { class: "copy-btn", text: label });
  btn.type = "button";
  btn.addEventListener("click", () => {
    void copyToClipboard(getText(), btn);
  });
  return btn;
}

function badge(text: string, kind: string): HTMLSpanElement {
  return el("span", { class: `badge badge-${kind}`, text });
}

/** フォームから検索要望を読む。 */
function readSearchInput(): SearchInput {
  const val = (id: string): string => byId<HTMLInputElement>(id).value.trim();
  const tagsRaw = val("q-tags");
  const tags = tagsRaw
    ? tagsRaw
        .split(/[,、\s]+/)
        .map((t) => t.trim())
        .filter((t) => t.length > 0)
    : [];
  return {
    industry: val("q-industry"),
    color: val("q-color"),
    mood: val("q-mood"),
    tags,
    text: val("q-text"),
  };
}

/** 解決した軸の要約を描画する。 */
function renderAxes(result: ReturnType<typeof searchCells>, input: SearchInput): void {
  const box = byId("axes");
  box.replaceChildren();
  const d = result.decision;
  const rows: Node[] = [];
  const line = (axis: string, resolved: string | undefined, raw: string | undefined): Node => {
    const label = el("span", { class: "axis-label", text: axis });
    const value = el("span", {
      class: resolved ? "axis-val resolved" : "axis-val unresolved",
      text: resolved ?? (raw ? `未解決 (入力: ${raw})` : "未指定"),
    });
    return el("div", { class: "axis-row" }, [label, value]);
  };
  const jsicBest = input.industry ? d.jsic.best : undefined;
  rows.push(
    line(
      "業種 (JSIC)",
      jsicBest ? `${jsicBest.entry.code} ${jsicBest.entry.name}` : undefined,
      input.industry,
    ),
  );
  const colorBest = input.color ? d.color.best : undefined;
  rows.push(
    line(
      "カラー",
      colorBest ? `${colorBest.entry.slug} (${colorBest.entry.label})` : undefined,
      input.color,
    ),
  );
  const moodBest = input.mood ? d.mood.best : undefined;
  rows.push(
    line(
      "ムード",
      moodBest ? `${moodBest.entry.slug} (${moodBest.entry.label})` : undefined,
      input.mood,
    ),
  );
  box.appendChild(el("h2", { class: "section-title", text: "解決した軸" }));
  box.appendChild(el("div", { class: "axes-grid" }, rows));
}

/** 1 セルのカードを描画する。 */
function renderCard(entry: DesignIndexEntry): HTMLElement {
  const meta = el("div", { class: "card-meta" }, [
    badge(`業種 ${entry.jsic}`, "jsic"),
    badge(colorLabel(entry.color), "color"),
    badge(moodLabel(entry.mood), "mood"),
  ]);
  const tags = el(
    "div",
    { class: "card-tags" },
    (entry.tags ?? []).map((t) => el("span", { class: "tag", text: t })),
  );
  const title = el("h3", { class: "card-title", text: entry.title });
  const industry = el("p", { class: "card-industry", text: `業種名: ${jsicName(entry.jsic)}` });
  const select = el("button", { class: "select-btn", text: "このセルでプロンプト合成 →" });
  select.type = "button";
  select.addEventListener("click", () => {
    void openDetail(entry);
  });
  return el("article", { class: "card" }, [title, industry, meta, tags, select]);
}

/** 検索結果 (カード一覧) を描画する。 */
function renderResults(matches: readonly DesignIndexEntry[]): void {
  const list = byId("results");
  list.replaceChildren();
  if (matches.length === 0) {
    list.appendChild(
      el("p", { class: "empty", text: "一致するセルがありません。条件を緩めてください。" }),
    );
    return;
  }
  for (const entry of matches) list.appendChild(renderCard(entry));
}

/** フォーム検索を実行し (ファセット母集合を再計算)、表示を更新する。 */
function runSearch(): void {
  const input = readSearchInput();
  lastRequest = input;
  const result = searchCells(allEntries, input);
  baseMatches = result.matches;
  renderAxes(result, input);
  applyState();
}

/** ファセット + ページングを適用して結果 / ファセット / ページャ / URL を更新する。 */
function applyState(): void {
  renderFacets();
  const filtered = filterByFacets(baseMatches, facetSelection);
  const pageView = paginate(filtered, currentPage, PAGE_SIZE);
  currentPage = pageView.page;
  renderResults(pageView.items);
  renderPager(pageView);
  updateStatus(pageView);
  syncUrl();
}

/** 件数サマリを更新する。 */
function updateStatus(pg: Page<DesignIndexEntry>): void {
  const status = byId("status");
  status.className = "status";
  if (pg.total === 0) {
    status.textContent = `0 / ${allEntries.length} 件`;
    return;
  }
  const start = (pg.page - 1) * pg.pageSize + 1;
  const end = start + pg.items.length - 1;
  status.textContent = `${pg.total} / ${allEntries.length} 件中 ${start}–${end} を表示`;
}

/** ファセット (チップ群) を描画する。 */
function renderFacets(): void {
  const box = byId("facets");
  box.replaceChildren();
  const groups = computeFacetGroups(baseMatches, facetSelection);
  if (!groups.some((g) => g.items.length > 0)) return;

  const head = el("div", { class: "facets-head" }, [
    el("h2", { class: "section-title", text: "絞り込み" }),
  ]);
  if (hasAnyFacet(facetSelection)) {
    const clear = el("button", { class: "facet-clear", text: "条件をクリア" });
    clear.type = "button";
    clear.addEventListener("click", () => {
      facetSelection = { ...EMPTY_SELECTION };
      currentPage = 1;
      applyState();
    });
    head.appendChild(clear);
  }
  box.appendChild(head);

  for (const group of groups) {
    if (group.items.length === 0) continue;
    box.appendChild(renderFacetGroup(group));
  }
}

/** 1 軸のファセット (見出し + チップ + もっと見る) を描画する。 */
function renderFacetGroup(group: FacetGroupView): HTMLElement {
  const expanded = expandedFacets.has(group.axis);
  const overLimit = group.items.length > FACET_COLLAPSE_LIMIT;
  const visible = expanded || !overLimit ? group.items : group.items.slice(0, FACET_COLLAPSE_LIMIT);

  const chips = el("div", { class: "chips" });
  for (const item of visible) chips.appendChild(renderChip(group.axis, item));
  if (overLimit) {
    const more = el("button", {
      class: "facet-more",
      text: expanded ? "閉じる" : `他 ${group.items.length - FACET_COLLAPSE_LIMIT} 件を表示`,
    });
    more.type = "button";
    more.setAttribute("aria-expanded", String(expanded));
    more.addEventListener("click", () => {
      if (expanded) expandedFacets.delete(group.axis);
      else expandedFacets.add(group.axis);
      renderFacets();
    });
    chips.appendChild(more);
  }
  return el("div", { class: "facet-group" }, [
    el("h3", { class: "facet-title", text: group.title }),
    chips,
  ]);
}

/** 1 ファセット値のトグルチップ (件数バッジ付き)。 */
function renderChip(axis: FacetAxis, item: FacetValueItem): HTMLButtonElement {
  const chip = el("button", { class: item.selected ? "chip selected" : "chip" });
  chip.type = "button";
  chip.setAttribute("aria-pressed", String(item.selected));
  chip.appendChild(el("span", { class: "chip-label", text: item.label }));
  chip.appendChild(el("span", { class: "chip-count", text: String(item.count) }));
  if (item.count === 0 && !item.selected) chip.disabled = true;
  chip.addEventListener("click", () => {
    facetSelection = toggleFacet(facetSelection, axis, item.value);
    currentPage = 1;
    applyState();
  });
  return chip;
}

/** ページャ (前へ / ページ数 / 次へ) を描画する。 */
function renderPager(pg: Page<DesignIndexEntry>): void {
  const nav = byId("pager");
  nav.replaceChildren();
  if (pg.pageCount <= 1) return;
  const prev = el("button", { class: "page-btn", text: "← 前へ" });
  prev.type = "button";
  prev.disabled = pg.page <= 1;
  prev.addEventListener("click", () => goToPage(pg.page - 1));
  const next = el("button", { class: "page-btn", text: "次へ →" });
  next.type = "button";
  next.disabled = pg.page >= pg.pageCount;
  next.addEventListener("click", () => goToPage(pg.page + 1));
  const info = el("span", { class: "page-info", text: `${pg.page} / ${pg.pageCount} ページ` });
  nav.append(prev, info, next);
}

/** ページ移動して結果先頭へスクロールする。 */
function goToPage(page: number): void {
  currentPage = page;
  applyState();
  byId("results").scrollIntoView({ behavior: "smooth", block: "start" });
}

/** 現在の状態 (フォーム値 / ファセット / ページ) を URL クエリへ反映する (共有可能)。 */
function syncUrl(): void {
  const params = new URLSearchParams();
  const input = lastRequest;
  if (input.industry) params.set("industry", input.industry);
  if (input.color) params.set("color", input.color);
  if (input.mood) params.set("mood", input.mood);
  if (input.tags && input.tags.length > 0) params.set("tags", input.tags.join(","));
  if (input.text) params.set("text", input.text);
  for (const axis of FACET_AXES) {
    const values = facetSelection[axis];
    if (values.length > 0) params.set(`f_${axis}`, values.join(","));
  }
  if (currentPage > 1) params.set("page", String(currentPage));
  const qs = params.toString();
  window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
}

/** URL クエリから状態 (フォーム値 / ファセット / ページ) を復元する。 */
function restoreFromUrl(): void {
  const params = new URLSearchParams(window.location.search);
  const setInput = (id: string, key: string): void => {
    const v = params.get(key);
    if (v) byId<HTMLInputElement>(id).value = v;
  };
  setInput("q-industry", "industry");
  setInput("q-color", "color");
  setInput("q-mood", "mood");
  setInput("q-tags", "tags");
  setInput("q-text", "text");
  const splitValues = (key: string): string[] => {
    const v = params.get(key);
    return v
      ? v
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
      : [];
  };
  facetSelection = {
    industry: splitValues("f_industry"),
    color: splitValues("f_color"),
    mood: splitValues("f_mood"),
    tag: splitValues("f_tag"),
  };
  const page = Number.parseInt(params.get("page") ?? "1", 10);
  currentPage = Number.isFinite(page) && page > 0 ? page : 1;
}

/** 選択セルの詳細 (DESIGN.md 取得 → プロンプト合成 → コピー) を描画する。 */
async function openDetail(entry: DesignIndexEntry): Promise<void> {
  const detail = byId("detail");
  detail.replaceChildren();
  detail.appendChild(el("h2", { class: "section-title", text: `選択: ${entry.title}` }));
  const info = el("p", { class: "detail-note", text: "DESIGN.md を取得中…" });
  detail.appendChild(info);
  detail.scrollIntoView({ behavior: "smooth", block: "start" });

  const url = designRawUrl(entry);
  let markdown: string;
  try {
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    markdown = await res.text();
  } catch (err) {
    info.className = "detail-note error";
    info.textContent = `DESIGN.md を取得できませんでした (${url}): ${
      err instanceof Error ? err.message : String(err)
    }。未材化セルの可能性があります (Generator レンダーが必要)。`;
    return;
  }

  let hashVerified = false;
  try {
    const expected = entry.hash.replace(/^sha256:/i, "").toLowerCase();
    hashVerified = (await sha256Hex(markdown)) === expected;
  } catch {
    hashVerified = false;
  }

  const prompt = composePromptForCell({ entry, markdown, hashVerified, request: lastRequest });

  info.className = "detail-note";
  info.replaceChildren(
    el("span", { text: `出所: ${prompt.provenance} / ` }),
    badge(hashVerified ? "hash 検証 OK" : "hash 未検証/不一致", hashVerified ? "ok" : "warn"),
  );

  if (prompt.notices.length > 0) {
    const ul = el(
      "ul",
      { class: "notices" },
      prompt.notices.map((n) => el("li", { text: n })),
    );
    detail.appendChild(el("h3", { class: "sub-title", text: "注意 (notices)" }));
    detail.appendChild(ul);
  }

  detail.appendChild(
    promptBlock("Claude system プロンプト", prompt.systemPrompt, "system プロンプトをコピー"),
  );
  detail.appendChild(
    promptBlock("Claude user プロンプト", prompt.userPrompt, "user プロンプトをコピー"),
  );
  detail.appendChild(promptBlock("DESIGN.md 本文", markdown, "DESIGN.md をコピー"));
}

/** 見出し + コピー + <pre> のブロック。 */
function promptBlock(heading: string, content: string, copyLabel: string): HTMLElement {
  const head = el("div", { class: "block-head" }, [
    el("h3", { class: "sub-title", text: heading }),
    copyButton(copyLabel, () => content),
  ]);
  const pre = el("pre", { class: "code" });
  pre.appendChild(el("code", { text: content }));
  return el("section", { class: "block" }, [head, pre]);
}

/** index.json を取込んで初期表示する。 */
async function bootstrap(): Promise<void> {
  const status = byId("status");
  status.textContent = "index.json を取得中…";
  try {
    const res = await fetch(DS_INDEX_URL, { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const index = parseDesignIndex(await res.text());
    allEntries = index.entries;
  } catch (err) {
    status.className = "error";
    status.textContent = `index.json を取得できませんでした: ${
      err instanceof Error ? err.message : String(err)
    }`;
    return;
  }
  restoreFromUrl();
  runSearch();
}

function wireForm(): void {
  const form = byId<HTMLFormElement>("search-form");
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    // フォーム検索は母集合を変えるため、ページとファセット展開状態を初期化する。
    currentPage = 1;
    expandedFacets.clear();
    runSearch();
  });
  byId<HTMLButtonElement>("reset").addEventListener("click", () => {
    form.reset();
    facetSelection = { ...EMPTY_SELECTION };
    expandedFacets.clear();
    currentPage = 1;
    runSearch();
  });
}

wireForm();
void bootstrap();

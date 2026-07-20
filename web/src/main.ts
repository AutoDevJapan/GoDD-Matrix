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
  DS_TAXONOMY_URL,
  EMPTY_SELECTION,
  EMPTY_TAXONOMY,
  FACET_AXES,
  type FacetAxis,
  type FacetGroupView,
  type FacetSelection,
  type FacetValueItem,
  type Locale,
  type Page,
  type SearchInput,
  type Swatch,
  type Taxonomy,
  approxSwatchesForColor,
  buildCellPermalink,
  composePromptForCell,
  computeFacetGroups,
  designRawUrl,
  extractColorTokens,
  familySwatchHex,
  filterByFacets,
  findEntryById,
  hasAnyFacet,
  highlightMatches,
  highlightTermsFromText,
  jsicName,
  labelForColor,
  labelForMood,
  paginate,
  parseCellParam,
  parseTaxonomy,
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

/**
 * `text` を自由文の一致語で分割し、一致部を `<mark>` に、非一致部をテキストノードにして
 * `parent` へ追加する (XSS 安全: 全断片を textContent 経由で組み、innerHTML は使わない)。
 * `terms` が空なら素のテキストを 1 ノードで追加する (従来表示と同等)。
 */
function appendHighlighted(parent: HTMLElement, text: string, terms: readonly string[]): void {
  for (const seg of highlightMatches(text, terms)) {
    if (seg.match) parent.appendChild(el("mark", { class: "hl", text: seg.text }));
    else parent.appendChild(document.createTextNode(seg.text));
  }
}

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`要素が見つかりません: #${id}`);
  return node as T;
}

/** 現在の全エントリ (index.json 取込後に確定)。 */
let allEntries: readonly DesignIndexEntry[] = [];

/** 現在の UI 表示言語。 */
let currentLocale: Locale = "ja";

interface TranslationKeys {
  siteTitle: string;
  siteDesc: string;
  searchTitle: string;
  labelIndustry: string;
  placeholderIndustry: string;
  labelColor: string;
  placeholderColor: string;
  labelMood: string;
  placeholderMood: string;
  labelTags: string;
  placeholderTags: string;
  labelText: string;
  placeholderText: string;
  labelOutputLang: string;
  placeholderOutputLang: string;
  hintOutputLang: string;
  btnSearch: string;
  btnReset: string;
  footerText: string;
  statTheoreticalLabel: string;
  statMaterializedLabel: string;
  titleAxes: string;
  titleResults: string;
  emptyResults: string;
  loadingIndex: string;
  loadingDesign: string;
  errorIndex: string;
  errorDesign: string;
  errorDesignHint: string;
  labelIndustryName: string;
  btnPromptCompose: string;
  labelColorPaletteApprox: string;
  labelColorPaletteReal: string;
  labelNotices: string;
  copyBtnLabel: string;
  copiedLabel: string;
  copyFailedLabel: string;
  labelHtmlTitle: string;
  conditionClear: string;
  detailLoadingMarkdown: string;
  detailLoadError: string;
  detailLoadErrorHint: string;
  archNoteTitle: string;
  archNoteText: string;
  virtualBtnText: string;
  virtualPromptNotice: string;
  detailVirtualTitle: string;
  detailVirtualLoading: string;
}

const TRANSLATIONS: Record<Locale, TranslationKeys> = {
  ja: {
    siteTitle: "GoDD Matrix — デザイン検索 & プロンプト",
    siteDesc:
      "業種 (JSIC) × カラー × ムードで確定デザイン仕様 (DESIGN.md) を検索し、Claude 用プロンプトをブラウザ内で合成してコピーします。データは公開リポジトリから直接取得し、サーバや秘密は一切使いません (完全クライアントサイド)。",
    searchTitle: "要望で検索",
    labelIndustry: "業種 (名称 / キーワード / JSIC コード)",
    placeholderIndustry: "例: コンサル / 書店 / 7281",
    labelColor: "カラー",
    placeholderColor: "例: 青 / ライトブルー / white",
    labelMood: "ムード",
    placeholderMood: "例: 信頼 / ミニマル",
    labelTags: "タグ (カンマ区切り / AND)",
    placeholderTags: "例: editorial, serif-display",
    labelText: "自由文",
    placeholderText: "タイトル・タグ・名称を横断検索",
    labelOutputLang: "作りたいサイトの言語（任意）",
    placeholderOutputLang: "例: English / 日本語 / Français / 简体中文",
    hintOutputLang: "生成プロンプトに「この言語で作れ」と注入します。空なら仕様の言語のまま。",
    btnSearch: "検索",
    btnReset: "リセット",
    footerText:
      "データ出典: 公開 Design-Systems リポジトリ (index.json / DESIGN.md) を raw から直接取得。本ツールはクライアントサイドのみで動作します。",
    statTheoreticalLabel: "設計可能空間（直積×バリアント）",
    statMaterializedLabel: "事前生成仕様（DESIGN.md）",
    titleAxes: "解決した軸",
    titleResults: "候補セル",
    emptyResults: "一致するセルがありません。",
    loadingIndex: "データをロード中…",
    loadingDesign: "仕様をロード中…",
    errorIndex: "インデックスを取得できませんでした: ",
    errorDesign: "仕様データを取得できませんでした",
    errorDesignHint: "",
    labelIndustryName: "業種名: ",
    btnPromptCompose: "この仕様でプロンプト合成 →",
    labelColorPaletteApprox: "カラーパレット（近似値）",
    labelColorPaletteReal: "カラートークン（DESIGN.md）",
    labelNotices: "注意",
    copyBtnLabel: "コピー",
    copiedLabel: "コピーしました",
    copyFailedLabel: "コピー失敗",
    labelHtmlTitle: "GoDD Matrix — デザイン検索 & プロンプト",
    conditionClear: "条件をクリア",
    detailLoadingMarkdown: "仕様をロード中…",
    detailLoadError: "仕様データを取得できませんでした",
    detailLoadErrorHint: "",
    archNoteTitle: "設計空間について",
    archNoteText:
      "決定論的デザインエンジンにより、全軸の組み合わせ仕様とプロンプトがリアルタイム合成されます。",
    virtualBtnText: "この解決軸で仕様・プロンプトを生成 →",
    virtualPromptNotice:
      "決定論的デザインエンジンにより、選択された軸の仕様とプロンプトがリアルタイム合成されました。",
    detailVirtualTitle: "選択された仕様: ",
    detailVirtualLoading: "仕様とプロンプトを合成中…",
  },
  en: {
    siteTitle: "GoDD Matrix — Design Search & Prompt",
    siteDesc:
      "Search design specifications (DESIGN.md) by industry (JSIC) × color × mood, and compose prompts for Claude. Data is retrieved directly from the public repository (pure client-side, zero servers/secrets).",
    searchTitle: "Search Criteria",
    labelIndustry: "Industry (Name / Keyword / JSIC Code)",
    placeholderIndustry: "e.g., Consulting / Bookstore / 7281",
    labelColor: "Color",
    placeholderColor: "e.g., Blue / Light Blue / white",
    labelMood: "Mood",
    placeholderMood: "e.g., Trust / Minimal",
    labelTags: "Tags (Comma-separated / AND)",
    placeholderTags: "e.g., editorial, serif-display",
    labelText: "Fulltext",
    placeholderText: "Search title, tags, and names",
    labelOutputLang: "Target Site Language (Optional)",
    placeholderOutputLang: "e.g., English / 日本語 / Français / 简体中文",
    hintOutputLang:
      "Inject 'Output user-visible text in this language' into prompt. If empty, uses specification language.",
    btnSearch: "Search",
    btnReset: "Reset",
    footerText:
      "Data source: Direct raw fetch from public Design-Systems repo (index.json / DESIGN.md). Works fully client-side.",
    statTheoreticalLabel: "Theoretical Space",
    statMaterializedLabel: "Pre-generated Specifications",
    titleAxes: "Resolved Axes",
    titleResults: "Candidates",
    emptyResults: "No matching cells found.",
    loadingIndex: "Loading data...",
    loadingDesign: "Loading spec...",
    errorIndex: "Failed to fetch index: ",
    errorDesign: "Failed to fetch design spec",
    errorDesignHint: "",
    labelIndustryName: "Industry Name: ",
    btnPromptCompose: "Compose prompt using this spec →",
    labelColorPaletteApprox: "Color Palette (Approx)",
    labelColorPaletteReal: "Color Tokens (DESIGN.md)",
    labelNotices: "Notices",
    copyBtnLabel: "Copy",
    copiedLabel: "Copied!",
    copyFailedLabel: "Copy Failed",
    labelHtmlTitle: "GoDD Matrix — Design Search & Prompts",
    conditionClear: "Clear filters",
    detailLoadingMarkdown: "Loading spec...",
    detailLoadError: "Failed to fetch design spec",
    detailLoadErrorHint: "",
    archNoteTitle: "Design Space",
    archNoteText:
      "The design specification and prompt for the resolved axes are synthesized in real-time by the deterministic engine.",
    virtualBtnText: "Generate Spec & Prompt for these Axes →",
    virtualPromptNotice:
      "The design specification and prompt for the resolved axes have been synthesized in real-time by the deterministic engine.",
    detailVirtualTitle: "Selected Spec: ",
    detailVirtualLoading: "Generating specifications and prompt...",
  },
};
/** DS taxonomy (taxonomy.json 取込後に確定; 未達なら空 = slug/bundled フォールバック)。 */
let taxonomy: Taxonomy = EMPTY_TAXONOMY;
/** フォーム検索の結果 (ファセット適用前の母集合)。 */
let baseMatches: readonly DesignIndexEntry[] = [];
/** 直近の検索要望 (プロンプト合成の notices に反映)。 */
let lastRequest: SearchInput = {};
/** 直近の検索・解決結果。 */
let lastSearchResult: SearchResult | null = null;
/** 自由文検索でハイライトする語 (カードのタイトル/業種名/タグの一致箇所を強調)。 */
let highlightTerms: readonly string[] = [];
/** 選択中のファセット (同一軸 OR / 軸跨ぎ AND)。 */
let facetSelection: FacetSelection = EMPTY_SELECTION;
/** 現在ページ (1 起点)。 */
let currentPage = 1;
/** 展開済みファセット軸 (多数の値を「もっと見る」で開いた軸)。 */
const expandedFacets = new Set<FacetAxis>();
/** 現在選択中のセル ID (詳細表示中なら URL の `?cell=` に反映する)。未選択なら null。 */
let selectedCellId: string | null = null;
/** URL から復元すべきセル ID (bootstrap で index 取込後に開く)。 */
let pendingCellId: string | null = null;
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
  const t = TRANSLATIONS[currentLocale];
  button.textContent = ok ? t.copiedLabel : t.copyFailedLabel;
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

/**
 * カラースウォッチ列 (issue #37) を描画する。
 * a11y: 列全体を role="img" + aria-label でひとまとまりに読み上げ、各見本は装飾扱い
 * (aria-hidden) でホバー時 title に「役割ラベル + 色値」を出す。色値は inline style で
 * 反映 (検証済み #rrggbb のみ, innerHTML は使わない)。
 */
function swatchRow(swatches: readonly Swatch[], groupLabel: string): HTMLElement {
  const row = el("div", { class: "swatches" });
  row.setAttribute("role", "img");
  row.setAttribute("aria-label", `${groupLabel}: ${swatches.map((s) => s.label).join("、")}`);
  for (const sw of swatches) {
    const cell = el("span", { class: "swatch", title: `${sw.label}（${sw.hex}）` });
    cell.style.backgroundColor = sw.hex;
    cell.setAttribute("aria-hidden", "true");
    row.appendChild(cell);
  }
  return row;
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
  const t = TRANSLATIONS[currentLocale];
  const rows: Node[] = [];
  const line = (axis: string, resolved: string | undefined, raw: string | undefined): Node => {
    const label = el("span", { class: "axis-label", text: axis });
    const unresolvedText = raw
      ? currentLocale === "en"
        ? `Unresolved (input: ${raw})`
        : `未解決 (入力: ${raw})`
      : currentLocale === "en"
        ? "Not specified"
        : "未指定";
    const value = el("span", {
      class: resolved ? "axis-val resolved" : "axis-val unresolved",
      text: resolved ?? unresolvedText,
    });
    return el("div", { class: "axis-row" }, [label, value]);
  };
  const jsicBest = input.industry ? d.jsic.best : undefined;
  rows.push(
    line(
      currentLocale === "en" ? "Industry (JSIC)" : "業種 (JSIC)",
      jsicBest ? `${jsicBest.entry.code} ${jsicBest.entry.name}` : undefined,
      input.industry,
    ),
  );
  const colorBest = input.color ? d.color.best : undefined;
  rows.push(
    line(
      currentLocale === "en" ? "Color" : "カラー",
      colorBest
        ? `${colorBest.entry.slug} (${labelForColor(colorBest.entry.slug, taxonomy, currentLocale)})`
        : undefined,
      input.color,
    ),
  );
  const moodBest = input.mood ? d.mood.best : undefined;
  rows.push(
    line(
      currentLocale === "en" ? "Mood" : "ムード",
      moodBest
        ? `${moodBest.entry.slug} (${labelForMood(moodBest.entry.slug, taxonomy, currentLocale)})`
        : undefined,
      input.mood,
    ),
  );
  box.appendChild(el("h2", { class: "section-title", text: t.titleAxes }));
  box.appendChild(el("div", { class: "axes-grid" }, rows));

  const context = d.context;
  if (context) {
    // 解決した軸に対応する既存の実体化セルがあるか確認
    const hasExactMatch = allEntries.some(
      (m) => m.jsic === context.jsic && m.color === context.color && m.mood === context.mood,
    );

    const banner = el("div", { class: "virtual-action-container" });
    const p = el("p", {
      text: hasExactMatch
        ? currentLocale === "en"
          ? "This combination matches an existing materialized design cell in Git."
          : "この解決軸の組み合わせに対応する実体化セル（Git保存済み）が存在します。"
        : t.virtualPromptNotice,
    });
    banner.appendChild(p);

    const btn = el("button", {
      class: "primary select-btn virtual-btn",
      text: hasExactMatch
        ? currentLocale === "en"
          ? "View prompt →"
          : "プロンプトを表示 →"
        : t.virtualBtnText,
    });
    btn.type = "button";
    btn.addEventListener("click", () => {
      let entry = allEntries.find(
        (m) => m.jsic === context.jsic && m.color === context.color && m.mood === context.mood,
      );
      if (!entry) {
        entry = {
          id: `virtual_${context.jsic}_${context.color}_${context.mood}`,
          path: `design-md/${context.jsic}/${context.color}/${context.mood}/DESIGN.md`,
          jsic: context.jsic,
          color: context.color,
          mood: context.mood,
          title: `Virtual Design (${context.jsic} × ${context.color} × ${context.mood})`,
          hash: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
          createdAt: new Date().toISOString(),
          tags: context.tags || [],
        };
      }
      openDetail(entry, { scroll: true });
    });
    banner.appendChild(btn);
    box.appendChild(banner);
  }
}

/** 1 セルのカードを描画する。 */
function renderCard(entry: DesignIndexEntry): HTMLElement {
  const t = TRANSLATIONS[currentLocale];
  const meta = el("div", { class: "card-meta" }, [
    badge(currentLocale === "en" ? `JSIC ${entry.jsic}` : `業種 ${entry.jsic}`, "jsic"),
    badge(labelForColor(entry.color, taxonomy, currentLocale), "color"),
    badge(labelForMood(entry.mood, taxonomy, currentLocale), "mood"),
  ]);
  const tags = el(
    "div",
    { class: "card-tags" },
    (entry.tags ?? []).map((t) => {
      const span = el("span", { class: "tag" });
      appendHighlighted(span, t, highlightTerms);
      return span;
    }),
  );
  // タイトル/業種名は自由文の一致箇所を <mark> で強調する (highlightTerms が空なら素のテキスト)。
  const title = el("h3", { class: "card-title" });
  appendHighlighted(title, entry.title, highlightTerms);
  const industry = el("p", { class: "card-industry" });
  industry.appendChild(document.createTextNode(t.labelIndustryName));
  appendHighlighted(industry, jsicName(entry.jsic), highlightTerms);
  // カラースウォッチ (近似): DESIGN.md を取得せず slug からクライアントで配色を視覚化する。
  const swatches = swatchRow(
    approxSwatchesForColor(entry.color, currentLocale),
    t.labelColorPaletteApprox,
  );
  const select = el("button", { class: "select-btn", text: t.btnPromptCompose });
  select.type = "button";
  select.addEventListener("click", () => {
    void openDetail(entry);
  });
  return el("article", { class: "card" }, [title, industry, swatches, meta, tags, select]);
}

/** 検索結果 (カード一覧) を描画する。 */
function renderResults(matches: readonly DesignIndexEntry[]): void {
  const list = byId("results");
  list.replaceChildren();
  if (matches.length === 0) {
    list.appendChild(el("p", { class: "empty", text: TRANSLATIONS[currentLocale].emptyResults }));
    return;
  }
  for (const entry of matches) list.appendChild(renderCard(entry));
}

function getFallbackContext(decision: AxisDecision): AxisContext {
  const firstMatch = baseMatches[0];
  const jsic = decision.jsic.best?.entry.code || firstMatch?.jsic || "6061";
  const color = decision.color.best?.entry.slug || firstMatch?.color || "white";
  const mood = decision.mood.best?.entry.slug || firstMatch?.mood || "minimal";
  return { jsic, color, mood };
}

/** フォーム検索を実行し (ファセット母集合を再計算)、表示を更新する。 */
function runSearch(): void {
  const input = readSearchInput();
  lastRequest = input;
  highlightTerms = highlightTermsFromText(input.text);
  const result = searchCells(allEntries, input, taxonomy);
  lastSearchResult = result;
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

  const activeCellId = selectedCellId;
  if (activeCellId) {
    const entry = findEntryById(allEntries, activeCellId);
    if (entry) {
      void openDetail(entry, { scroll: false });
    }
  } else if (lastSearchResult?.decision) {
    const context =
      lastSearchResult.decision.context || getFallbackContext(lastSearchResult.decision);
    if (context) {
      const matchingEntry = allEntries.find(
        (m) => m.jsic === context.jsic && m.color === context.color && m.mood === context.mood,
      );
      if (matchingEntry) {
        void openDetail(matchingEntry, { scroll: false });
      } else {
        const virtualEntry: DesignIndexEntry = {
          id: `virtual_${context.jsic}_${context.color}_${context.mood}`,
          path: `design-md/${context.jsic}/${context.color}/${context.mood}/DESIGN.md`,
          jsic: context.jsic,
          color: context.color,
          mood: context.mood,
          tags: context.tags || [],
          title: `${jsicName(context.jsic) || context.jsic} × ${labelForColor(context.color, taxonomy)} × ${labelForMood(context.mood, taxonomy)}`,
          hash: "",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        void openDetail(virtualEntry, { scroll: false });
      }
    }
  }
}

/** 件数サマリを更新する。 */
function updateStatus(pg: Page<DesignIndexEntry>): void {
  const status = byId("status");
  status.className = "status";

  const totalEntries = allEntries.length;
  const statVal = document.getElementById("stat-materialized-count");
  if (statVal) {
    statVal.textContent =
      currentLocale === "en"
        ? `${totalEntries.toLocaleString()} designs`
        : `${totalEntries.toLocaleString()} 件`;
  }

  if (pg.total === 0) {
    status.textContent =
      currentLocale === "en"
        ? `0 / ${totalEntries.toLocaleString()} designs`
        : `0 / ${totalEntries.toLocaleString()} 件`;
    return;
  }
  const start = (pg.page - 1) * pg.pageSize + 1;
  const end = start + pg.items.length - 1;
  status.textContent =
    currentLocale === "en"
      ? `Matches: ${pg.total.toLocaleString()} / ${totalEntries.toLocaleString()} designs. Displaying ${start}–${end}`
      : `一致: ${pg.total.toLocaleString()} / ${totalEntries.toLocaleString()} 件中 ${start}–${end} を表示`;
}

/** ファセット (チップ群) を描画する。 */
function renderFacets(): void {
  const box = byId("facets");
  box.replaceChildren();
  const groups = computeFacetGroups(baseMatches, facetSelection, taxonomy, currentLocale);
  if (!groups.some((g) => g.items.length > 0)) return;

  const t = TRANSLATIONS[currentLocale];
  const head = el("div", { class: "facets-head" }, [
    el("h2", { class: "section-title", text: currentLocale === "en" ? "Filter" : "絞り込み" }),
  ]);
  if (hasAnyFacet(facetSelection)) {
    const clear = el("button", { class: "facet-clear", text: t.conditionClear });
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
    const moreText = expanded
      ? currentLocale === "en"
        ? "Close"
        : "閉じる"
      : currentLocale === "en"
        ? `Show ${group.items.length - FACET_COLLAPSE_LIMIT} more`
        : `他 ${group.items.length - FACET_COLLAPSE_LIMIT} 件を表示`;
    const more = el("button", {
      class: "facet-more",
      text: moreText,
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
  // カラー系統チップには代表色のスウォッチ (装飾) を添える。ラベルで系統名は読めるため
  // 見本は aria-hidden にし、スクリーンリーダーの二重読みを避ける。
  if (axis === "color") {
    const hex = familySwatchHex(item.value);
    if (hex) {
      const dot = el("span", { class: "chip-swatch" });
      dot.style.backgroundColor = hex;
      dot.setAttribute("aria-hidden", "true");
      chip.appendChild(dot);
    }
  }
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
  const prev = el("button", {
    class: "page-btn",
    text: currentLocale === "en" ? "← Prev" : "← 前へ",
  });
  prev.type = "button";
  prev.disabled = pg.page <= 1;
  prev.addEventListener("click", () => goToPage(pg.page - 1));
  const next = el("button", {
    class: "page-btn",
    text: currentLocale === "en" ? "Next →" : "次へ →",
  });
  next.type = "button";
  next.disabled = pg.page >= pg.pageCount;
  next.addEventListener("click", () => goToPage(pg.page + 1));
  const info = el("span", {
    class: "page-info",
    text:
      currentLocale === "en"
        ? `Page ${pg.page} of ${pg.pageCount}`
        : `${pg.page} / ${pg.pageCount} ページ`,
  });
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
  // 選択セルを反映 (共有可能なパーマリンク)。検索/ファセット状態と併存する。
  if (selectedCellId) params.set("cell", selectedCellId);
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
  // 選択セルは index 取込後に開くため、ここでは ID を控えておく。
  pendingCellId = parseCellParam(window.location.search);
}

/** 選択セルの詳細 (DESIGN.md 取得 → プロンプト合成 → コピー) を描画する。 */
async function openDetail(entry: DesignIndexEntry, opts: { scroll?: boolean } = {}): Promise<void> {
  const t = TRANSLATIONS[currentLocale];
  // 選択を状態と URL (?cell=<id>) に反映する (共有可能なパーマリンク)。
  selectedCellId = entry.id;
  syncUrl();

  const isVirtual = entry.id.startsWith("virtual_");

  const detail = byId("detail");
  detail.replaceChildren();
  detail.appendChild(
    el("h2", {
      class: "section-title",
      text: isVirtual
        ? `${t.detailVirtualTitle}${entry.title}`
        : currentLocale === "en"
          ? `Selected: ${entry.title}`
          : `選択: ${entry.title}`,
    }),
  );

  // 詳細先頭のアクションツールバー: セルのリンクコピーは即時、DESIGN.md コピーは取得後に足す。
  const actions = el("div", { class: "detail-actions" });
  actions.appendChild(
    copyButton(currentLocale === "en" ? "Copy cell link" : "このセルのリンクをコピー", () =>
      buildCellPermalink(window.location.href, entry.id),
    ),
  );
  detail.appendChild(actions);

  const info = el("p", {
    class: "detail-note",
    text: isVirtual ? t.detailVirtualLoading : t.detailLoadingMarkdown,
  });
  detail.appendChild(info);
  if (opts.scroll !== false) detail.scrollIntoView({ behavior: "smooth", block: "start" });

  let markdown: string | undefined = undefined;
  let hashVerified = false;

  if (!isVirtual) {
    const url = designRawUrl(entry);
    try {
      const res = await fetch(url, { cache: "no-cache" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      markdown = await res.text();

      // 本文取得に成功したので、DESIGN.md 本文コピーをツールバー先頭に足す (スクロール不要の位置)。
      actions.insertBefore(
        copyButton(
          currentLocale === "en" ? "Copy DESIGN.md" : "DESIGN.md をコピー",
          () => markdown || "",
        ),
        actions.firstChild,
      );

      try {
        const expected = entry.hash.replace(/^sha256:/i, "").toLowerCase();
        hashVerified = (await sha256Hex(markdown)) === expected;
      } catch {
        hashVerified = false;
      }
    } catch (err) {
      // Fallback to virtual prompt synthesis!
    }
  }

  const outputLanguage = byId<HTMLInputElement>("q-output-lang").value.trim();
  const prompt = composePromptForCell({
    entry,
    markdown,
    hashVerified,
    request: lastRequest,
    ...(outputLanguage ? { outputLanguage } : {}),
  });

  if (isVirtual || markdown === undefined) {
    info.className = "detail-note";
    info.textContent = t.virtualPromptNotice;
  } else {
    info.className = "detail-note";
    const provenanceLabel =
      currentLocale === "en"
        ? "Source: GoDD Design System (Pre-materialized) / "
        : "出所: GoDD デザインシステム (実体化済み) / ";
    const hashLabel = hashVerified
      ? currentLocale === "en"
        ? "Verified Hash OK"
        : "ハッシュ検証 OK"
      : currentLocale === "en"
        ? "Legacy / Unverified"
        : "レガシー / 未検証";
    info.replaceChildren(
      el("span", { text: provenanceLabel }),
      badge(hashLabel, hashVerified ? "ok" : "warn"),
    );
  }

  // カラーパレット: DESIGN.md の実トークン色を優先し、無ければ slug 由来の近似へフォールバック。
  const tokens = markdown !== undefined ? extractColorTokens(markdown, currentLocale) : [];
  const paletteHeading = tokens.length > 0 ? t.labelColorPaletteReal : t.labelColorPaletteApprox;
  const paletteSwatches =
    tokens.length > 0 ? tokens : approxSwatchesForColor(entry.color, currentLocale);
  detail.appendChild(
    el("section", { class: "block swatch-block" }, [
      el("div", { class: "block-head" }, [el("h3", { class: "sub-title", text: paletteHeading })]),
      swatchRow(paletteSwatches, paletteHeading),
    ]),
  );

  if (prompt.notices.length > 0) {
    const ul = el(
      "ul",
      { class: "notices" },
      prompt.notices.map((n) => el("li", { text: n })),
    );
    detail.appendChild(el("h3", { class: "sub-title", text: t.labelNotices }));
    detail.appendChild(ul);
  }

  detail.appendChild(
    promptBlock(
      currentLocale === "en" ? "Claude system prompt" : "Claude system プロンプト",
      prompt.systemPrompt,
      currentLocale === "en" ? "Copy system prompt" : "system プロンプトをコピー",
    ),
  );
  detail.appendChild(
    promptBlock(
      currentLocale === "en" ? "Claude user prompt" : "Claude user プロンプト",
      prompt.userPrompt,
      currentLocale === "en" ? "Copy user prompt" : "user プロンプトをコピー",
    ),
  );
  // DESIGN.md 本文はツールバーでコピーできるため、ここでは本文プレビューのみ (コピー重複を避ける)。
  if (markdown !== undefined) {
    detail.appendChild(
      previewBlock(currentLocale === "en" ? "DESIGN.md Preview" : "DESIGN.md 本文", markdown),
    );
  }
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

/** 見出し + <pre> のプレビューブロック (コピーボタンなし)。 */
function previewBlock(heading: string, content: string): HTMLElement {
  const head = el("div", { class: "block-head" }, [
    el("h3", { class: "sub-title", text: heading }),
  ]);
  const pre = el("pre", { class: "code" });
  pre.appendChild(el("code", { text: content }));
  return el("section", { class: "block" }, [head, pre]);
}

/**
 * DS taxonomy.json を取込む (フェイルセーフ)。
 * fetch 失敗・形状不正でも例外を投げず空 taxonomy を返し、slug/bundled 表示で動作継続する。
 */
async function loadTaxonomy(): Promise<Taxonomy> {
  try {
    const res = await fetch(DS_TAXONOMY_URL, { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return parseTaxonomy(await res.json());
  } catch {
    // taxonomy 未達は致命ではない (ラベル日本語化が効かないだけ)。画面は壊さない。
    return EMPTY_TAXONOMY;
  }
}

function initLocale(): void {
  const saved = localStorage.getItem("godd_locale");
  if (saved === "en" || saved === "ja") {
    currentLocale = saved;
  } else {
    const lang = navigator.language.slice(0, 2).toLowerCase();
    currentLocale = lang === "en" ? "en" : "ja";
  }
  const select = document.getElementById("locale-select") as HTMLSelectElement | null;
  if (select) select.value = currentLocale;
}

function translateUI(): void {
  const t = TRANSLATIONS[currentLocale];
  if (!t) return;

  document.title = t.labelHtmlTitle ?? "";
  document.documentElement.lang = currentLocale;

  const h1 = document.querySelector(".site-header h1");
  if (h1) h1.textContent = t.siteTitle ?? "";
  const lede = document.querySelector(".site-header .lede");
  if (lede) lede.textContent = t.siteDesc ?? "";

  const statTheo = document.getElementById("stat-label-theoretical");
  if (statTheo) statTheo.textContent = t.statTheoreticalLabel ?? "";
  const statTheoVal = document.getElementById("stat-value-theoretical");
  if (statTheoVal) statTheoVal.textContent = (172635600).toLocaleString();
  const statMat = document.getElementById("stat-label-materialized");
  if (statMat) statMat.textContent = t.statMaterializedLabel ?? "";

  const formTitle = document.querySelector("#search-form .section-title");
  if (formTitle) formTitle.textContent = t.searchTitle ?? "";

  const setLabelText = (id: string, text: string | undefined) => {
    const label = document.querySelector(`label[for="${id}"]`);
    if (label && text) label.textContent = text;
  };
  setLabelText("q-industry", t.labelIndustry);
  setLabelText("q-color", t.labelColor);
  setLabelText("q-mood", t.labelMood);
  setLabelText("q-tags", t.labelTags);
  setLabelText("q-text", t.labelText);
  setLabelText("q-output-lang", t.labelOutputLang);

  const setPlaceholder = (id: string, text: string | undefined) => {
    const input = document.getElementById(id) as HTMLInputElement | null;
    if (input && text) input.placeholder = text;
  };
  setPlaceholder("q-industry", t.placeholderIndustry);
  setPlaceholder("q-color", t.placeholderColor);
  setPlaceholder("q-mood", t.placeholderMood);
  setPlaceholder("q-tags", t.placeholderTags);
  setPlaceholder("q-text", t.placeholderText);
  setPlaceholder("q-output-lang", t.placeholderOutputLang);

  const hint = document.querySelector(".field-hint");
  if (hint) hint.textContent = t.hintOutputLang ?? "";

  const searchBtn = document.querySelector("#search-form button.primary");
  if (searchBtn) searchBtn.textContent = t.btnSearch ?? "";
  const resetBtn = document.getElementById("reset-btn");
  if (resetBtn) resetBtn.textContent = t.btnReset ?? "";

  const footerText = document.querySelector(".site-footer p");
  if (footerText) footerText.textContent = t.footerText ?? "";
}

/** index.json を取込んで初期表示する。taxonomy.json は並行取得 (フェイルセーフ)。 */
async function bootstrap(): Promise<void> {
  initLocale();
  translateUI();

  const status = byId("status");
  status.textContent = TRANSLATIONS[currentLocale].loadingIndex;
  // index (必須) と taxonomy (任意) を並行取得。taxonomy は失敗しても続行する。
  const taxonomyPromise = loadTaxonomy();
  try {
    const res = await fetch(DS_INDEX_URL, { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const index = parseDesignIndex(await res.text());
    allEntries = index.entries;
  } catch (err) {
    status.className = "error";
    status.textContent = `${TRANSLATIONS[currentLocale].errorIndex}${
      err instanceof Error ? err.message : String(err)
    }`;
    return;
  }
  taxonomy = await taxonomyPromise;
  restoreFromUrl();
  runSearch();
  // パーマリンク復元: URL に ?cell=<id> があれば該当セルを開く (プロンプト表示状態で復元)。
  if (pendingCellId) {
    const entry = findEntryById(allEntries, pendingCellId);
    pendingCellId = null;
    if (entry) void openDetail(entry, { scroll: false });
  }
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
  // id は "reset-btn"。フォーム内コントロールの id/name は `form.reset` 等の同名メソッドを
  // 隠す (DOM の名前衝突) ため、"reset" を避けて native な form.reset() を使えるようにする。
  byId<HTMLButtonElement>("reset-btn").addEventListener("click", () => {
    form.reset();
    facetSelection = { ...EMPTY_SELECTION };
    expandedFacets.clear();
    currentPage = 1;
    // 選択セルも解除し、詳細と URL の ?cell= を消す。
    selectedCellId = null;
    byId("detail").replaceChildren();
    runSearch();
  });
}

function wireLocaleToggle(): void {
  const select = document.getElementById("locale-select") as HTMLSelectElement | null;
  if (select) {
    select.addEventListener("change", () => {
      const val = select.value;
      if (val === "en" || val === "ja") {
        currentLocale = val;
        localStorage.setItem("godd_locale", val);
        translateUI();
        runSearch();
        if (selectedCellId) {
          const entry = findEntryById(allEntries, selectedCellId);
          if (entry) {
            void openDetail(entry, { scroll: false });
          }
        }
      }
    });
  }
}

wireForm();
wireLocaleToggle();
void bootstrap();

import type { DesignIndexEntry } from "../../src/ds/types.js";
import { categoryFromEntry, styleFromEntry } from "./catalog-coordinates.js";
import { applyCatalogUrlState, parseCatalogUrlState } from "./catalog-url-state.js";
import { editableSwatchesFromTokens, resolveDetailColorOverrides } from "./detail-color-state.js";
import {
  FILTER_CATEGORIES,
  FILTER_STYLES,
  INDUSTRY_VERTICALS,
  categoryLabel,
  styleLabel,
  toggleSelection,
  verticalLabel,
} from "./filter-taxonomy.js";
import { type IndexSummary, loadCatalogBootstrap } from "./index-loader.js";
import {
  COLOR_FAMILIES,
  EMPTY_TAXONOMY,
  type Locale,
  type Page,
  type Taxonomy,
  approxSwatchesForColor,
  colorFamily,
  composePromptForCell,
  dsIndexPageMirrorUrl,
  extractColorTokens,
  facetLabel,
  familySwatchHex,
  findEntryById,
  jsicMajor,
  jsicName,
  labelForColor,
  labelForMood,
  listJsicMajors,
} from "./lib.js";
import { renderMatchesCount } from "./matches-count.js";
import { loadMaterializedDesign } from "./materialized-design.js";
import {
  type PageSizeOption,
  buildDirectionTitle,
  buildEntryTags,
  clampPageSize,
  dedupeEntriesById,
} from "./result-card.js";
import type { ResultSortOrder } from "./result-sorting.js";
import { findColorValue, findStyleValue } from "./search-parser.js";
import { loadTaxonomy } from "./taxonomy-cache.js";
import { localizePromptPreview } from "./ui-localization.js";
import {
  decodeCatalogCursor,
  enrichWithMaterialized,
  pageVirtualCatalog,
  restoreCanonicalVirtualEntry,
} from "./virtual-catalog.js";
import { buildVirtualDesign } from "./virtual-design.js";

// DOM helper to build elements cleanly
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
  if (!node) throw new Error(`Element not found: #${id}`);
  return node as T;
}

const CATEGORIES = FILTER_CATEGORIES;
const STYLES = FILTER_STYLES;
const VERTICALS = INDUSTRY_VERTICALS;

const INDUSTRIES = listJsicMajors().map((m) => ({
  v: m.code,
  ja: m.label,
  en: m.label_en ?? m.label,
}));

const FONTS = [
  { v: "inter", ja: "Inter", en: "Inter" },
  { v: "poppins", ja: "Poppins", en: "Poppins" },
  { v: "playfair", ja: "Playfair Display", en: "Playfair Display" },
  { v: "jetbrains", ja: "JetBrains Mono", en: "JetBrains Mono" },
  { v: "noto", ja: "Noto Sans JP", en: "Noto Sans JP" },
  { v: "space", ja: "Space Grotesk", en: "Space Grotesk" },
];

// App States
let allEntries: readonly DesignIndexEntry[] = [];
/** 材化 index の summary（件数・ファセット）。entries 無しでも保持できる (issue #88)。 */
let indexSummary: IndexSummary | null = null;
let currentLocale: Locale = "ja";
let taxonomy: Taxonomy = EMPTY_TAXONOMY;
let searchQuery = "";
let sortOrder: ResultSortOrder = "popular";
let currentPage = 1;
let selectedEntry: DesignIndexEntry | null = null;
let detailReturnFocus: HTMLElement | null = null;
let detailRequestId = 0;
let pageSize: PageSizeOption = 25;

interface Filters {
  categories: string[];
  styles: string[];
  industries: string[];
  verticals: string[];
  colors: string[];
}
const filters: Filters = {
  categories: [],
  styles: [],
  industries: [],
  verticals: [],
  colors: [],
};

/** Last query-bound cursor written to the URL (0-based start rank). */
let currentCursor: string | null = null;
/** Detail-view color overrides (original → custom hex). */
let detailColorOverrides: string[] = [];
let detailBaseMarkdown = "";
let detailBaseSwatches: string[] = [];

// Deterministic property mapping from index entries to reference facets.
// Prefer published `canonicalCellId` (#272); keep legacy heuristics for older index rows.
function getEntryCategory(entry: DesignIndexEntry): string {
  return categoryFromEntry(entry, () => {
    const hash = (entry.id || "").charCodeAt(0) % CATEGORIES.length;
    return CATEGORIES[hash]?.v || "";
  });
}

function getEntryStyle(entry: DesignIndexEntry): string {
  return styleFromEntry(entry, () => {
    const mood = entry.mood;
    if (mood === "minimal") return "minimal";
    if (mood === "elegant") return "glass";
    if (mood === "bold") return "brutalist";
    if (mood === "brutalist") return "brutalist";
    if (mood === "tech") return "tech";
    if (mood === "organic") return "organic";
    if (mood === "warm") return "warm";
    if (mood === "vintage") return "retro";
    if (mood === "corporate") return "corporate";
    return "minimal";
  });
}

function getEntryMajor(entry: DesignIndexEntry): string {
  return jsicMajor(entry.jsic).code;
}

function isLocallyRendered(entry: DesignIndexEntry): boolean {
  // Prefer materialized bodies when enrichment attached a hash, even for virtual_* ids.
  return !entry.hash;
}

function syncBrowseUrl(cellId: string | null = selectedEntry?.id ?? null): void {
  const url = applyCatalogUrlState(window.location.href, {
    q: searchQuery,
    categories: filters.categories,
    styles: filters.styles,
    industries: filters.industries,
    verticals: filters.verticals,
    colors: filters.colors,
    sort: sortOrder,
    cursor: currentCursor,
    cell: cellId,
  });
  window.history.replaceState(null, "", url);
}

function addUnique(list: string[], value: string): string[] {
  return list.includes(value) ? list : [...list, value];
}

/** Resolve smart-search tokens + facet chips into a virtual-catalog query. */
function buildCatalogQuery(): {
  categories: string[];
  styles: string[];
  industries: string[];
  verticals: string[];
  colors: string[];
  industryTerms: string[];
  sort: ResultSortOrder;
} {
  let categories = [...filters.categories];
  let styles = [...filters.styles];
  let colors = [...filters.colors];
  const industryTerms: string[] = [];

  if (searchQuery) {
    const terms = searchQuery
      .toLowerCase()
      .split(/[\s、,]+/)
      .map((t) => t.trim())
      .filter((t) => t.length > 0);

    for (const term of terms) {
      const catMatch = findCategoryValue(term);
      if (catMatch) {
        categories = addUnique(categories, catMatch);
        continue;
      }
      const styleMatch = findStyleValue(term, taxonomy);
      if (styleMatch) {
        styles = addUnique(styles, styleMatch);
        continue;
      }
      const colorMatch = findColorValue(term, taxonomy);
      if (colorMatch) {
        colors = addUnique(colors, colorMatch);
        continue;
      }
      industryTerms.push(term);
    }
  }

  return {
    categories,
    styles,
    industries: [...filters.industries],
    verticals: [...filters.verticals],
    colors,
    industryTerms,
    sort: sortOrder,
  };
}

function normalizeHex(value: string): string | null {
  const trimmed = value.trim();
  const match = /^#?([0-9a-fA-F]{6})$/.exec(trimmed);
  if (!match?.[1]) return null;
  return `#${match[1].toLowerCase()}`;
}

function applyColorOverridesToMarkdown(
  markdown: string,
  originals: string[],
  overrides: string[],
): string {
  let next = markdown;
  for (let index = 0; index < originals.length; index++) {
    const from = originals[index];
    const to = overrides[index];
    if (!from || !to || from.toLowerCase() === to.toLowerCase()) continue;
    const pattern = new RegExp(from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    next = next.replace(pattern, to);
  }
  return next;
}

function setFilterDrawerOpen(open: boolean): void {
  const sidebar = byId("filter-sidebar");
  const backdrop = byId("filter-drawer-backdrop");
  const toggle = byId<HTMLButtonElement>("filter-toggle-btn");
  sidebar.classList.toggle("open", open);
  backdrop.classList.toggle("hidden", !open);
  toggle.setAttribute("aria-expanded", String(open));
  document.body.classList.toggle("filter-drawer-open", open);
}

function getEntryFont(entry: DesignIndexEntry): string {
  const hash = entry.id.charCodeAt(entry.id.length - 1) % FONTS.length;
  return FONTS[hash]?.v || "";
}

function getDownloadsCount(entry: DesignIndexEntry): number {
  let hash = 0;
  for (let i = 0; i < entry.id.length; i++) {
    hash = (hash * 31 + entry.id.charCodeAt(i)) | 0;
  }
  hash = Math.abs(hash);
  const u = (hash % 10000) / 10000;
  return Math.floor(150 + 800 / (u * 0.95 + 0.02) ** 1.8);
}

function formatDownloads(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

function getSwatchHexes(entry: DesignIndexEntry): string[] {
  const swatches = approxSwatchesForColor(entry.color);
  const c1 = swatches[0]?.hex || "#6366f1";
  const c2 = swatches[1]?.hex || c1;
  return [c1, c2];
}

function thumbnailBgFromHexes(colors: readonly string[]): string {
  const c1 = colors[0] || "#6366f1";
  const c2 = colors[1] || c1;
  return `repeating-linear-gradient(135deg, ${c1} 0px, ${c1} 22px, ${c2} 22px, ${c2} 44px)`;
}

function getThumbnailBg(entry: DesignIndexEntry): string {
  return thumbnailBgFromHexes(getSwatchHexes(entry));
}

function refreshDetailColors(): void {
  const previewBox = document.getElementById("detail-preview-box");
  if (previewBox) previewBox.style.background = thumbnailBgFromHexes(detailColorOverrides);
  const codeBlock = document.getElementById("detail-code-block");
  if (codeBlock && detailBaseMarkdown) {
    codeBlock.textContent = applyColorOverridesToMarkdown(
      detailBaseMarkdown,
      detailBaseSwatches,
      detailColorOverrides,
    );
  }
}

/** Compact visual palette for detail-color customization. */
const COLOR_PALETTE_PRESETS = [
  "#ffffff",
  "#f1f5f9",
  "#cbd5e1",
  "#64748b",
  "#1e293b",
  "#0f172a",
  "#000000",
  "#ef4444",
  "#f97316",
  "#eab308",
  "#84cc16",
  "#22c55e",
  "#14b8a6",
  "#06b6d4",
  "#3b82f6",
  "#6366f1",
  "#8b5cf6",
  "#a855f7",
  "#ec4899",
  "#f43f5e",
  "#78716c",
  "#a8a29e",
  "#fafaf9",
  "#7c2d12",
] as const;

function closeAllColorPalettes(except?: HTMLElement): void {
  for (const panel of document.querySelectorAll(".color-editor-palette.open")) {
    if (except && panel === except) continue;
    panel.classList.remove("open");
  }
}

function applyDetailColorAt(
  index: number,
  hex: string,
  targets: {
    swatch: HTMLElement;
    textInput: HTMLInputElement;
    colorInput: HTMLInputElement;
  },
): void {
  const normalized = normalizeHex(hex);
  if (!normalized) return;
  detailColorOverrides[index] = normalized;
  targets.swatch.style.backgroundColor = normalized;
  targets.textInput.value = normalized;
  targets.colorInput.value = normalized;
  refreshDetailColors();
}

function renderColorEditor(entry: DesignIndexEntry): void {
  const editor = byId("detail-color-editor");
  editor.replaceChildren();
  const labels = currentLocale === "ja" ? ["プライマリ", "アクセント"] : ["Primary", "Accent"];
  const customLabel = currentLocale === "ja" ? "カスタム…" : "Custom…";
  const openLabel = currentLocale === "ja" ? "カラーパレットを開く" : "Open color palette";

  detailColorOverrides.forEach((hex, index) => {
    const block = el("div", { class: "color-editor-block" });
    const row = el("div", { class: "color-editor-row" });
    const label = labels[index] ?? `Color ${index + 1}`;

    const swatchBtn = el("button", {
      class: "color-editor-swatch",
      title: openLabel,
    });
    swatchBtn.type = "button";
    swatchBtn.style.backgroundColor = hex;
    swatchBtn.setAttribute("aria-label", `${label}: ${openLabel}`);
    swatchBtn.setAttribute("aria-expanded", "false");
    swatchBtn.setAttribute("aria-haspopup", "dialog");

    const textInput = document.createElement("input");
    textInput.type = "text";
    textInput.className = "color-editor-input";
    textInput.value = hex;
    textInput.spellcheck = false;
    textInput.setAttribute("aria-label", `${label} (${entry.color})`);

    const colorInput = document.createElement("input");
    colorInput.type = "color";
    colorInput.className = "color-editor-native";
    colorInput.value = normalizeHex(hex) ?? "#6366f1";
    colorInput.setAttribute("aria-label", `${label}: ${customLabel}`);

    const palette = el("div", { class: "color-editor-palette" });
    palette.setAttribute("role", "dialog");
    palette.setAttribute(
      "aria-label",
      currentLocale === "ja" ? `${label}のカラーパレット` : `${label} color palette`,
    );

    const grid = el("div", { class: "color-editor-palette-grid" });
    for (const preset of COLOR_PALETTE_PRESETS) {
      const chip = el("button", { class: "color-editor-preset", title: preset });
      chip.type = "button";
      chip.style.backgroundColor = preset;
      chip.setAttribute("aria-label", preset);
      chip.onclick = () => {
        applyDetailColorAt(index, preset, { swatch: swatchBtn, textInput, colorInput });
        closeAllColorPalettes();
        swatchBtn.setAttribute("aria-expanded", "false");
      };
      grid.appendChild(chip);
    }

    const customBtn = el("button", {
      class: "color-editor-custom-btn",
      text: customLabel,
    });
    customBtn.type = "button";
    customBtn.onclick = () => {
      colorInput.click();
    };

    palette.append(grid, customBtn, colorInput);

    const setPaletteOpen = (open: boolean): void => {
      if (open) closeAllColorPalettes(palette);
      palette.classList.toggle("open", open);
      swatchBtn.setAttribute("aria-expanded", String(open));
    };

    swatchBtn.onclick = () => {
      setPaletteOpen(!palette.classList.contains("open"));
    };

    textInput.oninput = () => {
      applyDetailColorAt(index, textInput.value, { swatch: swatchBtn, textInput, colorInput });
    };
    colorInput.oninput = () => {
      applyDetailColorAt(index, colorInput.value, { swatch: swatchBtn, textInput, colorInput });
    };
    colorInput.onchange = () => {
      applyDetailColorAt(index, colorInput.value, { swatch: swatchBtn, textInput, colorInput });
      setPaletteOpen(false);
    };

    row.append(swatchBtn, textInput);
    block.append(row, palette);
    editor.appendChild(block);
  });
}

function renderThumbnail(entry: DesignIndexEntry, container: HTMLElement): void {
  const colors = getSwatchHexes(entry);
  const primaryColor = colors[0] || "#6366f1";
  const accentColor = colors[1] || primaryColor;
  const isDark = entry.mood === "dark" || entry.mood === "futuristic" || entry.mood === "brutalist";

  const bg = isDark ? "#16171f" : "#f8f9fa";
  const border = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.05)";
  const muted = isDark ? "rgba(255,255,255,0.2)" : "rgba(0,0,0,0.15)";
  const cardBg = isDark ? "rgba(255,255,255,0.03)" : "#ffffff";

  container.replaceChildren();
  container.style.background = bg;
  container.style.display = "flex";
  container.style.flexDirection = "column";
  container.style.gap = "8px";
  container.style.padding = "12px";
  container.style.height = "100%";
  container.style.width = "100%";
  container.style.boxSizing = "border-box";
  container.style.overflow = "hidden";
  container.style.position = "relative";

  // Header Bar
  const header = el("span");
  header.style.display = "flex";
  header.style.justifyContent = "space-between";
  header.style.alignItems = "center";
  header.style.borderBottom = `1px solid ${border}`;
  header.style.paddingBottom = "6px";

  const dot = el("span");
  dot.style.width = "8px";
  dot.style.height = "8px";
  dot.style.borderRadius = "50%";
  dot.style.background = primaryColor;
  header.appendChild(dot);

  const right = el("span");
  right.style.display = "flex";
  right.style.gap = "4px";
  for (let i = 0; i < 3; i++) {
    const line = el("span");
    line.style.width = "12px";
    line.style.height = "2px";
    line.style.background = muted;
    right.appendChild(line);
  }
  header.appendChild(right);
  container.appendChild(header);

  // Content Area
  const body = el("span");
  body.style.display = "flex";
  body.style.gap = "8px";
  body.style.flex = "1";

  const sidebar = el("span");
  sidebar.style.width = "16px";
  sidebar.style.background = isDark ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.02)";
  sidebar.style.borderRadius = "4px";
  sidebar.style.padding = "4px";
  sidebar.style.display = "flex";
  sidebar.style.flexDirection = "column";
  sidebar.style.gap = "4px";
  for (let i = 0; i < 3; i++) {
    const item = el("span");
    item.style.height = "3px";
    item.style.background = i === 0 ? accentColor : muted;
    item.style.borderRadius = "1px";
    sidebar.appendChild(item);
  }
  body.appendChild(sidebar);

  const main = el("span");
  main.style.flex = "1";
  main.style.display = "flex";
  main.style.flexDirection = "column";
  main.style.gap = "6px";

  const mockCard = el("span");
  mockCard.style.flex = "1";
  mockCard.style.background = cardBg;
  mockCard.style.border = `1px solid ${border}`;
  mockCard.style.borderRadius = "4px";
  mockCard.style.padding = "6px";
  mockCard.style.display = "flex";
  mockCard.style.flexDirection = "column";
  mockCard.style.justifyContent = "space-between";

  const topBar = el("span");
  topBar.style.width = "50%";
  topBar.style.height = "3px";
  topBar.style.background = primaryColor;
  topBar.style.borderRadius = "1px";
  mockCard.appendChild(topBar);

  const btn = el("span");
  btn.style.width = "30px";
  btn.style.height = "10px";
  btn.style.background = accentColor;
  btn.style.borderRadius = "3px";
  mockCard.appendChild(btn);

  main.appendChild(mockCard);
  body.appendChild(main);
  container.appendChild(body);
}

// Translations Structure
interface TranslationKeys {
  siteTitle: string;
  siteDescription: string;
  brandTitle: string;
  localeLabel: string;
  labelSidebarTitle: string;
  labelPageSize: string;
  pagerLabel: string;
  previewLabel: string;
  footerText: string;
  brandSubtitle: string;
  placeholderSearch: string;
  labelFacetCategory: string;
  labelFacetStyle: string;
  labelFacetIndustry: string;
  labelFacetVerticals: string;
  labelFacetIndustryMajor: string;
  labelFacetColor: string;
  labelColorCustomize: string;
  labelFilterToggle: string;
  labelFilterClose: string;
  labelScrollGroup: string;
  labelScrollTop: string;
  labelScrollBottom: string;
  labelActivePills: string;
  clearAll: string;
  labelMatches: string;
  btnPopular: string;
  btnNewest: string;
  detailBack: string;
  labelCodePreview: string;
  labelDownloads: string;
  labelUpdated: string;
  labelLicense: string;
  fileTypeLabel: string;
  btnDownload: string;
  btnCopy: string;
  btnShare: string;
  labelRelated: string;
  toastCopied: string;
  toastShareCopied: string;
  toastDownloadStarted: string;
  toastCopyFailed: string;
  sampleCount: (shown: number, total: number) => string;
  detailLoading: string;
  detailLoadError: string;
}

const TRANSLATIONS: Record<Locale, TranslationKeys> = {
  ja: {
    siteTitle: "DESIGN.md Library",
    siteDescription: "1億件以上のDESIGNファイルを検索・共有",
    brandTitle: "GoDD Matrix",
    localeLabel: "言語",
    labelSidebarTitle: "フィルタ",
    labelPageSize: "表示件数",
    pagerLabel: "ページ送り",
    previewLabel: "プレビュー",
    footerText: "データ提供元: GoDD Design System 公開コーパス（ブラウザから取得）",
    brandSubtitle: "DESIGN.md を探してカスタマイズ",
    placeholderSearch: "検索例: ゲーム ミニマル ダッシュボード",
    labelFacetCategory: "カテゴリ",
    labelFacetStyle: "スタイル",
    labelFacetIndustry: "業種 / 職種",
    labelFacetVerticals: "職種・業態",
    labelFacetIndustryMajor: "業種（大分類）",
    labelFacetColor: "会社ロゴの色合い",
    labelColorCustomize: "カラー調整",
    labelFilterToggle: "フィルタ",
    labelFilterClose: "フィルタを閉じる",
    labelScrollGroup: "ページ内移動",
    labelScrollTop: "最上部へ",
    labelScrollBottom: "最下部へ",
    labelActivePills: "適用中:",
    clearAll: "すべてクリア",
    labelMatches: "件が一致",
    btnPopular: "人気順",
    btnNewest: "新着順",
    detailBack: "← 検索に戻る",
    labelCodePreview: "DESIGN.md プレビュー",
    labelDownloads: "提供形式",
    labelUpdated: "更新日",
    labelLicense: "ライセンス",
    fileTypeLabel: "DESIGN.md",
    btnDownload: "ダウンロード",
    btnCopy: "コピー",
    btnShare: "共有リンク",
    labelRelated: "関連するDESIGNファイル",
    toastCopied: "Markdownをクリップボードにコピーしました",
    toastShareCopied: "共有リンクをコピーしました",
    toastDownloadStarted: "ダウンロードを開始しました",
    toastCopyFailed: "コピーに失敗しました",
    sampleCount: (shown, total) => `${total.toLocaleString("ja-JP")}件中 ${shown}件を表示中`,
    detailLoading: "DESIGN.md を読み込んでいます...",
    detailLoadError: "DESIGN.md の読み込みに失敗しました。時間をおいて再度お試しください。",
  },
  en: {
    siteTitle: "DESIGN.md Library",
    siteDescription: "Search and share more than 100 million DESIGN files",
    brandTitle: "GoDD Matrix",
    localeLabel: "Language",
    labelSidebarTitle: "Filters",
    labelPageSize: "Results per page",
    pagerLabel: "Pagination",
    previewLabel: "Preview",
    footerText: "Data source: GoDD Design System public corpus (fetched client-side)",
    brandSubtitle: "Find and customize DESIGN.md",
    placeholderSearch: "Search e.g. 'game minimal dashboard'",
    labelFacetCategory: "Category",
    labelFacetStyle: "Style",
    labelFacetIndustry: "Industry / Job",
    labelFacetVerticals: "Job / vertical",
    labelFacetIndustryMajor: "Industry (division)",
    labelFacetColor: "Brand / logo color",
    labelColorCustomize: "Customize colors",
    labelFilterToggle: "Filters",
    labelFilterClose: "Close filters",
    labelScrollGroup: "Page navigation",
    labelScrollTop: "Go to top",
    labelScrollBottom: "Go to bottom",
    labelActivePills: "Active:",
    clearAll: "Clear all",
    labelMatches: "files match",
    btnPopular: "Popular",
    btnNewest: "Newest",
    detailBack: "← Back to search",
    labelCodePreview: "DESIGN.md Preview",
    labelDownloads: "Type",
    labelUpdated: "Updated",
    labelLicense: "License",
    fileTypeLabel: "DESIGN.md",
    btnDownload: "Download",
    btnCopy: "Copy",
    btnShare: "Share",
    labelRelated: "Related files",
    toastCopied: "Markdown copied to clipboard",
    toastShareCopied: "Share link copied to clipboard",
    toastDownloadStarted: "Download started",
    toastCopyFailed: "Copy failed",
    sampleCount: (shown, total) => `Showing ${shown} of ${total.toLocaleString("en-US")} results`,
    detailLoading: "Loading DESIGN.md...",
    detailLoadError: "Failed to load DESIGN.md. Please try again later.",
  },
};

// Toast notification trigger
function showToast(msg: string): void {
  const toast = byId("toast");
  toast.textContent = msg;
  toast.classList.add("show");
  window.setTimeout(() => {
    toast.classList.remove("show");
  }, 2200);
}

// Copy helper
function copyText(text: string, toastMsg: string): void {
  navigator.clipboard
    .writeText(text)
    .then(() => showToast(toastMsg))
    .catch(() => {
      // Fallback
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.top = "-1000px";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        showToast(toastMsg);
      } catch {
        showToast(TRANSLATIONS[currentLocale].toastCopyFailed);
      }
      document.body.removeChild(ta);
    });
}

// Dynamic UI Text Localization updates
function translateUI(): void {
  const t = TRANSLATIONS[currentLocale];
  document.title = `GoDD Matrix — ${t.siteTitle}`;
  document.documentElement.lang = currentLocale;
  document
    .querySelector<HTMLMetaElement>('meta[name="description"]')
    ?.setAttribute("content", t.siteDescription);
  byId("locale-select").setAttribute("aria-label", t.localeLabel);
  byId("label-locale-visible").textContent = t.localeLabel;
  byId("label-brand-title").textContent = t.brandTitle;
  byId("label-sidebar-title").textContent = t.labelSidebarTitle;
  byId("label-page-size").textContent = t.labelPageSize;
  byId("page-size-select").setAttribute("aria-label", t.labelPageSize);
  byId("pager-top").setAttribute("aria-label", t.pagerLabel);
  byId("pager-bottom").setAttribute("aria-label", t.pagerLabel);
  byId("scroll-fabs").setAttribute("aria-label", t.labelScrollGroup);
  byId("scroll-top-btn").setAttribute("aria-label", t.labelScrollTop);
  byId("scroll-top-btn").title = t.labelScrollTop;
  byId("scroll-bottom-btn").setAttribute("aria-label", t.labelScrollBottom);
  byId("scroll-bottom-btn").title = t.labelScrollBottom;
  byId("label-preview-overlay").textContent = t.previewLabel;
  byId("label-footer").textContent = t.footerText;

  byId("label-brand-subtitle").textContent = t.brandSubtitle;
  const searchInput = byId<HTMLInputElement>("main-search-input");
  searchInput.placeholder = t.placeholderSearch;
  searchInput.setAttribute("aria-label", t.placeholderSearch);

  byId("label-facet-category").textContent = t.labelFacetCategory;
  byId("label-facet-style").textContent = t.labelFacetStyle;
  byId("label-facet-industry").textContent = t.labelFacetIndustry;
  byId("label-facet-verticals").textContent = t.labelFacetVerticals;
  byId("label-facet-industry-major").textContent = t.labelFacetIndustryMajor;
  byId("label-facet-color").textContent = t.labelFacetColor;
  byId("label-color-customize").textContent = t.labelColorCustomize;
  byId("filter-toggle-btn").textContent = t.labelFilterToggle;
  byId("filter-close-btn").setAttribute("aria-label", t.labelFilterClose);
  byId("label-active-pills").textContent = t.labelActivePills;
  byId("clear-all-btn").textContent = t.clearAll;
  byId("label-matches-count").textContent = t.labelMatches;
  byId("sort-btn-popular").textContent = t.btnPopular;
  byId("sort-btn-newest").textContent = t.btnNewest;

  byId("back-btn").textContent = t.detailBack;
  byId("label-code-preview").textContent = t.labelCodePreview;
  byId("label-meta-downloads").textContent = t.labelDownloads;
  byId("label-meta-updated").textContent = t.labelUpdated;
  byId("label-meta-license").textContent = t.labelLicense;
  byId("btn-download").textContent = t.btnDownload;
  byId("btn-copy").textContent = t.btnCopy;
  byId("btn-share").textContent = t.btnShare;
  byId("label-related-title").textContent = t.labelRelated;
}

// Build and trigger file download
function downloadMarkdown(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast(TRANSLATIONS[currentLocale].toastDownloadStarted);
}

function renderVirtualDesign(entry: DesignIndexEntry, locale: Locale): string {
  const major = jsicMajor(entry.jsic);
  const industry =
    locale === "ja"
      ? jsicName(entry.jsic) || entry.jsic
      : major.label_en || major.label || entry.jsic;
  return buildVirtualDesign(entry, locale, {
    title: buildDirectionTitle(entry, locale, taxonomy),
    industry,
    color: labelForColor(entry.color, taxonomy, locale),
    mood: labelForMood(entry.mood, taxonomy, locale),
    swatches: getSwatchHexes(entry),
  });
}

// Render the detailed view of a resolved specification
async function openDetail(
  entry: DesignIndexEntry,
  opts: { scroll?: boolean; focus?: boolean; preserveColors?: boolean } = {},
): Promise<void> {
  const requestId = ++detailRequestId;
  selectedEntry = entry;

  // Transition views
  byId("search-view").classList.add("hidden");
  const detailView = byId("detail-view");
  detailView.classList.remove("hidden");
  if (opts.scroll !== false) window.scrollTo(0, 0);
  if (opts.focus !== false) byId<HTMLButtonElement>("back-btn").focus();

  // Sync URL permalink
  syncBrowseUrl(entry.id);

  // Resolve detailed fields
  const cLabel = CATEGORIES.find((c) => c.v === getEntryCategory(entry));
  const sLabel = STYLES.find((s) => s.v === getEntryStyle(entry));
  const iLabel = INDUSTRIES.find((i) => i.v === getEntryMajor(entry));
  const fLabel = FONTS.find((f) => f.v === getEntryFont(entry));

  const categoryText = cLabel ? (currentLocale === "ja" ? cLabel.ja : cLabel.en) : "";
  const styleText = sLabel ? (currentLocale === "ja" ? sLabel.ja : sLabel.en) : "";
  const industryText = iLabel ? (currentLocale === "ja" ? iLabel.ja : iLabel.en) : "";
  const fontText = fLabel ? (currentLocale === "ja" ? fLabel.ja : fLabel.en) : "";

  // Title & Filename
  const mainTitle = buildDirectionTitle(entry, currentLocale, taxonomy);
  const subTitle = buildEntryTags(entry, currentLocale, taxonomy)
    .map((tag) => tag.label)
    .join(" · ");
  byId("detail-filename").textContent = `${entry.id}.design.md`;
  byId("detail-title-ja").textContent = mainTitle;
  byId("detail-title-en").textContent = subTitle;

  // Description text
  if (currentLocale === "ja") {
    byId("detail-desc-ja").textContent =
      `業種コード ${entry.jsic} （${jsicName(entry.jsic) || "不明"}）における、カラー「${labelForColor(entry.color, taxonomy, "ja")}」とムード「${labelForMood(entry.mood, taxonomy, "ja")}」のデザイン仕様書。`;
    byId("detail-desc-ja").classList.remove("hidden");
    byId("detail-desc-en").classList.add("hidden");
  } else {
    const major = jsicMajor(entry.jsic);
    byId("detail-desc-en").textContent =
      `Design specification matching industry code ${entry.jsic} (${major.label_en || jsicName(entry.jsic) || "Unknown"}), color tone "${labelForColor(entry.color, taxonomy, "en")}", and design mood "${labelForMood(entry.mood, taxonomy, "en")}".`;
    byId("detail-desc-en").classList.remove("hidden");
    byId("detail-desc-ja").classList.add("hidden");
  }

  detailBaseSwatches = getSwatchHexes(entry);
  // Locale re-render must keep user-selected colors; only reset on fresh open.
  detailColorOverrides = resolveDetailColorOverrides(
    detailBaseSwatches,
    detailColorOverrides,
    opts.preserveColors,
  );
  renderColorEditor(entry);

  // Draw metadata badges
  const badgeBox = byId("detail-badges");
  badgeBox.replaceChildren();
  if (categoryText) badgeBox.appendChild(el("span", { class: "badge-tag", text: categoryText }));
  if (styleText) badgeBox.appendChild(el("span", { class: "badge-tag", text: styleText }));
  if (industryText) badgeBox.appendChild(el("span", { class: "badge-tag", text: industryText }));
  if (fontText) badgeBox.appendChild(el("span", { class: "badge-tag", text: fontText }));

  const previewBox = byId("detail-preview-box");
  previewBox.style.background = thumbnailBgFromHexes(detailColorOverrides);

  const isVirtual = isLocallyRendered(entry);

  const t = TRANSLATIONS[currentLocale];
  byId("detail-downloads-val").textContent = t.fileTypeLabel;
  byId("detail-updated-val").textContent = entry.createdAt
    ? entry.createdAt.slice(0, 10)
    : "2026-07-20";
  byId("detail-license-val").textContent = "MIT";

  const codeBlock = byId("detail-code-block");
  const loadStatus = byId("detail-load-status");
  const downloadButton = byId<HTMLButtonElement>("btn-download");
  const copyButton = byId<HTMLButtonElement>("btn-copy");
  const relatedGrid = byId("related-grid");
  downloadButton.disabled = true;
  copyButton.disabled = true;
  codeBlock.setAttribute("aria-busy", "true");
  codeBlock.textContent = t.detailLoading;
  loadStatus.textContent = t.detailLoading;
  relatedGrid.replaceChildren();

  let renderedMarkdown: string;
  let hashVerified: boolean;
  if (isVirtual) {
    renderedMarkdown = renderVirtualDesign(entry, currentLocale);
    hashVerified = false;
  } else {
    try {
      const materialized = await loadMaterializedDesign(entry);
      if (requestId !== detailRequestId) return;
      renderedMarkdown = materialized.markdown;
      hashVerified = materialized.hashVerified;
    } catch (error) {
      if (requestId !== detailRequestId) return;
      console.error("Failed to load DESIGN.md:", error);
      codeBlock.setAttribute("aria-busy", "false");
      codeBlock.textContent = t.detailLoadError;
      loadStatus.textContent = t.detailLoadError;
      downloadButton.onclick = null;
      copyButton.onclick = null;
      byId("btn-share").onclick = () => copyText(window.location.href, t.toastShareCopied);
      return;
    }
  }

  const prompt = composePromptForCell({
    entry,
    markdown: renderedMarkdown,
    hashVerified,
    ...(isVirtual ? { resolutionStatus: "rendered" as const } : {}),
    ...(currentLocale === "en"
      ? { request: { industry: jsicMajor(entry.jsic).label_en || entry.jsic } }
      : {}),
    outputLanguage: currentLocale === "ja" ? "日本語" : "English",
  });

  detailBaseMarkdown = localizePromptPreview(prompt, currentLocale);

  // Materialized bodies use real token hexes; approx swatches would make overrides a no-op.
  if (!isVirtual) {
    const tokenSwatches = editableSwatchesFromTokens(
      extractColorTokens(renderedMarkdown, currentLocale),
      detailBaseSwatches,
    );
    detailBaseSwatches = tokenSwatches;
    detailColorOverrides = resolveDetailColorOverrides(
      tokenSwatches,
      detailColorOverrides,
      opts.preserveColors,
    );
    renderColorEditor(entry);
    previewBox.style.background = thumbnailBgFromHexes(detailColorOverrides);
  }

  const finalMarkdown = applyColorOverridesToMarkdown(
    detailBaseMarkdown,
    detailBaseSwatches,
    detailColorOverrides,
  );
  codeBlock.setAttribute("aria-busy", "false");
  codeBlock.textContent = finalMarkdown;
  loadStatus.textContent = "";

  const currentMarkdown = () =>
    applyColorOverridesToMarkdown(detailBaseMarkdown, detailBaseSwatches, detailColorOverrides);

  downloadButton.disabled = false;
  copyButton.disabled = false;
  downloadButton.onclick = () => downloadMarkdown(`${entry.id}.design.md`, currentMarkdown());
  copyButton.onclick = () => copyText(currentMarkdown(), t.toastCopied);
  byId("btn-share").onclick = () => copyText(window.location.href, t.toastShareCopied);

  // Load related design entries
  const relatedList = allEntries
    .filter((e) => e.id !== entry.id && (e.mood === entry.mood || e.jsic === entry.jsic))
    .slice(0, 4);

  for (const item of relatedList) {
    const card = el("button", { class: "related-card" });
    card.type = "button";
    card.onclick = () => {
      void openDetail(item);
    };

    const thumb = el("span", { class: "related-thumb" });
    renderThumbnail(item, thumb);
    thumb.appendChild(el("span", { class: "preview-overlay", text: t.previewLabel }));
    card.appendChild(thumb);

    const body = el("span", { class: "related-body" });
    body.appendChild(
      el("span", {
        class: "related-card-title-ja",
        text: buildDirectionTitle(item, currentLocale, taxonomy),
      }),
    );
    body.appendChild(
      el("span", {
        class: "related-card-title-en",
        text: `${item.jsic} · ${labelForColor(item.color, taxonomy, currentLocale)} · ${labelForMood(item.mood, taxonomy, currentLocale)}`,
      }),
    );
    card.appendChild(body);

    relatedGrid.appendChild(card);
  }
}

function appendCheckboxOption(
  list: HTMLElement,
  options: {
    value: string;
    label: string;
    checked: boolean;
    title?: string;
    onToggle: () => void;
  },
): void {
  const label = el("label", { class: "facet-checkbox" });
  if (options.title) label.title = options.title;
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = options.checked;
  input.onchange = () => {
    options.onToggle();
    currentPage = 1;
    applyState();
  };
  label.append(input, document.createTextNode(options.label));
  list.appendChild(label);
}

/** Render multi-select filter options inside accordion panels. */
function renderFilters(): void {
  const verticalList = byId("facet-list-verticals");
  verticalList.replaceChildren();
  for (const vertical of VERTICALS) {
    appendCheckboxOption(verticalList, {
      value: vertical.v,
      label: verticalLabel(vertical.v, currentLocale),
      checked: filters.verticals.includes(vertical.v),
      onToggle: () => {
        filters.verticals = toggleSelection(filters.verticals, vertical.v);
      },
    });
  }

  const indList = byId("facet-list-industry");
  indList.replaceChildren();
  for (const industry of INDUSTRIES) {
    const label = currentLocale === "ja" ? industry.ja : industry.en;
    appendCheckboxOption(indList, {
      value: industry.v,
      label,
      title: `${industry.v}: ${label}`,
      checked: filters.industries.includes(industry.v),
      onToggle: () => {
        filters.industries = toggleSelection(filters.industries, industry.v);
      },
    });
  }

  const colorList = byId("facet-list-color");
  colorList.replaceChildren();
  for (const family of COLOR_FAMILIES) {
    const active = filters.colors.includes(family.key);
    const label = facetLabel("color", family.key, taxonomy, currentLocale);
    const chip = el("button", {
      class: `color-family-btn ${active ? "selected" : ""}`,
      title: label,
    });
    chip.type = "button";
    const swatch = el("span", { class: "swatch" });
    swatch.style.backgroundColor = familySwatchHex(family.key) ?? "#94a3b8";
    chip.append(swatch, document.createTextNode(label));
    chip.onclick = () => {
      filters.colors = toggleSelection(filters.colors, family.key);
      currentPage = 1;
      applyState();
    };
    colorList.appendChild(chip);
  }

  const catList = byId("facet-list-category");
  catList.replaceChildren();
  for (const category of CATEGORIES) {
    appendCheckboxOption(catList, {
      value: category.v,
      label: categoryLabel(category.v, currentLocale),
      checked: filters.categories.includes(category.v),
      onToggle: () => {
        filters.categories = toggleSelection(filters.categories, category.v);
      },
    });
  }

  const styleList = byId("facet-list-style");
  styleList.replaceChildren();
  for (const style of STYLES) {
    appendCheckboxOption(styleList, {
      value: style.v,
      label: styleLabel(style.v, currentLocale),
      checked: filters.styles.includes(style.v),
      onToggle: () => {
        filters.styles = toggleSelection(filters.styles, style.v);
      },
    });
  }
}

function findCategoryValue(term: string): string | null {
  const t = term.toLowerCase();
  for (const c of CATEGORIES) {
    if (c.v === t || c.ja.includes(t) || c.en.toLowerCase().includes(t)) {
      return c.v;
    }
  }
  return null;
}

// Apply states, filter lists, and render UI
function applyState(): void {
  renderFilters();

  const catalogPage = pageVirtualCatalog(buildCatalogQuery(), {
    pageSize,
    page: currentPage,
  });

  const pageItems = dedupeEntriesById(
    catalogPage.items.map((entry) => enrichWithMaterialized(entry, allEntries)),
  );
  const pageView: Page<DesignIndexEntry> = {
    items: pageItems,
    page: catalogPage.page,
    pageCount: catalogPage.pageCount,
    total: catalogPage.total,
    pageSize: catalogPage.pageSize,
  };
  const totalMatches = catalogPage.total;
  currentPage = pageView.page;
  currentCursor = catalogPage.cursor;
  if (!selectedEntry) {
    syncBrowseUrl(null);
  }

  // Render Pills Bar
  const pillsBar = byId("active-pills-bar");
  const pillsContainer = byId("pills-container");
  pillsContainer.replaceChildren();

  const pills: Array<{ label: string; clear: () => void }> = [];
  if (searchQuery) {
    pills.push({
      label: `${currentLocale === "ja" ? "検索" : "Search"}: ${searchQuery}`,
      clear: () => {
        searchQuery = "";
        byId<HTMLInputElement>("main-search-input").value = "";
        applyState();
      },
    });
  }
  for (const value of filters.verticals) {
    pills.push({
      label: verticalLabel(value, currentLocale),
      clear: () => {
        filters.verticals = filters.verticals.filter((item) => item !== value);
        applyState();
      },
    });
  }
  for (const value of filters.industries) {
    const industry = INDUSTRIES.find((item) => item.v === value);
    pills.push({
      label: industry ? (currentLocale === "ja" ? industry.ja : industry.en) : value,
      clear: () => {
        filters.industries = filters.industries.filter((item) => item !== value);
        applyState();
      },
    });
  }
  for (const value of filters.colors) {
    pills.push({
      label: facetLabel("color", value, taxonomy, currentLocale),
      clear: () => {
        filters.colors = filters.colors.filter((item) => item !== value);
        applyState();
      },
    });
  }
  for (const value of filters.categories) {
    pills.push({
      label: categoryLabel(value, currentLocale),
      clear: () => {
        filters.categories = filters.categories.filter((item) => item !== value);
        applyState();
      },
    });
  }
  for (const value of filters.styles) {
    pills.push({
      label: styleLabel(value, currentLocale),
      clear: () => {
        filters.styles = filters.styles.filter((item) => item !== value);
        applyState();
      },
    });
  }

  if (pills.length > 0) {
    pillsBar.classList.remove("hidden");
    for (const p of pills) {
      const pill = el("button", { class: "pill-btn", text: `${p.label} ×` });
      pill.onclick = p.clear;
      pillsContainer.appendChild(pill);
    }
  } else {
    pillsBar.classList.add("hidden");
  }

  // Exact integer display
  renderMatchesCount(
    byId("matches-count-display"),
    document,
    totalMatches,
    currentLocale,
    TRANSLATIONS[currentLocale].labelMatches,
  );

  // Exact sample counts matching the pagination grid display
  const itemsCount = pageView.items.length;
  byId("sample-count-display").textContent = TRANSLATIONS[currentLocale].sampleCount(
    itemsCount,
    totalMatches,
  );

  // Draw Candidates Grid
  const resultsGrid = byId("results");
  resultsGrid.replaceChildren();

  if (pageView.items.length === 0) {
    resultsGrid.appendChild(
      el("div", {
        class: "no-results-msg",
        text:
          currentLocale === "ja"
            ? "条件に一致するファイルが見つかりません。フィルタを調整してください。"
            : "No matching files found. Adjust your filters.",
      }),
    );
  } else {
    for (const entry of pageView.items) {
      const card = el("button", { class: "card" });
      card.type = "button";
      card.onclick = () => {
        detailReturnFocus = card;
        void openDetail(entry);
      };

      const thumb = el("span", { class: "card-thumbnail" });
      renderThumbnail(entry, thumb);
      thumb.appendChild(
        el("span", { class: "preview-overlay", text: TRANSLATIONS[currentLocale].previewLabel }),
      );
      card.appendChild(thumb);

      const body = el("span", { class: "card-body" });
      body.appendChild(
        el("span", {
          class: "card-title-ja",
          text: buildDirectionTitle(entry, currentLocale, taxonomy),
        }),
      );

      const tags = buildEntryTags(entry, currentLocale, taxonomy);
      const tagRow = el("span", { class: "card-tags" });
      for (const tag of tags) {
        const node = el("span", { class: "card-tag", text: tag.label });
        node.dataset.kind = tag.kind;
        node.title = tag.label;
        tagRow.appendChild(node);
      }
      body.appendChild(tagRow);

      card.appendChild(body);
      resultsGrid.appendChild(card);
    }
  }

  // Draw Pager
  renderPager(pageView);
}

function fillPager(pager: HTMLElement, pg: Page<DesignIndexEntry>): void {
  pager.replaceChildren();

  const prev = el("button", { text: currentLocale === "ja" ? "前へ" : "Prev" });
  prev.type = "button";
  prev.disabled = pg.page <= 1;
  prev.onclick = () => goToPage(pg.page - 1);
  pager.appendChild(prev);

  pager.appendChild(el("span", { class: "pager-info", text: ` ${pg.page} / ${pg.pageCount} ` }));

  const next = el("button", { text: currentLocale === "ja" ? "次へ" : "Next" });
  next.type = "button";
  next.disabled = pg.page >= pg.pageCount;
  next.onclick = () => goToPage(pg.page + 1);
  pager.appendChild(next);

  // Distant ordinal jump: jump to an arbitrary 1-based page without scanning intervening pages.
  const jump = document.createElement("input");
  jump.type = "number";
  jump.className = "pager-jump";
  jump.min = "1";
  jump.max = String(pg.pageCount);
  jump.value = String(pg.page);
  jump.setAttribute(
    "aria-label",
    currentLocale === "ja" ? "ページ番号へジャンプ" : "Jump to page number",
  );
  const jumpBtn = el("button", {
    text: currentLocale === "ja" ? "移動" : "Go",
  });
  jumpBtn.type = "button";
  jumpBtn.onclick = () => {
    const target = Number.parseInt(jump.value, 10);
    if (Number.isFinite(target)) goToPage(target);
  };
  jump.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      jumpBtn.click();
    }
  });
  pager.appendChild(jump);
  pager.appendChild(jumpBtn);
}

function renderPager(pg: Page<DesignIndexEntry>): void {
  fillPager(byId("pager-top"), pg);
  fillPager(byId("pager-bottom"), pg);
}

function scrollToResultsTop(): void {
  const target = document.getElementById("pager-top") ?? document.getElementById("results");
  if (target) {
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function goToPage(page: number): void {
  currentPage = page;
  applyState();
  scrollToResultsTop();
}

// Initial Bootstrap
async function bootstrap(): Promise<void> {
  // Locale Setup
  const saved = localStorage.getItem("godd_locale");
  if (saved === "en" || saved === "ja") {
    currentLocale = saved;
  } else {
    const lang = navigator.language.slice(0, 2).toLowerCase();
    currentLocale = lang === "en" ? "en" : "ja";
  }
  byId<HTMLSelectElement>("locale-select").value = currentLocale;
  const savedPageSizeRaw = localStorage.getItem("godd_page_size");
  const savedPageSize = savedPageSizeRaw === null ? Number.NaN : Number(savedPageSizeRaw);
  pageSize = clampPageSize(Number.isFinite(savedPageSize) ? savedPageSize : 25);
  byId<HTMLSelectElement>("page-size-select").value = String(pageSize);
  translateUI();

  // Load Data: summary 先読み → 明細はシャード or 非推奨の全件フォールバック (issue #88)。
  // 正本は Release `index-pages` (ADR-0003)。Release asset は CORS 非対応のため、
  // Pages では deploy 時に同期した同オリジンミラーへ向ける。
  const catalogBoot = await loadCatalogBootstrap({
    pageUrl: (page) => dsIndexPageMirrorUrl(page),
  });
  indexSummary = catalogBoot.summary;
  document.documentElement.dataset.dsEntryCount = String(indexSummary.entryCount);
  document.documentElement.dataset.dsIndexSource = catalogBoot.entriesSource;
  if (catalogBoot.entriesSource !== "pending") {
    allEntries = (await catalogBoot.entriesPromise).entries;
  } else {
    allEntries = [];
  }
  translateUI();

  taxonomy = await loadTaxonomy();
  // Setup Event Listeners
  byId("locale-select").onchange = (e) => {
    const val = (e.target as HTMLSelectElement).value as Locale;
    currentLocale = val;
    localStorage.setItem("godd_locale", val);
    translateUI();
    applyState();
    if (selectedEntry) {
      void openDetail(selectedEntry, {
        scroll: false,
        focus: false,
        preserveColors: true,
      });
    }
  };

  byId("page-size-select").onchange = (e) => {
    pageSize = clampPageSize(Number((e.target as HTMLSelectElement).value));
    localStorage.setItem("godd_page_size", String(pageSize));
    currentPage = 1;
    applyState();
  };

  byId("main-search-input").oninput = (e) => {
    searchQuery = (e.target as HTMLInputElement).value;
    currentPage = 1;
    applyState();
  };

  byId("sort-btn-popular").onclick = (e) => {
    sortOrder = "popular";
    byId("sort-btn-popular").classList.add("active");
    byId("sort-btn-newest").classList.remove("active");
    byId("sort-btn-popular").setAttribute("aria-pressed", "true");
    byId("sort-btn-newest").setAttribute("aria-pressed", "false");
    currentPage = 1;
    applyState();
  };

  byId("sort-btn-newest").onclick = (e) => {
    sortOrder = "newest";
    byId("sort-btn-newest").classList.add("active");
    byId("sort-btn-popular").classList.remove("active");
    byId("sort-btn-newest").setAttribute("aria-pressed", "true");
    byId("sort-btn-popular").setAttribute("aria-pressed", "false");
    currentPage = 1;
    applyState();
  };

  byId("clear-all-btn").onclick = () => {
    searchQuery = "";
    byId<HTMLInputElement>("main-search-input").value = "";
    filters.categories = [];
    filters.styles = [];
    filters.industries = [];
    filters.verticals = [];
    filters.colors = [];
    currentPage = 1;
    applyState();
  };

  byId("filter-toggle-btn").onclick = () => setFilterDrawerOpen(true);
  byId("filter-close-btn").onclick = () => setFilterDrawerOpen(false);
  byId("filter-drawer-backdrop").onclick = () => setFilterDrawerOpen(false);

  document.addEventListener("pointerdown", (event) => {
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (target instanceof Element && target.closest(".color-editor-block")) return;
    closeAllColorPalettes();
    for (const swatch of document.querySelectorAll(".color-editor-swatch[aria-expanded='true']")) {
      swatch.setAttribute("aria-expanded", "false");
    }
  });

  byId("scroll-top-btn").onclick = () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  byId("scroll-bottom-btn").onclick = () => {
    const bottom = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
    window.scrollTo({ top: bottom, behavior: "smooth" });
  };

  byId("back-btn").onclick = () => {
    detailRequestId++;
    selectedEntry = null;
    detailBaseMarkdown = "";
    detailBaseSwatches = [];
    detailColorOverrides = [];
    syncBrowseUrl(null);
    byId("detail-view").classList.add("hidden");
    byId("search-view").classList.remove("hidden");
    const returnTarget = detailReturnFocus?.isConnected
      ? detailReturnFocus
      : byId("main-search-input");
    detailReturnFocus = null;
    returnTarget.focus();
  };

  // Restore browse + cell state from the URL.
  const urlState = parseCatalogUrlState(window.location.search);
  searchQuery = urlState.q;
  byId<HTMLInputElement>("main-search-input").value = searchQuery;
  filters.categories = [...urlState.categories];
  filters.styles = [...urlState.styles];
  filters.industries = [...urlState.industries];
  filters.verticals = [...urlState.verticals];
  filters.colors = [...urlState.colors];
  sortOrder = urlState.sort;
  byId("sort-btn-popular").classList.toggle("active", sortOrder === "popular");
  byId("sort-btn-newest").classList.toggle("active", sortOrder === "newest");
  byId("sort-btn-popular").setAttribute("aria-pressed", String(sortOrder === "popular"));
  byId("sort-btn-newest").setAttribute("aria-pressed", String(sortOrder === "newest"));

  if (urlState.cursor) {
    const probe = pageVirtualCatalog(buildCatalogQuery(), { pageSize, page: 1 });
    const startRank = decodeCatalogCursor(urlState.cursor, probe.queryFingerprint);
    if (startRank !== undefined) {
      currentPage = Math.floor(startRank / pageSize) + 1;
      currentCursor = urlState.cursor;
    }
  }

  applyState();

  const openCellFromUrl = (cellId: string): void => {
    const restored = findEntryById(allEntries, cellId) ?? restoreCanonicalVirtualEntry(cellId);
    if (restored) {
      void openDetail(enrichWithMaterialized(restored, allEntries));
    }
  };

  if (urlState.cell) {
    openCellFromUrl(urlState.cell);
  }

  // summary 先読み後に明細が届いたら enrichment / 材化セル復元をやり直す。
  if (catalogBoot.entriesSource === "pending") {
    void catalogBoot.entriesPromise.then((ready) => {
      allEntries = ready.entries;
      indexSummary = ready.summary;
      document.documentElement.dataset.dsEntryCount = String(indexSummary.entryCount);
      document.documentElement.dataset.dsIndexSource = ready.entriesSource;
      applyState();
      if (urlState.cell && !selectedEntry) {
        openCellFromUrl(urlState.cell);
      } else if (selectedEntry) {
        void openDetail(enrichWithMaterialized(selectedEntry, allEntries), {
          scroll: false,
          focus: false,
          preserveColors: true,
        });
      }
    });
  }
}

void bootstrap();

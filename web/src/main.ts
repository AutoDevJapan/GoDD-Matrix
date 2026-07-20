import { JSIC_SUBCLASSES } from "../../src/axes/jsic-catalog.js";
import { JSIC_OVERLAY } from "../../src/axes/jsic.js";
import type { DesignIndexEntry } from "../../src/ds/types.js";
import { parseDesignIndex } from "../../src/ds/validate.js";
import {
  DS_INDEX_URL,
  EMPTY_SELECTION,
  EMPTY_TAXONOMY,
  type FacetSelection,
  type Locale,
  type Page,
  type Swatch,
  type Taxonomy,
  approxSwatchesForColor,
  buildCellPermalink,
  colorFamily,
  composePromptForCell,
  findEntryById,
  highlightTermsFromText,
  jsicMajor,
  jsicName,
  labelForColor,
  labelForMood,
} from "./lib.js";
import { renderMatchesCount } from "./matches-count.js";
import { loadMaterializedDesign } from "./materialized-design.js";
import {
  SEARCH_COLORS,
  SEARCH_STYLES,
  findColorValue,
  findStyleValue,
  resolveColorSlugs,
  resolveMoodSlug,
} from "./search-parser.js";
import { loadTaxonomy } from "./taxonomy-cache.js";
import { localizePromptPreview, localizedColorName } from "./ui-localization.js";
import { buildVirtualDesign } from "./virtual-design.js";
import {
  buildVirtualPermalinkId,
  parseVirtualPermalinkId,
  validateVirtualPermalinkAxes,
} from "./virtual-permalink.js";

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

// Static definitions matching the reference DESIGN.md library design
const CATEGORIES = [
  { v: "lp", ja: "ランディングページ", en: "Landing Page" },
  { v: "dashboard", ja: "ダッシュボード", en: "Dashboard" },
  { v: "mobile", ja: "モバイルアプリ", en: "Mobile App" },
  { v: "portfolio", ja: "ポートフォリオ", en: "Portfolio" },
  { v: "ecommerce", ja: "ECサイト", en: "E-commerce" },
  { v: "admin", ja: "管理画面", en: "Admin Panel" },
  { v: "blog", ja: "ブログ", en: "Blog" },
  { v: "form", ja: "フォーム", en: "Form" },
];

const STYLES = SEARCH_STYLES;

const INDUSTRIES = [
  { v: "saas", ja: "SaaS", en: "SaaS" },
  { v: "finance", ja: "金融", en: "Finance" },
  { v: "gaming", ja: "ゲーム", en: "Gaming" },
  { v: "education", ja: "教育", en: "Education" },
  { v: "ec", ja: "EC", en: "Retail" },
  { v: "healthcare", ja: "医療", en: "Healthcare" },
  { v: "travel", ja: "旅行", en: "Travel" },
  { v: "food", ja: "飲食", en: "Food" },
];

const FONTS = [
  { v: "inter", ja: "Inter", en: "Inter" },
  { v: "poppins", ja: "Poppins", en: "Poppins" },
  { v: "playfair", ja: "Playfair Display", en: "Playfair Display" },
  { v: "jetbrains", ja: "JetBrains Mono", en: "JetBrains Mono" },
  { v: "noto", ja: "Noto Sans JP", en: "Noto Sans JP" },
  { v: "space", ja: "Space Grotesk", en: "Space Grotesk" },
];

const COLOR_PALETTE = SEARCH_COLORS;

// App States
let allEntries: readonly DesignIndexEntry[] = [];
let currentLocale: Locale = "ja";
let taxonomy: Taxonomy = EMPTY_TAXONOMY;
let searchQuery = "";
let sortOrder: "popular" | "newest" = "popular";
let currentPage = 1;
let selectedEntry: DesignIndexEntry | null = null;
let detailRequestId = 0;
const PAGE_SIZE = 24;

interface Filters {
  category: string | null;
  style: string | null;
  industry: string | null;
  color: string | null;
}
const filters: Filters = { category: null, style: null, industry: null, color: null };

let animatedTotal = 0;
const TOTAL_LIBRARY = 172635600;

// Deterministic property mapping from index entries to reference facets
function getEntryCategory(entry: DesignIndexEntry): string {
  if (entry.id?.startsWith("virtual_")) {
    return entry.tags?.[0] || "";
  }
  const hash = (entry.id || "").charCodeAt(0) % CATEGORIES.length;
  return CATEGORIES[hash]?.v || "";
}

function getEntryStyle(entry: DesignIndexEntry): string {
  if (entry.id?.startsWith("virtual_")) {
    return entry.tags?.[1] || "";
  }
  const mood = entry.mood;
  if (mood === "minimal") return "minimal";
  if (mood === "elegant") return "glass";
  if (mood === "bold") return "brutalist";
  if (mood === "brutalist") return "brutalist";
  if (mood === "tech") return "dark";
  if (mood === "organic") return "playful";
  if (mood === "warm") return "neu";
  if (mood === "vintage") return "retro";
  return "minimal";
}

function getEntryIndustry(entry: DesignIndexEntry): string {
  const jsic = entry.jsic;
  if (entry.id?.startsWith("virtual_")) {
    return entry.tags?.[2] || "saas";
  }
  if (
    jsic.startsWith("37") ||
    jsic.startsWith("38") ||
    jsic.startsWith("39") ||
    jsic.startsWith("40") ||
    jsic.startsWith("41")
  ) {
    if (jsic === "3711") return "gaming";
    return "saas";
  }
  if (
    jsic.startsWith("62") ||
    jsic.startsWith("63") ||
    jsic.startsWith("64") ||
    jsic.startsWith("65") ||
    jsic.startsWith("66") ||
    jsic.startsWith("67") ||
    jsic === "7281"
  ) {
    return "finance";
  }
  if (jsic.startsWith("81") || jsic.startsWith("82")) {
    return "education";
  }
  if (jsic.startsWith("83") || jsic.startsWith("84") || jsic.startsWith("85")) {
    return "healthcare";
  }
  if (
    jsic.startsWith("56") ||
    jsic.startsWith("57") ||
    jsic.startsWith("58") ||
    jsic.startsWith("59") ||
    jsic.startsWith("60") ||
    jsic.startsWith("61")
  ) {
    return "ec";
  }
  if (jsic.startsWith("76") || jsic.startsWith("77")) {
    return "food";
  }
  if (
    jsic.startsWith("75") ||
    jsic.startsWith("44") ||
    jsic.startsWith("48") ||
    jsic.startsWith("78") ||
    jsic.startsWith("79")
  ) {
    return "travel";
  }
  return "saas";
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

function getThumbnailBg(entry: DesignIndexEntry): string {
  const colors = getSwatchHexes(entry);
  return `repeating-linear-gradient(135deg, ${colors[0]} 0px, ${colors[0]} 22px, ${colors[1]} 22px, ${colors[1]} 44px)`;
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
  const header = el("div");
  header.style.display = "flex";
  header.style.justifyContent = "space-between";
  header.style.alignItems = "center";
  header.style.borderBottom = `1px solid ${border}`;
  header.style.paddingBottom = "6px";

  const dot = el("div");
  dot.style.width = "8px";
  dot.style.height = "8px";
  dot.style.borderRadius = "50%";
  dot.style.background = primaryColor;
  header.appendChild(dot);

  const right = el("div");
  right.style.display = "flex";
  right.style.gap = "4px";
  for (let i = 0; i < 3; i++) {
    const line = el("div");
    line.style.width = "12px";
    line.style.height = "2px";
    line.style.background = muted;
    right.appendChild(line);
  }
  header.appendChild(right);
  container.appendChild(header);

  // Content Area
  const body = el("div");
  body.style.display = "flex";
  body.style.gap = "8px";
  body.style.flex = "1";

  const sidebar = el("div");
  sidebar.style.width = "16px";
  sidebar.style.background = isDark ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.02)";
  sidebar.style.borderRadius = "4px";
  sidebar.style.padding = "4px";
  sidebar.style.display = "flex";
  sidebar.style.flexDirection = "column";
  sidebar.style.gap = "4px";
  for (let i = 0; i < 3; i++) {
    const item = el("div");
    item.style.height = "3px";
    item.style.background = i === 0 ? accentColor : muted;
    item.style.borderRadius = "1px";
    sidebar.appendChild(item);
  }
  body.appendChild(sidebar);

  const main = el("div");
  main.style.flex = "1";
  main.style.display = "flex";
  main.style.flexDirection = "column";
  main.style.gap = "6px";

  const mockCard = el("div");
  mockCard.style.flex = "1";
  mockCard.style.background = cardBg;
  mockCard.style.border = `1px solid ${border}`;
  mockCard.style.borderRadius = "4px";
  mockCard.style.padding = "6px";
  mockCard.style.display = "flex";
  mockCard.style.flexDirection = "column";
  mockCard.style.justifyContent = "space-between";

  const topBar = el("div");
  topBar.style.width = "50%";
  topBar.style.height = "3px";
  topBar.style.background = primaryColor;
  topBar.style.borderRadius = "1px";
  mockCard.appendChild(topBar);

  const btn = el("div");
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
  localeLabel: string;
  pagerLabel: string;
  previewLabel: string;
  footerText: string;
  brandSubtitle: string;
  heroTag: string;
  heroSub: string;
  placeholderSearch: string;
  labelFacetCategory: string;
  labelFacetStyle: string;
  labelFacetIndustry: string;
  labelFacetColor: string;
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
  btnDownload: string;
  btnCopy: string;
  btnShare: string;
  labelRelated: string;
  toastCopied: string;
  toastShareCopied: string;
  toastDownloadStarted: string;
  toastCopyFailed: string;
  virtualNotice: string;
  labelVirtualBadge: string;
  catalogPrefix: string;
  catalogSuffix: string;
  loading: string;
  sampleCount: (shown: number, total: number) => string;
  materializationType: string;
  preGeneratedType: string;
  detailLoading: string;
  detailLoadError: string;
}

const TRANSLATIONS: Record<Locale, TranslationKeys> = {
  ja: {
    siteTitle: "DESIGN.md Library",
    siteDescription: "1億件以上のDESIGNファイルを検索・共有",
    localeLabel: "言語",
    pagerLabel: "ページ送り",
    previewLabel: "プレビュー",
    footerText: "データ提供元: GoDD Design System 公開コーパス（ブラウザから取得）",
    brandSubtitle: "1億件以上のDESIGNファイルを検索・共有",
    heroTag: "世界最大のDESIGNファイルライブラリ",
    heroSub: "件のDESIGN.mdファイルが検索可能",
    placeholderSearch: "検索例: ミニマル ダッシュボード",
    labelFacetCategory: "カテゴリ",
    labelFacetStyle: "スタイル",
    labelFacetIndustry: "業界",
    labelFacetColor: "カラー",
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
    btnDownload: "ダウンロード",
    btnCopy: "コピー",
    btnShare: "共有リンク",
    labelRelated: "関連するDESIGNファイル",
    toastCopied: "Markdownをクリップボードにコピーしました",
    toastShareCopied: "共有リンクをコピーしました",
    toastDownloadStarted: "ダウンロードを開始しました",
    toastCopyFailed: "コピーに失敗しました",
    virtualNotice: "決定論的デザインエンジンによりリアルタイム合成されました。",
    labelVirtualBadge: "VIRTUAL",
    catalogPrefix: "OSS 材化済みカタログ: ",
    catalogSuffix: " 件",
    loading: "読み込み中...",
    sampleCount: (shown, total) => `${total.toLocaleString("ja-JP")}件中 ${shown}件を表示中`,
    materializationType: "リアルタイム合成",
    preGeneratedType: "OSS 材化済み",
    detailLoading: "DESIGN.md を読み込んでいます...",
    detailLoadError: "DESIGN.md の読み込みに失敗しました。時間をおいて再度お試しください。",
  },
  en: {
    siteTitle: "DESIGN.md Library",
    siteDescription: "Search and share more than 100 million DESIGN files",
    localeLabel: "Language",
    pagerLabel: "Pagination",
    previewLabel: "Preview",
    footerText: "Data source: GoDD Design System public corpus (fetched client-side)",
    brandSubtitle: "Search & share 100M+ DESIGN files",
    heroTag: "World's largest DESIGN.md library",
    heroSub: "DESIGN.md files ready to search",
    placeholderSearch: "Search e.g. 'Minimal Dashboard'",
    labelFacetCategory: "Category",
    labelFacetStyle: "Style",
    labelFacetIndustry: "Industry",
    labelFacetColor: "Color",
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
    btnDownload: "Download",
    btnCopy: "Copy",
    btnShare: "Share",
    labelRelated: "Related files",
    toastCopied: "Markdown copied to clipboard",
    toastShareCopied: "Share link copied to clipboard",
    toastDownloadStarted: "Download started",
    toastCopyFailed: "Copy failed",
    virtualNotice: "Synthesized in real-time by the deterministic design engine.",
    labelVirtualBadge: "VIRTUAL",
    catalogPrefix: "Pre-generated OSS Catalog: ",
    catalogSuffix: " files",
    loading: "Loading...",
    sampleCount: (shown, total) => `Showing ${shown} of ${total.toLocaleString("en-US")} results`,
    materializationType: "Virtual",
    preGeneratedType: "Pre-generated",
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

// Total Space Animate Counter
function animateCounter(): void {
  const target = TOTAL_LIBRARY;
  let step = 0;
  const steps = 26;
  const counterEl = byId("live-total-counter");
  const timer = setInterval(() => {
    step++;
    const progress = 1 - (1 - step / steps) ** 3;
    animatedTotal = Math.min(target, Math.round(target * progress));
    if (counterEl) {
      counterEl.textContent = animatedTotal.toLocaleString(
        currentLocale === "ja" ? "ja-JP" : "en-US",
      );
    }
    if (step >= steps) {
      clearInterval(timer);
    }
  }, 40);
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
  byId("pager").setAttribute("aria-label", t.pagerLabel);
  byId("label-preview-overlay").textContent = t.previewLabel;
  byId("label-footer").textContent = t.footerText;

  byId("label-brand-subtitle").textContent = t.brandSubtitle;
  byId("label-hero-tag").textContent = t.heroTag;
  byId("label-hero-sub").textContent = t.heroSub;
  byId<HTMLInputElement>("main-search-input").placeholder = t.placeholderSearch;

  byId("label-facet-category").textContent = t.labelFacetCategory;
  byId("label-facet-style").textContent = t.labelFacetStyle;
  byId("label-facet-industry").textContent = t.labelFacetIndustry;
  byId("label-facet-color").textContent = t.labelFacetColor;
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

  const catalogBadge = byId("label-hero-catalog");
  if (catalogBadge) {
    catalogBadge.replaceChildren();
    const countSpan = el("span", {
      text:
        allEntries.length > 0
          ? allEntries.length.toLocaleString(currentLocale === "ja" ? "ja-JP" : "en-US")
          : t.loading,
    });
    countSpan.id = "stat-materialized-count";
    catalogBadge.append(
      document.createTextNode(t.catalogPrefix),
      countSpan,
      document.createTextNode(t.catalogSuffix),
    );
  }
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
    title: getEntryTitle(entry, locale),
    industry,
    color: labelForColor(entry.color, taxonomy, locale),
    mood: labelForMood(entry.mood, taxonomy, locale),
    swatches: getSwatchHexes(entry),
  });
}

// Render the detailed view of a resolved specification
async function openDetail(entry: DesignIndexEntry, opts: { scroll?: boolean } = {}): Promise<void> {
  const requestId = ++detailRequestId;
  selectedEntry = entry;

  // Transition views
  byId("search-view").classList.add("hidden");
  const detailView = byId("detail-view");
  detailView.classList.remove("hidden");
  if (opts.scroll !== false) window.scrollTo(0, 0);

  // Sync URL permalink
  const permalink = buildCellPermalink(window.location.href, entry.id);
  window.history.replaceState(null, "", permalink);

  // Resolve detailed fields
  const cLabel = CATEGORIES.find((c) => c.v === getEntryCategory(entry));
  const sLabel = STYLES.find((s) => s.v === getEntryStyle(entry));
  const iLabel = INDUSTRIES.find((i) => i.v === getEntryIndustry(entry));
  const fLabel = FONTS.find((f) => f.v === getEntryFont(entry));

  const categoryText = cLabel ? (currentLocale === "ja" ? cLabel.ja : cLabel.en) : "";
  const styleText = sLabel ? (currentLocale === "ja" ? sLabel.ja : sLabel.en) : "";
  const industryText = iLabel ? (currentLocale === "ja" ? iLabel.ja : iLabel.en) : "";
  const fontText = fLabel ? (currentLocale === "ja" ? fLabel.ja : fLabel.en) : "";

  // Title & Filename
  const mainTitle = getEntryTitle(entry, currentLocale);
  const subTitle = `${entry.jsic} × ${entry.color} × ${entry.mood}`;
  byId("detail-filename").textContent = `${entry.id}.design.md`;
  byId("detail-title-ja").textContent = mainTitle;
  byId("detail-title-en").textContent = subTitle;

  // Description text
  if (currentLocale === "ja") {
    byId("detail-desc-ja").textContent =
      `業種コード ${entry.jsic} （${jsicName(entry.jsic) || "不明"}）における、カラー「${labelForColor(entry.color, taxonomy, "ja")}」とムード「${labelForMood(entry.mood, taxonomy, "ja")}」の決定論的デザイン仕様書。`;
    byId("detail-desc-ja").classList.remove("hidden");
    byId("detail-desc-en").classList.add("hidden");
  } else {
    const major = jsicMajor(entry.jsic);
    byId("detail-desc-en").textContent =
      `Deterministic design specification matching industry code ${entry.jsic} (${major.label_en || jsicName(entry.jsic) || "Unknown"}), color tone "${labelForColor(entry.color, taxonomy, "en")}", and design mood "${labelForMood(entry.mood, taxonomy, "en")}".`;
    byId("detail-desc-en").classList.remove("hidden");
    byId("detail-desc-ja").classList.add("hidden");
  }

  // Draw swatches
  const swatches = getSwatchHexes(entry);
  const swatchBox = byId("detail-swatches");
  swatchBox.replaceChildren();
  for (const hex of swatches) {
    const swatchItem = el("div", { class: "swatch-item" });
    const swatchColor = el("div", { class: "swatch-color" });
    swatchColor.style.backgroundColor = hex;
    swatchItem.appendChild(swatchColor);
    swatchItem.appendChild(el("span", { class: "swatch-hex", text: hex }));
    swatchBox.appendChild(swatchItem);
  }

  // Draw metadata badges
  const badgeBox = byId("detail-badges");
  badgeBox.replaceChildren();
  if (categoryText) badgeBox.appendChild(el("span", { class: "badge-tag", text: categoryText }));
  if (styleText) badgeBox.appendChild(el("span", { class: "badge-tag", text: styleText }));
  if (industryText) badgeBox.appendChild(el("span", { class: "badge-tag", text: industryText }));
  if (fontText) badgeBox.appendChild(el("span", { class: "badge-tag", text: fontText }));

  // Draw preview background pattern
  const previewBox = byId("detail-preview-box");
  previewBox.style.background = getThumbnailBg(entry);

  const isVirtual = entry.id.startsWith("virtual_") || !entry.hash;

  // Set file type and metadata
  const t = TRANSLATIONS[currentLocale];
  byId("detail-downloads-val").textContent = isVirtual ? t.materializationType : t.preGeneratedType;
  byId("detail-updated-val").textContent = entry.createdAt
    ? entry.createdAt.slice(0, 10)
    : "2026-07-20";
  byId("detail-license-val").textContent = "MIT";

  // Hide virtual notice by default unless it is dynamic virtual cell
  const virtualNotice = byId("detail-virtual-notice");
  if (isVirtual) {
    virtualNotice.classList.remove("hidden");
    byId("label-virtual-badge").textContent = TRANSLATIONS[currentLocale].labelVirtualBadge;
    byId("detail-virtual-notice-text").textContent = TRANSLATIONS[currentLocale].virtualNotice;
  } else {
    virtualNotice.classList.add("hidden");
  }

  const codeBlock = byId("detail-code-block");
  const downloadButton = byId<HTMLButtonElement>("btn-download");
  const copyButton = byId<HTMLButtonElement>("btn-copy");
  const relatedGrid = byId("related-grid");
  downloadButton.disabled = true;
  copyButton.disabled = true;
  codeBlock.setAttribute("aria-busy", "true");
  codeBlock.textContent = t.detailLoading;
  relatedGrid.replaceChildren();

  // Resolve virtual content locally, or fetch and verify a materialized body.
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
      console.error("Failed to load materialized DESIGN.md:", error);
      codeBlock.setAttribute("aria-busy", "false");
      codeBlock.textContent = t.detailLoadError;
      downloadButton.onclick = null;
      copyButton.onclick = null;
      byId("btn-share").onclick = () => copyText(window.location.href, t.toastShareCopied);
      return;
    }
  }

  // Synthesize Markdown Content
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

  // Combine system prompt and markdown preview
  const finalMarkdown = localizePromptPreview(prompt, currentLocale);
  codeBlock.setAttribute("aria-busy", "false");
  codeBlock.textContent = finalMarkdown;

  // Bind sidebar action buttons
  downloadButton.disabled = false;
  copyButton.disabled = false;
  downloadButton.onclick = () => downloadMarkdown(`${entry.id}.design.md`, finalMarkdown);
  copyButton.onclick = () => copyText(finalMarkdown, t.toastCopied);
  byId("btn-share").onclick = () => copyText(window.location.href, t.toastShareCopied);

  // Load related design entries
  const relatedList = allEntries
    .filter((e) => e.id !== entry.id && (e.mood === entry.mood || e.jsic === entry.jsic))
    .slice(0, 4);

  for (const item of relatedList) {
    const card = el("div", { class: "related-card" });
    card.onclick = () => {
      void openDetail(item);
    };

    const thumb = el("div", { class: "related-thumb" });
    renderThumbnail(item, thumb);
    thumb.appendChild(el("div", { class: "preview-overlay", text: t.previewLabel }));
    card.appendChild(thumb);

    const body = el("div", { class: "related-body" });
    const mainTitle = getEntryTitle(item, currentLocale);
    const subTitle = `${item.jsic} × ${item.color} × ${item.mood}`;
    body.appendChild(el("div", { class: "related-card-title-ja", text: mainTitle }));
    body.appendChild(el("div", { class: "related-card-title-en", text: subTitle }));
    card.appendChild(body);

    relatedGrid.appendChild(card);
  }
}

// Render dynamic chips/filters inside facet rows
function renderFilters(): void {
  // Category Chips
  const catList = byId("facet-list-category");
  catList.replaceChildren();
  for (const c of CATEGORIES) {
    const active = filters.category === c.v;
    const label = currentLocale === "ja" ? c.ja : c.en;
    const chip = el("button", { class: `facet-chip ${active ? "selected" : ""}`, text: label });
    chip.onclick = () => {
      filters.category = active ? null : c.v;
      currentPage = 1;
      applyState();
    };
    catList.appendChild(chip);
  }

  // Style Chips (Mood)
  const styleList = byId("facet-list-style");
  styleList.replaceChildren();
  for (const s of STYLES) {
    const active = filters.style === s.v;
    const label = currentLocale === "ja" ? s.ja : s.en;
    const chip = el("button", { class: `facet-chip ${active ? "selected" : ""}`, text: label });
    chip.onclick = () => {
      filters.style = active ? null : s.v;
      currentPage = 1;
      applyState();
    };
    styleList.appendChild(chip);
  }

  // Industry Chips
  const indList = byId("facet-list-industry");
  indList.replaceChildren();
  for (const i of INDUSTRIES) {
    const active = filters.industry === i.v;
    const label = currentLocale === "ja" ? i.ja : i.en;
    const chip = el("button", { class: `facet-chip ${active ? "selected" : ""}`, text: label });
    chip.onclick = () => {
      // Toggle industry selection and reset to page 1
      filters.industry = active ? null : i.v;
      currentPage = 1;
      applyState();
    };
    indList.appendChild(chip);
  }

  // Color Swatches
  const colorList = byId("facet-list-color");
  colorList.replaceChildren();
  for (const c of COLOR_PALETTE) {
    const active = filters.color === c.slug;
    const chip = el("button", {
      class: `color-dot-btn ${active ? "selected" : ""}`,
      title: localizedColorName(c.name, c.slug, currentLocale),
    });
    chip.style.backgroundColor = c.hex;
    chip.onclick = () => {
      filters.color = active ? null : c.slug;
      currentPage = 1;
      applyState();
    };
    colorList.appendChild(chip);
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

function getEntryTitle(entry: DesignIndexEntry, locale: Locale): string {
  if (entry.title && locale === "ja") {
    if (entry.title.startsWith("VIRTUAL DESIGN: ")) {
      const colLabel = labelForColor(entry.color, taxonomy, "ja");
      const mdLabel = labelForMood(entry.mood, taxonomy, "ja");
      return `【仮想】${jsicName(entry.jsic) || entry.jsic} × ${colLabel} × ${mdLabel}`;
    }
    return entry.title;
  }

  const colLabel = labelForColor(entry.color, taxonomy, locale);
  const mdLabel = labelForMood(entry.mood, taxonomy, locale);

  if (locale === "en") {
    const major = jsicMajor(entry.jsic);
    const indName = major.label_en || jsicName(entry.jsic) || entry.jsic;
    if (entry.id?.startsWith("virtual_") || entry.title?.startsWith("VIRTUAL DESIGN: ")) {
      return `Virtual Design: ${indName} / ${mdLabel} / ${colLabel}`;
    }
    return `Design System: ${indName} / ${mdLabel} / ${colLabel}`;
  }

  return entry.title || `${jsicName(entry.jsic) || entry.jsic} × ${colLabel} × ${mdLabel}`;
}

// Apply states, filter lists, and render UI
function applyState(): void {
  renderFilters();

  // Parse searchQuery into axis terms (smart search)
  let parsedCategory = filters.category;
  let parsedStyle = filters.style;
  let parsedColor = filters.color;
  const industryTerms: string[] = [];

  if (searchQuery) {
    const terms = searchQuery
      .toLowerCase()
      .split(/[\s、,]+/)
      .map((t) => t.trim())
      .filter((t) => t.length > 0);

    for (const term of terms) {
      const catMatch = findCategoryValue(term);
      if (catMatch && !parsedCategory) {
        parsedCategory = catMatch;
        continue;
      }
      const styleMatch = findStyleValue(term, taxonomy);
      if (styleMatch && !parsedStyle) {
        parsedStyle = styleMatch;
        continue;
      }
      const colorMatch = findColorValue(term, taxonomy);
      if (colorMatch && !parsedColor) {
        parsedColor = colorMatch;
        continue;
      }
      industryTerms.push(term);
    }
  }

  const isFiltered = !!(
    parsedCategory ||
    parsedStyle ||
    filters.industry ||
    parsedColor ||
    industryTerms.length > 0
  );

  let pageView: Page<DesignIndexEntry>;
  let totalMatches = TOTAL_LIBRARY;

  if (!isFiltered) {
    pageView = paginate(allEntries, currentPage, PAGE_SIZE);
    totalMatches = TOTAL_LIBRARY;
  } else {
    // Determine combinatorics sizes
    const cLen = parsedCategory ? 1 : CATEGORIES.length;
    const sLen = parsedStyle ? 1 : STYLES.length;

    let matchingJsic = JSIC_SUBCLASSES;
    if (filters.industry) {
      matchingJsic = JSIC_SUBCLASSES.filter((s) => {
        const entryInd = getEntryIndustry({ jsic: s.code, path: "" } as DesignIndexEntry);
        return entryInd === filters.industry;
      });
    }
    if (industryTerms.length > 0) {
      matchingJsic = matchingJsic.filter((s) => {
        const name = jsicName(s.code) || "";
        const major = jsicMajor(s.code);
        const overlay = JSIC_OVERLAY[s.code];

        return industryTerms.every((term) => {
          if (
            s.code.includes(term) ||
            name.toLowerCase().includes(term) ||
            major.code.toLowerCase().includes(term) ||
            major.label.toLowerCase().includes(term) ||
            major.label_en?.toLowerCase().includes(term)
          ) {
            return true;
          }
          if (overlay) {
            if (overlay.aliases?.some((a) => a.toLowerCase().includes(term))) {
              return true;
            }
            if (overlay.keywords?.some((k) => k.toLowerCase().includes(term))) {
              return true;
            }
          }
          return false;
        });
      });
    }

    let matchingColors = ["h17b-lt", "gray-3", "h12s-sf", "h2v-vv", "white", "black"];
    const colFilter = parsedColor;
    if (colFilter) {
      matchingColors = resolveColorSlugs(colFilter, taxonomy);
    }

    const uniqueKeysCount = cLen * sLen * matchingJsic.length * matchingColors.length;

    // Scale count: if all filters are selected, scale by 16; if some are selected, scale proportionally up to 4000
    const activeFilterCount =
      (parsedCategory ? 1 : 0) +
      (parsedStyle ? 1 : 0) +
      (filters.industry ? 1 : 0) +
      (parsedColor ? 1 : 0);
    const scale =
      activeFilterCount >= 3
        ? 16
        : activeFilterCount === 2
          ? 64
          : activeFilterCount === 1
            ? 500
            : 4000;
    totalMatches = uniqueKeysCount * scale;

    const pageCount = Math.ceil(totalMatches / PAGE_SIZE) || 1;
    const p = Math.max(1, Math.min(currentPage, pageCount));
    const start = (p - 1) * PAGE_SIZE;

    const pageItems: DesignIndexEntry[] = [];
    for (let idx = start; idx < Math.min(start + PAGE_SIZE, totalMatches); idx++) {
      pageItems.push(
        getCombinationAtIndex(
          idx,
          {
            category: parsedCategory,
            style: parsedStyle,
            industry: filters.industry,
            color: parsedColor,
          },
          matchingJsic,
          matchingColors,
        ),
      );
    }

    pageView = {
      items: pageItems,
      page: p,
      pageCount,
      total: totalMatches,
      pageSize: PAGE_SIZE,
    };
  }

  currentPage = pageView.page;

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
  if (filters.category) {
    const c = CATEGORIES.find((x) => x.v === filters.category);
    pills.push({
      label: c ? (currentLocale === "ja" ? c.ja : c.en) : filters.category,
      clear: () => {
        filters.category = null;
        applyState();
      },
    });
  }
  if (filters.style) {
    const s = STYLES.find((x) => x.v === filters.style);
    pills.push({
      label: s ? (currentLocale === "ja" ? s.ja : s.en) : filters.style,
      clear: () => {
        filters.style = null;
        applyState();
      },
    });
  }
  if (filters.industry) {
    const i = INDUSTRIES.find((x) => x.v === filters.industry);
    pills.push({
      label: i ? (currentLocale === "ja" ? i.ja : i.en) : filters.industry,
      clear: () => {
        filters.industry = null;
        applyState();
      },
    });
  }
  if (filters.color) {
    const c = COLOR_PALETTE.find((x) => x.slug === filters.color);
    pills.push({
      label: c ? localizedColorName(c.name, c.slug, currentLocale) : filters.color,
      clear: () => {
        filters.color = null;
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
      const card = el("div", { class: "card" });
      card.onclick = () => {
        void openDetail(entry);
      };

      const thumb = el("div", { class: "card-thumbnail" });
      renderThumbnail(entry, thumb);
      thumb.appendChild(
        el("div", { class: "preview-overlay", text: TRANSLATIONS[currentLocale].previewLabel }),
      );
      card.appendChild(thumb);

      const body = el("div", { class: "card-body" });
      const mainTitle = getEntryTitle(entry, currentLocale);
      const subTitle = `${entry.jsic} × ${entry.color} × ${entry.mood}`;
      body.appendChild(el("div", { class: "card-title-ja", text: mainTitle }));
      body.appendChild(
        el("div", {
          class: "card-title-en",
          text: subTitle,
        }),
      );

      // Add category/style badges
      const bContainer = el("div", { class: "card-badges" });
      const cL = CATEGORIES.find((x) => x.v === getEntryCategory(entry));
      const sL = STYLES.find((x) => x.v === getEntryStyle(entry));
      if (cL)
        bContainer.appendChild(
          el("span", { class: "badge-tag", text: currentLocale === "ja" ? cL.ja : cL.en }),
        );
      if (sL)
        bContainer.appendChild(
          el("span", { class: "badge-tag", text: currentLocale === "ja" ? sL.ja : sL.en }),
        );
      body.appendChild(bContainer);

      // Card footer
      const footer = el("div", { class: "card-footer" });
      const isVirtual = entry.id.startsWith("virtual_") || !entry.hash;
      const typeText = isVirtual
        ? TRANSLATIONS[currentLocale].materializationType
        : TRANSLATIONS[currentLocale].preGeneratedType;
      footer.appendChild(el("span", { class: "card-type-label", text: typeText }));
      footer.appendChild(
        el("span", { text: entry.createdAt ? entry.createdAt.slice(0, 10) : "2026-07-20" }),
      );
      body.appendChild(footer);

      card.appendChild(body);
      resultsGrid.appendChild(card);
    }
  }

  // Draw Pager
  renderPager(pageView);
}

function getCombinationAtIndex(
  index: number,
  filters: Filters,
  matchingJsic: typeof JSIC_SUBCLASSES,
  matchingColors: string[],
): DesignIndexEntry {
  const categories = filters.category ? [filters.category] : CATEGORIES.map((c) => c.v);
  const styles = filters.style ? [filters.style] : STYLES.map((s) => s.v);

  const cLen = categories.length;
  const sLen = styles.length;
  const jLen = matchingJsic.length;
  const colLen = matchingColors.length;

  const baseCombinations = cLen * sLen * jLen * colLen;
  const baseIndex = index % baseCombinations;
  const extraIndex = Math.floor(index / baseCombinations);

  let rem = baseIndex;
  const colorIdx = rem % colLen;
  rem = Math.floor(rem / colLen);

  const jsicIdx = rem % jLen;
  rem = Math.floor(rem / jLen);

  const styleIdx = rem % sLen;
  rem = Math.floor(rem / sLen);

  const catIdx = rem % cLen;

  const cat = categories[catIdx] ?? "dashboard";
  const style = styles[styleIdx] ?? "minimal";
  const jsicObj = matchingJsic[jsicIdx] || { code: "6061", name: "ソフトウェア業" };
  const color = matchingColors[colorIdx] || "h17b-lt";

  const mood = resolveMoodSlug(style);

  const id = buildVirtualPermalinkId({
    jsic: jsicObj.code,
    color,
    mood,
    category: cat,
    style,
    variant: extraIndex,
  });
  const title = `VIRTUAL DESIGN: ${jsicName(jsicObj.code)} × ${color} × ${mood}`;

  const entry: DesignIndexEntry = {
    id,
    path: `design-md/${jsicObj.code}/${color}/${mood}/DESIGN.md`,
    jsic: jsicObj.code,
    color,
    mood,
    title,
    hash: "",
    variant: extraIndex,
    createdAt: "2026-07-20",
    tags: [cat, style, getEntryIndustry({ jsic: jsicObj.code, path: "" } as DesignIndexEntry)],
  };

  return entry;
}

function restoreVirtualEntry(id: string): DesignIndexEntry | undefined {
  const axes = parseVirtualPermalinkId(id);
  if (!axes) return undefined;

  const knownColors = new Set([
    "h17b-lt",
    "gray-3",
    "h12s-sf",
    "h2v-vv",
    "white",
    "black",
    ...Object.keys(taxonomy.colors),
  ]);
  if (
    !validateVirtualPermalinkAxes(axes, {
      jsic: new Set(JSIC_SUBCLASSES.map((item) => item.code)),
      colors: knownColors,
      categories: new Set(CATEGORIES.map((item) => item.v)),
      styles: new Set(STYLES.map((item) => item.v)),
      moodForStyle: resolveMoodSlug,
    })
  ) {
    return undefined;
  }

  return {
    id,
    path: `design-md/${axes.jsic}/${axes.color}/${axes.mood}/DESIGN.md`,
    jsic: axes.jsic,
    color: axes.color,
    mood: axes.mood,
    title: `VIRTUAL DESIGN: ${jsicName(axes.jsic)} × ${axes.color} × ${axes.mood}`,
    hash: "",
    variant: axes.variant,
    createdAt: "2026-07-20",
    tags: [
      axes.category,
      axes.style,
      getEntryIndustry({ jsic: axes.jsic, path: "" } as DesignIndexEntry),
    ],
  };
}

function matchColorFamily(entryColor: string, paletteSlug: string): boolean {
  const family = colorFamily(entryColor).key;
  const isNeutral = family === "neutral";

  if (paletteSlug === "indigo") return family === "blue" || family === "bluepurple";
  if (paletteSlug === "light-blue")
    return (
      family === "bluegreen" || family === "blue" || (isNeutral && entryColor.includes("white"))
    );
  if (paletteSlug === "green")
    return family === "green" || family === "yellowgreen" || family === "bluegreen";
  if (paletteSlug === "yellow") return family === "yellow";
  if (paletteSlug === "orange")
    return family === "orange" || family === "red" || family === "redpurple";
  if (paletteSlug === "blue")
    return family === "blue" || family === "bluepurple" || family === "purple";
  if (paletteSlug === "warm-gray")
    return (
      isNeutral &&
      (entryColor.includes("gray") ||
        entryColor.includes("gr") ||
        entryColor.includes("white") ||
        entryColor.includes("off-white") ||
        entryColor.includes("ivory"))
    );
  if (paletteSlug === "black")
    return (
      isNeutral &&
      (entryColor.includes("black") || entryColor.includes("bk") || entryColor.includes("ink"))
    );

  return false;
}

function paginate<T>(items: readonly T[], page: number, pageSize: number): Page<T> {
  const total = items.length;
  const pageCount = Math.ceil(total / pageSize) || 1;
  const p = Math.max(1, Math.min(page, pageCount));
  const start = (p - 1) * pageSize;
  return {
    items: items.slice(start, start + pageSize),
    page: p,
    pageSize,
    total,
    pageCount,
  };
}

function renderPager(pg: Page<DesignIndexEntry>): void {
  const pager = byId("pager");
  pager.replaceChildren();

  const prev = el("button", { text: currentLocale === "ja" ? "前へ" : "Prev" });
  prev.disabled = pg.page <= 1;
  prev.onclick = () => goToPage(pg.page - 1);
  pager.appendChild(prev);

  pager.appendChild(el("span", { class: "pager-info", text: ` ${pg.page} / ${pg.pageCount} ` }));

  const next = el("button", { text: currentLocale === "ja" ? "次へ" : "Next" });
  next.disabled = pg.page >= pg.pageCount;
  next.onclick = () => goToPage(pg.page + 1);
  pager.appendChild(next);
}

function goToPage(page: number): void {
  currentPage = page;
  applyState();
  window.scrollTo(0, 0);
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
  translateUI();
  animateCounter();

  // Load Data
  let indexData: ReturnType<typeof parseDesignIndex>;
  try {
    const localRes = await fetch("web-index.json", { cache: "no-cache" });
    if (!localRes.ok) throw new Error();
    indexData = parseDesignIndex(await localRes.text());
  } catch {
    const remoteRes = await fetch(DS_INDEX_URL, { cache: "no-cache" });
    if (!remoteRes.ok) throw new Error(`HTTP ${remoteRes.status}`);
    indexData = parseDesignIndex(await remoteRes.text());
  }
  allEntries = indexData.entries;
  translateUI();

  taxonomy = await loadTaxonomy();
  // Setup Event Listeners
  byId("locale-select").onchange = (e) => {
    const val = (e.target as HTMLSelectElement).value as Locale;
    currentLocale = val;
    localStorage.setItem("godd_locale", val);
    translateUI();
    applyState();
    if (selectedEntry) void openDetail(selectedEntry, { scroll: false });
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
    currentPage = 1;
    applyState();
  };

  byId("sort-btn-newest").onclick = (e) => {
    sortOrder = "newest";
    byId("sort-btn-newest").classList.add("active");
    byId("sort-btn-popular").classList.remove("active");
    currentPage = 1;
    applyState();
  };

  byId("clear-all-btn").onclick = () => {
    searchQuery = "";
    byId<HTMLInputElement>("main-search-input").value = "";
    filters.category = null;
    filters.style = null;
    filters.industry = null;
    filters.color = null;
    currentPage = 1;
    applyState();
  };

  byId("back-btn").onclick = () => {
    detailRequestId++;
    selectedEntry = null;
    window.history.replaceState(null, "", window.location.pathname);
    byId("detail-view").classList.add("hidden");
    byId("search-view").classList.remove("hidden");
  };

  // Restore state from URL permalink if any
  const params = new URLSearchParams(window.location.search);
  const cellParam = params.get("cell");
  if (cellParam) {
    const entry = findEntryById(allEntries, cellParam) ?? restoreVirtualEntry(cellParam);
    if (entry) {
      void openDetail(entry);
    }
  }

  applyState();
}

void bootstrap();

import type { DesignIndexEntry } from "../../src/ds/types.js";
import { parseDesignIndex } from "../../src/ds/validate.js";
import {
  DS_INDEX_URL,
  DS_TAXONOMY_URL,
  EMPTY_SELECTION,
  EMPTY_TAXONOMY,
  type FacetSelection,
  type Locale,
  type Page,
  type Swatch,
  type Taxonomy,
  approxSwatchesForColor,
  buildCellPermalink,
  composePromptForCell,
  findEntryById,
  highlightTermsFromText,
  jsicName,
  labelForColor,
  labelForMood,
  parseTaxonomy,
} from "./lib.js";

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

const STYLES = [
  { v: "minimal", ja: "ミニマル", en: "Minimal" },
  { v: "retro", ja: "レトロ", en: "Retro" },
  { v: "brutalist", ja: "ブルータリズム", en: "Brutalist" },
  { v: "glass", ja: "グラスモーフィズム", en: "Glassmorphism" },
  { v: "corporate", ja: "コーポレート", en: "Corporate" },
  { v: "dark", ja: "ダーク", en: "Dark" },
  { v: "neu", ja: "ニューモーフィズム", en: "Neumorphism" },
  { v: "playful", ja: "プレイフル", en: "Playful" },
];

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

const COLOR_PALETTE = [
  { hex: "#6366f1", name: "Indigo / インディゴ", slug: "indigo" },
  { hex: "#0ea5e9", name: "Sky / スカイ", slug: "light-blue" },
  { hex: "#10b981", name: "Emerald / エメラルド", slug: "green" },
  { hex: "#f59e0b", name: "Amber / アンバー", slug: "yellow" },
  { hex: "#f43f5e", name: "Rose / ローズ", slug: "orange" },
  { hex: "#8b5cf6", name: "Violet / バイオレット", slug: "blue" },
  { hex: "#64748b", name: "Slate / スレート", slug: "warm-gray" },
  { hex: "#0f172a", name: "Ink / インク", slug: "black" },
];

// App States
let allEntries: readonly DesignIndexEntry[] = [];
let currentLocale: Locale = "ja";
let taxonomy: Taxonomy = EMPTY_TAXONOMY;
let searchQuery = "";
let sortOrder: "popular" | "newest" = "popular";
let currentPage = 1;
let selectedCellId: string | null = null;
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
  const hash = entry.id.charCodeAt(0) % CATEGORIES.length;
  return CATEGORIES[hash]?.v || "";
}

function getEntryStyle(entry: DesignIndexEntry): string {
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
  if (jsic === "6061") return "saas";
  if (jsic === "5811") return "ec";
  if (jsic === "7281") return "finance";
  const hash = jsic.charCodeAt(jsic.length - 1) % INDUSTRIES.length;
  return INDUSTRIES[hash]?.v || "";
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
  virtualNotice: string;
  labelVirtualBadge: string;
}

const TRANSLATIONS: Record<Locale, TranslationKeys> = {
  ja: {
    siteTitle: "DESIGN.md Library",
    brandSubtitle: "1億件以上のDESIGNファイルを検索・共有 / Search & share 100M+ DESIGN files",
    heroTag: "世界最大のDESIGNファイルライブラリ / World's largest DESIGN.md library",
    heroSub: "件のDESIGN.mdファイルが検索可能 / DESIGN.md files ready to search",
    placeholderSearch: "検索 / Search e.g. 'ミニマル ダッシュボード'",
    labelFacetCategory: "カテゴリ / Category",
    labelFacetStyle: "スタイル / Style",
    labelFacetIndustry: "業界 / Industry",
    labelFacetColor: "カラー / Color",
    labelActivePills: "適用中 / Active:",
    clearAll: "すべてクリア / Clear all",
    labelMatches: "件が一致 / files match",
    btnPopular: "人気順 / Popular",
    btnNewest: "新着順 / Newest",
    detailBack: "← 検索に戻る / Back to search",
    labelCodePreview: "DESIGN.md プレビュー / Preview",
    labelDownloads: "ダウンロード数 / Downloads",
    labelUpdated: "更新日 / Updated",
    labelLicense: "ライセンス / License",
    btnDownload: "ダウンロード / Download",
    btnCopy: "コピー / Copy",
    btnShare: "共有リンク / Share",
    labelRelated: "関連するDESIGNファイル / Related files",
    toastCopied: "Markdownをクリップボードにコピーしました",
    toastShareCopied: "共有リンクをコピーしました",
    toastDownloadStarted: "ダウンロードを開始しました",
    virtualNotice: "決定論的デザインエンジンによりリアルタイム合成されました。",
    labelVirtualBadge: "VIRTUAL",
  },
  en: {
    siteTitle: "DESIGN.md Library",
    brandSubtitle: "Search & share 100M+ DESIGN files",
    heroTag: "World's largest DESIGN.md library",
    heroSub: "DESIGN.md files ready to search",
    placeholderSearch: "Search / 検索 e.g. 'Minimal Dashboard'",
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
    labelDownloads: "Downloads",
    labelUpdated: "Updated",
    labelLicense: "License",
    btnDownload: "Download",
    btnCopy: "Copy",
    btnShare: "Share",
    labelRelated: "Related files",
    toastCopied: "Markdown copied to clipboard",
    toastShareCopied: "Share link copied to clipboard",
    toastDownloadStarted: "Download started",
    virtualNotice: "Synthesized in real-time by the deterministic design engine.",
    labelVirtualBadge: "VIRTUAL",
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
        showToast("Copy failed");
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
    if (counterEl) counterEl.textContent = animatedTotal.toLocaleString();
    if (step >= steps) {
      clearInterval(timer);
      setInterval(() => {
        animatedTotal += Math.floor(40 + Math.random() * 260);
        if (counterEl) counterEl.textContent = animatedTotal.toLocaleString();
      }, 4000);
    }
  }, 40);
}

// Fetch Taxonomy
async function loadTaxonomy(): Promise<Taxonomy> {
  try {
    const res = await fetch(DS_TAXONOMY_URL, { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return parseTaxonomy(await res.json());
  } catch {
    return EMPTY_TAXONOMY;
  }
}

// Dynamic UI Text Localization updates
function translateUI(): void {
  const t = TRANSLATIONS[currentLocale];
  document.title = "GoDD Matrix — DESIGN.md Library";
  document.documentElement.lang = currentLocale;

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

// Render the detailed view of a resolved specification
async function openDetail(entry: DesignIndexEntry, opts: { scroll?: boolean } = {}): Promise<void> {
  selectedCellId = entry.id;

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
  const titleJa =
    entry.title ||
    `${jsicName(entry.jsic) || entry.jsic} × ${labelForColor(entry.color, taxonomy)} × ${labelForMood(entry.mood, taxonomy)}`;
  byId("detail-filename").textContent = `${entry.id}.design.md`;
  byId("detail-title-ja").textContent = titleJa;
  byId("detail-title-en").textContent = `${entry.jsic} × ${entry.color} × ${entry.mood}`;

  // Description text
  byId("detail-desc-ja").textContent =
    `業種コード ${entry.jsic} （${jsicName(entry.jsic) || "不明"}）における、カラー「${labelForColor(entry.color, taxonomy)}」とムード「${labelForMood(entry.mood, taxonomy)}」の決定論的デザイン仕様書。`;
  byId("detail-desc-en").textContent =
    `Deterministic design specification matching industry code ${entry.jsic}, color tone ${entry.color}, and design mood ${entry.mood}.`;

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

  // Set download count simulation
  byId("detail-downloads-val").textContent = getDownloadsCount(entry).toLocaleString();
  byId("detail-updated-val").textContent = entry.createdAt
    ? entry.createdAt.slice(0, 10)
    : "2026-07-20";
  byId("detail-license-val").textContent = "MIT";

  // Hide virtual notice by default unless it is dynamic virtual cell
  const virtualNotice = byId("detail-virtual-notice");
  const isVirtual = entry.id.startsWith("virtual_") || !entry.hash;
  if (isVirtual) {
    virtualNotice.classList.remove("hidden");
    byId("label-virtual-badge").textContent = TRANSLATIONS[currentLocale].labelVirtualBadge;
    byId("detail-virtual-notice-text").textContent = TRANSLATIONS[currentLocale].virtualNotice;
  } else {
    virtualNotice.classList.add("hidden");
  }

  // Synthesize Markdown Content
  const prompt = composePromptForCell({ entry, hashVerified: !isVirtual });

  // Combine system prompt and markdown preview
  const finalMarkdown = `${prompt.systemPrompt}\n\n${prompt.userPrompt}`;
  const codeBlock = byId("detail-code-block");
  codeBlock.textContent = finalMarkdown;

  // Bind sidebar action buttons
  const t = TRANSLATIONS[currentLocale];
  byId("btn-download").onclick = () => downloadMarkdown(`${entry.id}.design.md`, finalMarkdown);
  byId("btn-copy").onclick = () => copyText(finalMarkdown, t.toastCopied);
  byId("btn-share").onclick = () => copyText(window.location.href, t.toastShareCopied);

  // Load related design entries
  const relatedGrid = byId("related-grid");
  relatedGrid.replaceChildren();
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
    thumb.appendChild(el("div", { class: "preview-overlay", text: "PREVIEW" }));
    card.appendChild(thumb);

    const body = el("div", { class: "related-body" });
    const rTitle =
      item.title || `${jsicName(item.jsic) || item.jsic} × ${labelForColor(item.color, taxonomy)}`;
    body.appendChild(el("div", { class: "related-card-title-ja", text: rTitle }));
    body.appendChild(
      el("div", { class: "related-card-title-en", text: `${item.jsic} × ${item.color}` }),
    );
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
      title: c.name,
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

// Apply states, filter lists, and render UI
function applyState(): void {
  renderFilters();

  const filteredRaw = getFilteredList();
  const pageView = paginate(filteredRaw, currentPage, PAGE_SIZE);
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
      label: c ? (currentLocale === "ja" ? c.name : c.slug) : filters.color,
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

  // Calculate estimated matching files
  const ratio = filteredRaw.length / Math.max(1, allEntries.length);
  const isFiltered = !!(
    filters.category ||
    filters.style ||
    filters.industry ||
    filters.color ||
    searchQuery
  );
  const estimatedCount = isFiltered
    ? Math.max(filteredRaw.length, Math.round(TOTAL_LIBRARY * ratio))
    : TOTAL_LIBRARY;

  // Exact integer display
  byId("matches-count-display").replaceChildren(
    document.createTextNode(estimatedCount.toLocaleString()),
    el("span", {
      class: "matches-count-label",
      text: ` ${TRANSLATIONS[currentLocale].labelMatches}`,
    }),
  );

  byId("sample-count-display").textContent =
    currentLocale === "ja"
      ? `${filteredRaw.length}件のサンプルを表示中 / Showing ${filteredRaw.length} sample results`
      : `Showing ${filteredRaw.length} sample results`;

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
      thumb.appendChild(el("div", { class: "preview-overlay", text: "PREVIEW" }));
      card.appendChild(thumb);

      const body = el("div", { class: "card-body" });
      const titleJa =
        entry.title ||
        `${jsicName(entry.jsic) || entry.jsic} × ${labelForColor(entry.color, taxonomy)}`;
      body.appendChild(el("div", { class: "card-title-ja", text: titleJa }));
      body.appendChild(
        el("div", {
          class: "card-title-en",
          text: `${entry.jsic} × ${entry.color} × ${entry.mood}`,
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
      footer.appendChild(el("span", { text: `↓ ${formatDownloads(getDownloadsCount(entry))}` }));
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

// Generate the filtered files subset
function getFilteredList(): readonly DesignIndexEntry[] {
  let list = allEntries;
  const q = searchQuery.toLowerCase().trim();
  if (q) {
    const terms = highlightTermsFromText(q);
    list = list.filter((item) => {
      const nameJa = jsicName(item.jsic) || "";
      const textMatches =
        item.title?.toLowerCase().includes(q) ||
        nameJa.toLowerCase().includes(q) ||
        item.jsic.toLowerCase().includes(q) ||
        (item.tags || []).some((t) => t.toLowerCase().includes(q));
      return textMatches;
    });
  }
  if (filters.category) {
    list = list.filter((item) => getEntryCategory(item) === filters.category);
  }
  if (filters.style) {
    list = list.filter((item) => getEntryStyle(item) === filters.style);
  }
  if (filters.industry) {
    list = list.filter((item) => getEntryIndustry(item) === filters.industry);
  }
  if (filters.color) {
    list = list.filter((item) => item.color === filters.color);
  }

  // Sort
  if (sortOrder === "popular") {
    list = [...list].sort((a, b) => getDownloadsCount(b) - getDownloadsCount(a));
  } else {
    list = [...list].sort(
      (a, b) => new Date(b.createdAt || "").getTime() - new Date(a.createdAt || "").getTime(),
    );
  }

  return list;
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

  // Set Pre-generated Count
  byId("stat-materialized-count").textContent = allEntries.length.toLocaleString();

  taxonomy = await loadTaxonomy();

  // Setup Event Listeners
  byId("locale-select").onchange = (e) => {
    const val = (e.target as HTMLSelectElement).value as Locale;
    currentLocale = val;
    localStorage.setItem("godd_locale", val);
    translateUI();
    applyState();
    if (selectedCellId) {
      const entry = findEntryById(allEntries, selectedCellId);
      if (entry) void openDetail(entry, { scroll: false });
    }
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
    selectedCellId = null;
    window.history.replaceState(null, "", window.location.pathname);
    byId("detail-view").classList.add("hidden");
    byId("search-view").classList.remove("hidden");
  };

  // Restore state from URL permalink if any
  const params = new URLSearchParams(window.location.search);
  const cellParam = params.get("cell");
  if (cellParam) {
    const entry = findEntryById(allEntries, cellParam);
    if (entry) {
      void openDetail(entry);
    }
  }

  applyState();
}

void bootstrap();

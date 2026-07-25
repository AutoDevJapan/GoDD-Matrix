/**
 * User-facing filter taxonomy (categories, styles, industry verticals).
 * Kept in sync with virtual-catalog CANONICAL_* axes.
 */

export interface LabeledOption {
  readonly v: string;
  readonly ja: string;
  readonly en: string;
}

/** Expanded surface / product categories. */
export const FILTER_CATEGORIES: readonly LabeledOption[] = [
  { v: "lp", ja: "ランディングページ", en: "Landing Page" },
  { v: "dashboard", ja: "ダッシュボード", en: "Dashboard" },
  { v: "mobile", ja: "モバイルアプリ", en: "Mobile App" },
  { v: "saas", ja: "SaaS プロダクト", en: "SaaS Product" },
  { v: "portfolio", ja: "ポートフォリオ", en: "Portfolio" },
  { v: "ecommerce", ja: "EC / ストア", en: "E-commerce" },
  { v: "admin", ja: "管理画面", en: "Admin Panel" },
  { v: "blog", ja: "ブログ / メディア", en: "Blog / Media" },
  { v: "docs", ja: "ドキュメント", en: "Documentation" },
  { v: "pricing", ja: "料金ページ", en: "Pricing" },
  { v: "onboarding", ja: "オンボーディング", en: "Onboarding" },
  { v: "settings", ja: "設定画面", en: "Settings" },
  { v: "checkout", ja: "チェックアウト", en: "Checkout" },
  { v: "community", ja: "コミュニティ", en: "Community" },
  { v: "marketing", ja: "マーケティングサイト", en: "Marketing Site" },
  { v: "form", ja: "フォーム / 登録", en: "Form / Signup" },
] as const;

/** Expanded visual styles. */
export const FILTER_STYLES: readonly LabeledOption[] = [
  { v: "minimal", ja: "ミニマル", en: "Minimal" },
  { v: "corporate", ja: "コーポレート", en: "Corporate" },
  { v: "editorial", ja: "エディトリアル", en: "Editorial" },
  { v: "brutalist", ja: "ブルータリズム", en: "Brutalist" },
  { v: "glass", ja: "グラスモーフィズム", en: "Glassmorphism" },
  { v: "soft", ja: "ソフト UI", en: "Soft UI" },
  { v: "dark", ja: "ダーク", en: "Dark" },
  { v: "playful", ja: "プレイフル", en: "Playful" },
  { v: "luxury", ja: "ラグジュアリー", en: "Luxury" },
  { v: "retro", ja: "レトロ", en: "Retro" },
  { v: "industrial", ja: "インダストリアル", en: "Industrial" },
  { v: "flat", ja: "フラット", en: "Flat" },
  { v: "swiss", ja: "スイススタイル", en: "Swiss" },
  { v: "organic", ja: "オーガニック", en: "Organic" },
  { v: "tech", ja: "テック", en: "Tech" },
  { v: "warm", ja: "ウォーム", en: "Warm" },
] as const;

/**
 * Job / business verticals users recognize (not raw JSIC majors).
 * `codes` are real JSIC fine-class codes; keywords boost free-text / overlay match.
 */
export interface IndustryVertical extends LabeledOption {
  readonly codes: readonly string[];
  readonly keywords: readonly string[];
}

export const INDUSTRY_VERTICALS: readonly IndustryVertical[] = [
  {
    v: "game-dev",
    ja: "ゲーム開発",
    en: "Game development",
    codes: ["3914"],
    keywords: ["ゲーム", "game", "gaming", "ゲーム開発", "ゲームソフト"],
  },
  {
    v: "game-arcade",
    ja: "ゲームセンター / アミューズメント",
    en: "Arcades / Amusement",
    codes: ["8065"],
    keywords: ["ゲームセンター", "アミューズメント", "arcade"],
  },
  {
    v: "saas-dev",
    ja: "SaaS / 受託開発",
    en: "SaaS / Custom software",
    codes: ["3911"],
    keywords: ["saas", "ソフトウェア", "受託開発", "システム開発"],
  },
  {
    v: "consulting",
    ja: "コンサルティング",
    en: "Consulting",
    codes: ["7281"],
    keywords: ["コンサル", "consulting", "経営コンサル"],
  },
  {
    v: "finance",
    ja: "金融 / 保険",
    en: "Finance / Insurance",
    codes: ["6211", "6511", "6711"],
    keywords: ["金融", "銀行", "保険", "finance", "fintech"],
  },
  {
    v: "healthcare",
    ja: "医療 / 福祉",
    en: "Healthcare",
    codes: ["8311", "8411"],
    keywords: ["医療", "病院", "福祉", "healthcare", "clinic"],
  },
  {
    v: "education",
    ja: "教育",
    en: "Education",
    codes: ["8111", "8211"],
    keywords: ["教育", "学校", "学習", "education", "edtech"],
  },
  {
    v: "retail",
    ja: "小売 / EC",
    en: "Retail / Commerce",
    codes: ["5611", "6061"],
    keywords: ["小売", "EC", "店舗", "retail", "commerce"],
  },
  {
    v: "food",
    ja: "飲食",
    en: "Food & beverage",
    codes: ["7611", "7671"],
    keywords: ["飲食", "レストラン", "カフェ", "food", "cafe"],
  },
  {
    v: "legal",
    ja: "士業 / 法律",
    en: "Legal / Professional",
    codes: ["7211"],
    keywords: ["法律", "弁護士", "legal", "law"],
  },
  {
    v: "design-agency",
    ja: "デザイン業",
    en: "Design agency",
    codes: ["7261"],
    keywords: ["デザイン", "design", "クリエイティブ"],
  },
  {
    v: "travel",
    ja: "旅行 / 宿泊",
    en: "Travel / Lodging",
    codes: ["7911", "7511"],
    keywords: ["旅行", "ホテル", "宿泊", "travel", "hotel"],
  },
] as const;

export function categoryLabel(value: string, locale: "ja" | "en"): string {
  const hit = FILTER_CATEGORIES.find((item) => item.v === value);
  if (!hit) return value;
  return locale === "ja" ? hit.ja : hit.en;
}

export function styleLabel(value: string, locale: "ja" | "en"): string {
  const hit = FILTER_STYLES.find((item) => item.v === value);
  if (!hit) return value;
  return locale === "ja" ? hit.ja : hit.en;
}

export function verticalLabel(value: string, locale: "ja" | "en"): string {
  const hit = INDUSTRY_VERTICALS.find((item) => item.v === value);
  if (!hit) return value;
  return locale === "ja" ? hit.ja : hit.en;
}

/** Toggle membership in a multi-select list (order-preserving). */
export function toggleSelection(selected: readonly string[], value: string): string[] {
  return selected.includes(value)
    ? selected.filter((item) => item !== value)
    : [...selected, value];
}

/** Parse comma-separated URL multi-values. */
export function parseMultiParam(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

export function serializeMultiParam(values: readonly string[]): string | null {
  return values.length > 0 ? values.join(",") : null;
}

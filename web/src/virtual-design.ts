import type { DesignIndexEntry } from "../../src/ds/types.js";
import type { Locale } from "./lib.js";

export interface VirtualDesignLabels {
  readonly title: string;
  readonly industry: string;
  readonly color: string;
  readonly mood: string;
  readonly swatches: readonly string[];
}

function stableHash(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Build a standalone, deterministic DESIGN.md specification without cross-repository assets. */
export function buildVirtualDesign(
  entry: DesignIndexEntry,
  locale: Locale,
  labels: VirtualDesignLabels,
): string {
  const tags = entry.tags?.join(", ") || "—";
  const variant = Math.max(0, entry.variant ?? 0);
  const category = entry.tags?.[0] ?? "general";
  const seed = stableHash(`${entry.id}|${entry.jsic}|${entry.color}|${entry.mood}|${variant}`);
  const layouts = ["single-column", "sidebar", "split-view", "modular-grid"] as const;
  const densities = ["comfortable", "compact", "spacious"] as const;
  const fontPairs = [
    "system-ui, ui-sans-serif",
    "ui-serif, system-ui",
    "system-ui, ui-monospace",
  ] as const;
  const componentPatterns = ["task-first", "data-dense", "editorial", "guided-flow"] as const;
  const radii = ["0px", "4px", "8px", "12px"] as const;
  const layout = layouts[seed % layouts.length] ?? "single-column";
  const density = densities[(seed >>> 3) % densities.length] ?? "comfortable";
  const fontPair = fontPairs[(seed >>> 7) % fontPairs.length] ?? "system-ui, ui-sans-serif";
  const componentPattern =
    componentPatterns[(seed >>> 11) % componentPatterns.length] ?? "task-first";
  const radius = radii[(seed >>> 15) % radii.length] ?? "4px";
  const jaLayout = {
    "single-column": "単一カラム",
    sidebar: "サイドバー",
    "split-view": "分割ビュー",
    "modular-grid": "モジュラーグリッド",
  }[layout];
  const jaDensity = { comfortable: "標準", compact: "高密度", spacious: "ゆったり" }[density];
  const jaCategory =
    (
      {
        dashboard: "ダッシュボード",
        lp: "ランディングページ",
        mobile: "モバイルアプリ",
        portfolio: "ポートフォリオ",
        ecommerce: "EC",
        admin: "管理画面",
        blog: "ブログ",
        form: "フォーム",
      } as Record<string, string>
    )[category] ?? category;
  const jaComponentPattern = {
    "task-first": "タスク優先",
    "data-dense": "情報高密度",
    editorial: "編集コンテンツ型",
    "guided-flow": "段階誘導型",
  }[componentPattern];
  const palette =
    labels.swatches.length > 0
      ? labels.swatches.map((hex, index) => `- \`--color-${index + 1}\`: \`${hex}\``)
      : [locale === "ja" ? "- 利用可能なカラートークンなし" : "- No color tokens available"];

  if (locale === "ja") {
    return [
      `# ${labels.title}`,
      "",
      "## コンテキスト",
      "",
      `- 業種: ${labels.industry}（JSIC ${entry.jsic}）`,
      `- カラー: ${labels.color}（${entry.color}）`,
      `- ムード: ${labels.mood}（${entry.mood}）`,
      `- タグ: ${tags}`,
      `- バリアント: ${variant}（${jaLayout} / ${jaDensity}）`,
      "",
      "## デザイン方針",
      "",
      `${labels.industry}向けに、${labels.color}の配色と${labels.mood}のムードを一貫して適用する。情報の優先順位を明確にし、装飾より可読性と操作性を優先する。`,
      "",
      "## カラートークン",
      "",
      ...palette,
      "",
      "## タイポグラフィ",
      "",
      `- 書体ペア（CSS）: \`${fontPair}\``,
      `- 本文: ${density === "compact" ? "15px" : "16px"}、行高 ${density === "spacious" ? "1.75" : "1.6"}`,
      "- 見出し: system-ui、700、本文とのコントラストを明確にする",
      "- 補助テキスト: 14px以上、背景とのコントラスト比 4.5:1 以上",
      "",
      "## レイアウトと間隔",
      "",
      `- 構成: ${jaLayout}（${jaCategory}の主要タスクを最短導線に置く）`,
      `- 角丸トークン: \`${radius}\``,
      "- 4px基準のスペーシングスケールを使用する",
      "- コンテンツ幅を制限し、モバイルでは1カラムへ縮退する",
      "- 主要操作間に十分な余白を確保し、44px以上のタップ領域を保つ",
      "",
      "## コンポーネント",
      "",
      `- ${jaCategory}向けの主要操作を主操作として一つに絞る`,
      `- コンポーネント構成: ${jaComponentPattern}`,
      "- ボタン: primary / secondary / disabled / focus-visible を定義する",
      "- 入力: label、説明、エラーを関連付ける",
      "- カード: 見出し、本文、操作の順で一貫した構造にする",
      "",
      "## レスポンシブとアクセシビリティ",
      "",
      "- 320pxからデスクトップまで横スクロールを発生させない",
      "- キーボードのみですべての操作を完了可能にする",
      "- 色だけで状態を伝えず、テキストまたはアイコンを併用する",
      "- prefers-reduced-motion を尊重する",
    ].join("\n");
  }

  return [
    `# ${labels.title}`,
    "",
    "## Context",
    "",
    `- Industry: ${labels.industry} (JSIC ${entry.jsic})`,
    `- Color: ${labels.color} (${entry.color})`,
    `- Mood: ${labels.mood} (${entry.mood})`,
    `- Tags: ${tags}`,
    `- Variant: ${variant} (${layout} / ${density})`,
    "",
    "## Design direction",
    "",
    `Apply the ${labels.color} palette and ${labels.mood} mood consistently for ${labels.industry}. Establish a clear information hierarchy and prioritize readability and operability over decoration.`,
    "",
    "## Color tokens",
    "",
    ...palette,
    "",
    "## Typography",
    "",
    `- Font pair: ${fontPair}`,
    `- Body: ${density === "compact" ? "15px" : "16px"}, ${density === "spacious" ? "1.75" : "1.6"} line height`,
    "- Headings: system-ui, 700, with clear contrast from body text",
    "- Supporting text: at least 14px and 4.5:1 contrast against its background",
    "",
    "## Layout and spacing",
    "",
    `- Structure: ${layout}, placing the primary ${category} task on the shortest path`,
    `- Corner-radius token: \`${radius}\``,
    "- Use a 4px-based spacing scale",
    "- Constrain content width and collapse to one column on mobile",
    "- Keep primary actions separated and provide tap targets of at least 44px",
    "",
    "## Components",
    "",
    `- Keep one primary action for the core ${category} task`,
    `- Component pattern: ${componentPattern}`,
    "- Buttons: define primary, secondary, disabled, and focus-visible states",
    "- Inputs: associate labels, descriptions, and errors programmatically",
    "- Cards: keep a consistent heading, content, and action structure",
    "",
    "## Responsive behavior and accessibility",
    "",
    "- Avoid horizontal scrolling from 320px through desktop widths",
    "- Make every interaction available from the keyboard",
    "- Never communicate state through color alone; pair it with text or an icon",
    "- Respect prefers-reduced-motion",
  ].join("\n");
}

import type { DesignIndexEntry } from "../../src/ds/types.js";
import type { Locale } from "./lib.js";

export interface VirtualDesignLabels {
  readonly title: string;
  readonly industry: string;
  readonly color: string;
  readonly mood: string;
  readonly swatches: readonly string[];
}

/** Build a standalone, deterministic DESIGN.md specification without cross-repository assets. */
export function buildVirtualDesign(
  entry: DesignIndexEntry,
  locale: Locale,
  labels: VirtualDesignLabels,
): string {
  const tags = entry.tags?.join(", ") || "—";
  const palette = labels.swatches.map((hex, index) => `- \`--color-${index + 1}\`: \`${hex}\``);

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
      "- 本文: system-ui、16px、行高 1.6",
      "- 見出し: system-ui、700、本文とのコントラストを明確にする",
      "- 補助テキスト: 14px以上、背景とのコントラスト比 4.5:1 以上",
      "",
      "## レイアウトと間隔",
      "",
      "- 4px基準のスペーシングスケールを使用する",
      "- コンテンツ幅を制限し、モバイルでは1カラムへ縮退する",
      "- 主要操作間に十分な余白を確保し、44px以上のタップ領域を保つ",
      "",
      "## コンポーネント",
      "",
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
    "- Body: system-ui, 16px, 1.6 line height",
    "- Headings: system-ui, 700, with clear contrast from body text",
    "- Supporting text: at least 14px and 4.5:1 contrast against its background",
    "",
    "## Layout and spacing",
    "",
    "- Use a 4px-based spacing scale",
    "- Constrain content width and collapse to one column on mobile",
    "- Keep primary actions separated and provide tap targets of at least 44px",
    "",
    "## Components",
    "",
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

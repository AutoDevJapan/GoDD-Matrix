/**
 * 軸解決の共通正規化 (SSOT §2)。
 * 表記ゆれ (全角/半角・大文字小文字・空白) を吸収し、一致判定を安定させる。
 */

/** NFKC 正規化 + 小文字化 + 空白除去。日本語/英語の表記ゆれを畳む。 */
export function normalizeKey(input: string): string {
  return input
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s　]+/g, "")
    .trim();
}

/**
 * 軸解決で「最良の 1 件 (best)」を選ぶ共通規則 (業種 / カラー / ムード)。
 */

/** 解決器の挙動オプション。 */
export interface ResolveOptions {
  /**
   * 最高 score の候補が複数の別エントリに並ぶとき、best を確定せず未解決にする。
   * 既定 false (従来動作: score 降順 → 識別子昇順の先頭を best にする)。
   *
   * 本物の DS taxonomy / jsic は同じ名称を複数のエントリが共有する (旧 slug と新 slug、
   * 同名の細分類など)。曖昧な入力で任意の 1 件を黙って選ばず、候補から選ばせるために使う。
   * 完全一致 (slug / コード) は一意なので、このオプションでも常に確定する。
   */
  readonly rejectTies?: boolean;
}

/**
 * score 降順に整列済みの候補から best を選ぶ。
 * rejectTies のとき、首位と同じ score の候補が他にもあれば undefined (確定しない)。
 */
export function pickBest<T extends { readonly score: number }>(
  sorted: readonly T[],
  options: ResolveOptions = {},
): T | undefined {
  const first = sorted[0];
  if (first === undefined) return undefined;
  if (options.rejectTies && sorted[1]?.score === first.score) return undefined;
  return first;
}

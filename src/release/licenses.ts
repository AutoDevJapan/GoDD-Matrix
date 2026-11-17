/**
 * 同梱した依存のライセンス表記 (THIRD-PARTY-LICENSES.txt) の生成。
 *
 * バンドルした依存のコードを再配布する以上、各パッケージのライセンス全文を成果物に添える。
 * 同梱した依存の洗い出しは esbuild の入力一覧から行い、ライセンス全文が取れない依存があれば
 * 生成を失敗させる (黙って省かない)。
 */

/** 同梱した依存パッケージ 1 件のライセンス。 */
export interface PackageLicense {
  readonly name: string;
  readonly version: string;
  /** package.json の `license` (SPDX 識別子)。 */
  readonly license: string;
  /** ライセンス全文。 */
  readonly text: string;
}

/**
 * esbuild の入力パス一覧から、同梱した依存パッケージの root (最後の `node_modules/` 直下) を求める。
 * 自分のソース (node_modules の外) は含めない。重複は除き、辞書順で返す。
 */
export function packageRootsFromInputs(inputs: readonly string[]): string[] {
  const roots = new Set<string>();
  for (const input of inputs) {
    const parts = input.replaceAll("\\", "/").split("/");
    const at = parts.lastIndexOf("node_modules");
    if (at < 0) continue;
    const first = parts[at + 1];
    if (first === undefined) continue;
    const take = first.startsWith("@") ? 2 : 1;
    if (parts.length <= at + take) continue;
    roots.add(parts.slice(0, at + 1 + take).join("/"));
  }
  return [...roots].sort();
}

/** ライセンス一覧を THIRD-PARTY-LICENSES.txt の本文にする (名前@版 順、重複は 1 件)。 */
export function formatThirdPartyLicenses(packages: readonly PackageLicense[]): string {
  if (packages.length === 0) {
    throw new Error(
      "同梱した依存のライセンスが 0 件です。依存の洗い出しに失敗した可能性があります",
    );
  }
  const byKey = new Map<string, PackageLicense>();
  for (const pkg of packages) {
    if (pkg.text.trim().length === 0) {
      throw new Error(`${pkg.name}@${pkg.version}: ライセンス全文が取得できません`);
    }
    byKey.set(`${pkg.name}@${pkg.version}`, pkg);
  }
  const lines = [
    "This distribution bundles the following third-party software.",
    "Each package is provided under its own license, reproduced below.",
    "",
  ];
  for (const key of [...byKey.keys()].sort()) {
    const pkg = byKey.get(key);
    if (!pkg) continue;
    lines.push(`==== ${key} (${pkg.license}) ====`, pkg.text.trim(), "");
  }
  return `${lines.join("\n")}`;
}

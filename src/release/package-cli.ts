/**
 * 正式配布物の生成コマンド (scripts/package-mcp.mjs から呼ぶ)。
 *
 *   node scripts/package-mcp.mjs --out <dir> [--pin <file>] [--source-dir <dir>] [--tarball <file>]
 *
 * 事前に `pnpm build` で dist/ を作っておくこと。
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { packageMcp } from "./package.js";

/** コマンドライン引数。 */
export interface CliArgs {
  readonly out: string;
  readonly pin?: string;
  readonly sourceDir?: string;
  readonly tarball?: string;
}

const VALUE_FLAGS = {
  "--out": "out",
  "--pin": "pin",
  "--source-dir": "sourceDir",
  "--tarball": "tarball",
} as const satisfies Record<string, keyof CliArgs>;

/**
 * 引数を厳密にパースする (未知のフラグ・値の欠落・--out の欠落は拒否)。
 * @throws Error 引数が不正な場合。
 */
export function parseCliArgs(argv: readonly string[]): CliArgs {
  const values: Partial<Record<keyof CliArgs, string>> = {};
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i] as string;
    const key = (VALUE_FLAGS as Record<string, keyof CliArgs | undefined>)[flag];
    if (key === undefined) throw new Error(`未知の引数です: ${flag}`);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`${flag} に値がありません`);
    }
    if (values[key] !== undefined) throw new Error(`${flag} が重複しています`);
    values[key] = value;
  }
  if (values.out === undefined) throw new Error("--out <出力先ディレクトリ> は必須です");
  return {
    out: values.out,
    ...(values.pin !== undefined ? { pin: values.pin } : {}),
    ...(values.sourceDir !== undefined ? { sourceDir: values.sourceDir } : {}),
    ...(values.tarball !== undefined ? { tarball: values.tarball } : {}),
  };
}

/** リポジトリの root (dist/release/ または src/release/ の 2 つ上)。 */
function defaultRepoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
}

/**
 * 生成コマンドを実行する。成功は 0、引数不正は 2、それ以外の失敗は 1 を返す。
 * 結果は標準出力へ JSON 1 件、進捗と失敗理由は標準エラーへ出す。
 */
export async function runPackageCli(argv: readonly string[]): Promise<number> {
  let args: CliArgs;
  try {
    args = parseCliArgs(argv);
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n`);
    return 2;
  }
  try {
    const result = await packageMcp({
      repoRoot: defaultRepoRoot(),
      outDir: path.resolve(args.out),
      ...(args.pin !== undefined ? { pinFile: path.resolve(args.pin) } : {}),
      ...(args.sourceDir !== undefined ? { sourceDir: path.resolve(args.sourceDir) } : {}),
      ...(args.tarball !== undefined ? { tarball: path.resolve(args.tarball) } : {}),
      onProgress: (message) => process.stderr.write(`[package-mcp] ${message}\n`),
    });
    process.stdout.write(
      `${JSON.stringify(
        {
          outDir: result.outDir,
          files: result.verification.files,
          commit: result.verification.pin.commit,
          entries: result.verification.entries,
          colors: result.verification.colors,
          moods: result.verification.moods,
          subclasses: result.verification.subclasses,
          bodiesVerified: result.bodies.verified,
          mainJsSha256: result.mainJsSha256,
          dependencies: result.dependencies,
        },
        null,
        2,
      )}\n`,
    );
    return 0;
  } catch (error) {
    process.stderr.write(`[package-mcp] 失敗しました: ${(error as Error).message}\n`);
    return 1;
  }
}

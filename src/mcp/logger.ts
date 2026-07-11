/**
 * HTTP/MCP 層の構造化ログ (observability, issue #21)。
 *
 * 本番 (Vercel) で失敗原因を追跡できるよう、リクエスト単位の JSON Lines ログを
 * 最小コストで出力する。1 レコード = 1 行の JSON で、フィールドは
 * `timestamp` / `level` / `msg` / `requestId` / `method` / `tool` / `durationMs` /
 * `status` / `error` などを持つ。
 *
 * 設計方針:
 * - 差し替え可能な {@link Logger} インタフェース。既定は console へ JSON を書く
 *   ({@link createConsoleLogger})。テストでは `sink` を注入して構造を検証できる。
 * - 副作用 (時刻取得・console 出力) は本モジュールに閉じる。
 * - 秘密情報 (API キー等) は {@link ConsoleLoggerOptions.secrets} に渡した値を
 *   出力直前に `***` へ置換してから書き出す (握り潰しではなく安全なログ)。
 * - `requestId` は {@link Logger.child} でバインドし、リクエスト内で伝播させる。
 */

/** ログレベル。数値順で閾値判定する。 */
export type LogLevel = "debug" | "info" | "warn" | "error";

/** レベルの重み (小さいほど詳細)。閾値未満は出力しない。 */
const LEVEL_WEIGHT: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** ログに載せる任意の構造化フィールド。 */
export interface LogFields {
  requestId?: string;
  method?: string;
  tool?: string;
  durationMs?: number;
  status?: number | string;
  error?: string;
  [key: string]: unknown;
}

/** 1 行として出力される構造化ログレコード。 */
export interface LogRecord extends LogFields {
  timestamp: string;
  level: LogLevel;
  msg: string;
}

/** 差し替え可能なロガー。副作用 (出力先) は実装に閉じる。 */
export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
  /** 追加のバインド (requestId 等) を持つ子ロガーを返す。伝播に用いる。 */
  child(bindings: LogFields): Logger;
}

/** ログ有効/レベルを制御する環境変数名。 */
export const LOG_LEVEL_ENV = "GODD_MCP_LOG_LEVEL";
export const LOG_ENABLED_ENV = "GODD_MCP_LOG";

/** 既定で伏せるべき環境変数名 (値をマスク対象に加える)。 */
const SECRET_ENV_KEYS = ["GODD_MCP_API_KEY", "GENERATOR_RENDER_API_KEY"] as const;

/** {@link createConsoleLogger} のオプション。 */
export interface ConsoleLoggerOptions {
  /** 出力する最小レベル。省略時は環境変数 {@link LOG_LEVEL_ENV} / 既定 `info`。 */
  level?: LogLevel;
  /** ログ全体の有効/無効。省略時は環境変数 {@link LOG_ENABLED_ENV} で判定 (既定 有効)。 */
  enabled?: boolean;
  /**
   * 出力先。省略時はレベルに応じ console.error (warn/error) / console.log に書く。
   * テストでは組み立て済みレコードを受け取って構造を検証できる。
   */
  sink?: (record: LogRecord) => void;
  /**
   * 出力前にマスクする秘密値 (API キー等)。ここに渡した文字列は、全フィールドの
   * 文字列表現から検出して `***` に置換する。undefined / 空文字は無視。
   */
  secrets?: Array<string | undefined>;
  /** 現在時刻の供給 (テスト用)。省略時は {@link Date}。 */
  now?: () => Date;
  /** 既定でレコードへ載せるバインド (child が積み上げる)。 */
  bindings?: LogFields;
}

/** `off` / `false` / `0` / `no` はログ無効とみなす。 */
function isDisabledValue(raw: string | undefined): boolean {
  if (raw === undefined) return false;
  const v = raw.trim().toLowerCase();
  return v === "off" || v === "false" || v === "0" || v === "no";
}

/** 環境変数からログレベルを解決する。不正値は `info`。 */
function resolveLevel(explicit: LogLevel | undefined): LogLevel {
  if (explicit) return explicit;
  const raw = process.env[LOG_LEVEL_ENV]?.trim().toLowerCase();
  if (raw === "debug" || raw === "info" || raw === "warn" || raw === "error") return raw;
  return "info";
}

/** マスク対象の秘密値集合を構築する (明示指定 + 既定の秘密 env 値)。 */
function collectSecrets(explicit: Array<string | undefined> | undefined): string[] {
  const out = new Set<string>();
  for (const s of explicit ?? []) {
    if (s) out.add(s);
  }
  for (const key of SECRET_ENV_KEYS) {
    const v = process.env[key];
    if (v) out.add(v);
  }
  return [...out];
}

/** 文字列中の秘密値を `***` に置換する。 */
function maskString(text: string, secrets: string[]): string {
  let out = text;
  for (const secret of secrets) {
    if (secret.length === 0) continue;
    out = out.split(secret).join("***");
  }
  return out;
}

/**
 * レコードの文字列フィールドから秘密値をマスクする (浅い走査で十分)。
 * 値が文字列でなければそのまま。ネスト時は JSON 化してから判定する。
 */
export function maskSecrets<T extends Record<string, unknown>>(record: T, secrets: string[]): T {
  if (secrets.length === 0) return record;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === "string") {
      out[key] = maskString(value, secrets);
    } else if (value !== null && typeof value === "object") {
      out[key] = JSON.parse(maskString(JSON.stringify(value), secrets));
    } else {
      out[key] = value;
    }
  }
  return out as T;
}

/**
 * console へ JSON Lines を書く既定ロガーを生成する。
 * `warn` / `error` は `console.error`、それ以外は `console.log` に出力する
 * (サーバレスのログ集約でレベル別に扱えるようにする)。
 */
export function createConsoleLogger(options: ConsoleLoggerOptions = {}): Logger {
  const enabled = options.enabled ?? !isDisabledValue(process.env[LOG_ENABLED_ENV]);
  const threshold = LEVEL_WEIGHT[resolveLevel(options.level)];
  const secrets = collectSecrets(options.secrets);
  const now = options.now ?? (() => new Date());
  const sink =
    options.sink ??
    ((record: LogRecord) => {
      const line = JSON.stringify(record);
      if (record.level === "warn" || record.level === "error") {
        console.error(line);
      } else {
        console.log(line);
      }
    });

  function make(bindings: LogFields): Logger {
    function emit(level: LogLevel, msg: string, fields?: LogFields): void {
      if (!enabled) return;
      if (LEVEL_WEIGHT[level] < threshold) return;
      const record: LogRecord = {
        timestamp: now().toISOString(),
        level,
        msg,
        ...bindings,
        ...fields,
      };
      sink(maskSecrets(record, secrets));
    }
    return {
      debug: (msg, fields) => emit("debug", msg, fields),
      info: (msg, fields) => emit("info", msg, fields),
      warn: (msg, fields) => emit("warn", msg, fields),
      error: (msg, fields) => emit("error", msg, fields),
      child: (childBindings) => make({ ...bindings, ...childBindings }),
    };
  }

  return make(options.bindings ?? {});
}

/** 何も出力しないロガー (ログを完全に無効化したい層 / テスト用)。 */
export function createNoopLogger(): Logger {
  const noop: Logger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    child: () => noop,
  };
  return noop;
}

/** リクエスト ID を採番する (Web / Node 20 の crypto.randomUUID を利用)。 */
export function newRequestId(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  // 後方互換の簡易フォールバック (衝突許容の相関 ID)。
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

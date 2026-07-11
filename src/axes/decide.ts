/**
 * 要望 (DesignBrief) → 軸決定 → 候補セル選定 (issue #5, SSOT §2/§4)。
 *
 * データフロー: 要望 → 軸 (JSIC / カラー / ムード) → {@link DesignIndexClient} で候補セル。
 * 各軸の決定は差し替え可能な resolver に委譲し、全軸が決まったときのみ {@link AxisContext}
 * を確定する。未解決軸は `unresolved` で明示し、呼び出し側の判断 (再入力/既定適用) に委ねる。
 */
import type { DesignIndexClient } from "../ds/client.js";
import type { DesignIndexEntry } from "../ds/types.js";
import type { AxisContext, ColorKey, MoodKey } from "./index.js";
import { type JsicResolution, type JsicResolver, StaticJsicResolver } from "./jsic.js";
import {
  type SlugResolver,
  StaticColorResolver,
  StaticMoodResolver,
  type TaxonomyResolution,
} from "./taxonomy.js";

/** 生成要望。業種は必須、カラー/ムードは任意 (未指定なら既定 or 未解決)。 */
export interface DesignBrief {
  /** 業種名 / キーワード / JSIC コード。 */
  industry: string;
  /** カラーの希望 (色名/slug)。任意。 */
  color?: string;
  /** ムードの希望。任意。 */
  mood?: string;
  /** 追加タグ (タイポ/レイアウト等)。候補セルの絞り込みに使う。 */
  tags?: readonly string[];
}

/** 軸決定に使う resolver 群 (差し替え可能)。 */
export interface AxisResolvers {
  jsic?: JsicResolver;
  color?: SlugResolver<ColorKey>;
  mood?: SlugResolver<MoodKey>;
}

/** カラー/ムードが未指定のときに適用する既定 slug。 */
export interface AxisDefaults {
  color?: ColorKey;
  mood?: MoodKey;
}

/** 軸決定のオプション。 */
export interface DecideOptions {
  resolvers?: AxisResolvers;
  defaults?: AxisDefaults;
}

/** 未解決になりうる軸名。 */
export type AxisName = "jsic" | "color" | "mood";

/** 軸決定の結果。全軸が決まれば {@link AxisContext} を持つ。 */
export interface AxisDecision {
  /** 全軸解決時の確定 context (未解決軸があれば undefined)。 */
  context?: AxisContext;
  jsic: JsicResolution;
  color: TaxonomyResolution<ColorKey>;
  mood: TaxonomyResolution<MoodKey>;
  /** 解決できなかった軸。空なら context が確定している。 */
  unresolved: readonly AxisName[];
}

const defaultResolvers = {
  jsic: new StaticJsicResolver(),
  color: new StaticColorResolver(),
  mood: new StaticMoodResolver(),
} as const;

/**
 * 要望から各軸を決定する。カラー/ムード未指定は defaults を適用。
 * 全軸が解決したときのみ {@link AxisDecision.context} を確定する。
 */
export function decideAxes(brief: DesignBrief, opts: DecideOptions = {}): AxisDecision {
  const jsicResolver = opts.resolvers?.jsic ?? defaultResolvers.jsic;
  const colorResolver = opts.resolvers?.color ?? defaultResolvers.color;
  const moodResolver = opts.resolvers?.mood ?? defaultResolvers.mood;

  const jsic = jsicResolver.resolve(brief.industry);
  // カラー/ムードは未指定なら空文字で解決 → best 無し → 既定へフォールバック。
  const color = colorResolver.resolve(brief.color ?? "");
  const mood = moodResolver.resolve(brief.mood ?? "");

  const jsicCode = jsic.best?.entry.code;
  const colorSlug = color.best?.entry.slug ?? opts.defaults?.color;
  const moodSlug = mood.best?.entry.slug ?? opts.defaults?.mood;

  const unresolved: AxisName[] = [];
  if (jsicCode === undefined) unresolved.push("jsic");
  if (colorSlug === undefined) unresolved.push("color");
  if (moodSlug === undefined) unresolved.push("mood");

  const context: AxisContext | undefined =
    jsicCode !== undefined && colorSlug !== undefined && moodSlug !== undefined
      ? {
          jsic: jsicCode,
          color: colorSlug,
          mood: moodSlug,
          ...(brief.tags && brief.tags.length > 0 ? { tags: brief.tags } : {}),
        }
      : undefined;

  return { context, jsic, color, mood, unresolved };
}

/** 要望 → 軸 → 候補セル選定の結果。 */
export interface CellSelection {
  decision: AxisDecision;
  /** 確定 context (未解決軸があれば undefined)。 */
  context?: AxisContext;
  /** context に一致する index の候補セル (未確定なら空)。 */
  candidates: readonly DesignIndexEntry[];
}

/**
 * 要望から軸を決定し、{@link DesignIndexClient} で候補セルまで通す。
 * context 未確定 (未解決軸あり) の場合は候補を引かず空配列を返す。
 */
export function selectCells(
  brief: DesignBrief,
  index: DesignIndexClient,
  opts: DecideOptions = {},
): CellSelection {
  const decision = decideAxes(brief, opts);
  const candidates = decision.context ? index.byAxis(decision.context) : [];
  return { decision, context: decision.context, candidates };
}

import type { DesignIndexEntry } from "../../src/ds/types.js";
/**
 * GoDD Matrix 静的 Web アプリのエントリ (issue #28)。
 *
 * 完全クライアントサイド。副作用 (index / DESIGN.md fetch, hash 検証, クリップボード, DOM)
 * のみを担い、ドメインロジックは {@link ./lib} (純関数) に委譲する。秘密は一切扱わない。
 */
import { parseDesignIndex } from "../../src/ds/validate.js";
import {
  DS_INDEX_URL,
  type SearchInput,
  colorLabel,
  composePromptForCell,
  designRawUrl,
  jsicName,
  moodLabel,
  searchCells,
} from "./lib.js";

/** DOM を安全に組むための小さなヘルパ (textContent 経由; innerHTML は使わない)。 */
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
  if (!node) throw new Error(`要素が見つかりません: #${id}`);
  return node as T;
}

/** 現在の全エントリ (index.json 取込後に確定)。 */
let allEntries: readonly DesignIndexEntry[] = [];
/** 直近の検索要望 (プロンプト合成の notices に反映)。 */
let lastRequest: SearchInput = {};

/** SHA-256 (hex)。crypto.subtle は secure context (https/localhost) で有効。 */
async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** 旧 API (execCommand) によるコピーのフォールバック。 */
function legacyCopy(text: string): boolean {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.top = "-1000px";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  document.body.removeChild(ta);
  return ok;
}

/** クリップボードへコピーし、ボタンに一時的なフィードバックを出す。 */
async function copyToClipboard(text: string, button: HTMLButtonElement): Promise<void> {
  const original = button.textContent ?? "";
  let ok = false;
  try {
    await navigator.clipboard.writeText(text);
    ok = true;
  } catch {
    // Clipboard API が拒否/未対応の環境では旧 API にフォールバックする。
    ok = legacyCopy(text);
  }
  button.textContent = ok ? "コピーしました" : "コピー失敗";
  window.setTimeout(() => {
    button.textContent = original;
  }, 1400);
}

function copyButton(label: string, getText: () => string): HTMLButtonElement {
  const btn = el("button", { class: "copy-btn", text: label });
  btn.type = "button";
  btn.addEventListener("click", () => {
    void copyToClipboard(getText(), btn);
  });
  return btn;
}

function badge(text: string, kind: string): HTMLSpanElement {
  return el("span", { class: `badge badge-${kind}`, text });
}

/** フォームから検索要望を読む。 */
function readSearchInput(): SearchInput {
  const val = (id: string): string => byId<HTMLInputElement>(id).value.trim();
  const tagsRaw = val("q-tags");
  const tags = tagsRaw
    ? tagsRaw
        .split(/[,、\s]+/)
        .map((t) => t.trim())
        .filter((t) => t.length > 0)
    : [];
  return {
    industry: val("q-industry"),
    color: val("q-color"),
    mood: val("q-mood"),
    tags,
    text: val("q-text"),
  };
}

/** 解決した軸の要約を描画する。 */
function renderAxes(result: ReturnType<typeof searchCells>, input: SearchInput): void {
  const box = byId("axes");
  box.replaceChildren();
  const d = result.decision;
  const rows: Node[] = [];
  const line = (axis: string, resolved: string | undefined, raw: string | undefined): Node => {
    const label = el("span", { class: "axis-label", text: axis });
    const value = el("span", {
      class: resolved ? "axis-val resolved" : "axis-val unresolved",
      text: resolved ?? (raw ? `未解決 (入力: ${raw})` : "未指定"),
    });
    return el("div", { class: "axis-row" }, [label, value]);
  };
  const jsicBest = input.industry ? d.jsic.best : undefined;
  rows.push(
    line(
      "業種 (JSIC)",
      jsicBest ? `${jsicBest.entry.code} ${jsicBest.entry.name}` : undefined,
      input.industry,
    ),
  );
  const colorBest = input.color ? d.color.best : undefined;
  rows.push(
    line(
      "カラー",
      colorBest ? `${colorBest.entry.slug} (${colorBest.entry.label})` : undefined,
      input.color,
    ),
  );
  const moodBest = input.mood ? d.mood.best : undefined;
  rows.push(
    line(
      "ムード",
      moodBest ? `${moodBest.entry.slug} (${moodBest.entry.label})` : undefined,
      input.mood,
    ),
  );
  box.appendChild(el("h2", { class: "section-title", text: "解決した軸" }));
  box.appendChild(el("div", { class: "axes-grid" }, rows));
}

/** 1 セルのカードを描画する。 */
function renderCard(entry: DesignIndexEntry): HTMLElement {
  const meta = el("div", { class: "card-meta" }, [
    badge(`業種 ${entry.jsic}`, "jsic"),
    badge(colorLabel(entry.color), "color"),
    badge(moodLabel(entry.mood), "mood"),
  ]);
  const tags = el(
    "div",
    { class: "card-tags" },
    (entry.tags ?? []).map((t) => el("span", { class: "tag", text: t })),
  );
  const title = el("h3", { class: "card-title", text: entry.title });
  const industry = el("p", { class: "card-industry", text: `業種名: ${jsicName(entry.jsic)}` });
  const select = el("button", { class: "select-btn", text: "このセルでプロンプト合成 →" });
  select.type = "button";
  select.addEventListener("click", () => {
    void openDetail(entry);
  });
  return el("article", { class: "card" }, [title, industry, meta, tags, select]);
}

/** 検索結果 (カード一覧) を描画する。 */
function renderResults(matches: readonly DesignIndexEntry[]): void {
  const list = byId("results");
  list.replaceChildren();
  if (matches.length === 0) {
    list.appendChild(
      el("p", { class: "empty", text: "一致するセルがありません。条件を緩めてください。" }),
    );
    return;
  }
  for (const entry of matches) list.appendChild(renderCard(entry));
}

/** 検索を実行して結果と軸を更新する。 */
function runSearch(): void {
  const input = readSearchInput();
  lastRequest = input;
  const result = searchCells(allEntries, input);
  renderAxes(result, input);
  renderResults(result.matches);
  byId("status").textContent = `${result.matches.length} / ${allEntries.length} 件を表示`;
}

/** 選択セルの詳細 (DESIGN.md 取得 → プロンプト合成 → コピー) を描画する。 */
async function openDetail(entry: DesignIndexEntry): Promise<void> {
  const detail = byId("detail");
  detail.replaceChildren();
  detail.appendChild(el("h2", { class: "section-title", text: `選択: ${entry.title}` }));
  const info = el("p", { class: "detail-note", text: "DESIGN.md を取得中…" });
  detail.appendChild(info);
  detail.scrollIntoView({ behavior: "smooth", block: "start" });

  const url = designRawUrl(entry);
  let markdown: string;
  try {
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    markdown = await res.text();
  } catch (err) {
    info.className = "detail-note error";
    info.textContent = `DESIGN.md を取得できませんでした (${url}): ${
      err instanceof Error ? err.message : String(err)
    }。未材化セルの可能性があります (Generator レンダーが必要)。`;
    return;
  }

  let hashVerified = false;
  try {
    const expected = entry.hash.replace(/^sha256:/i, "").toLowerCase();
    hashVerified = (await sha256Hex(markdown)) === expected;
  } catch {
    hashVerified = false;
  }

  const prompt = composePromptForCell({ entry, markdown, hashVerified, request: lastRequest });

  info.className = "detail-note";
  info.replaceChildren(
    el("span", { text: `出所: ${prompt.provenance} / ` }),
    badge(hashVerified ? "hash 検証 OK" : "hash 未検証/不一致", hashVerified ? "ok" : "warn"),
  );

  if (prompt.notices.length > 0) {
    const ul = el(
      "ul",
      { class: "notices" },
      prompt.notices.map((n) => el("li", { text: n })),
    );
    detail.appendChild(el("h3", { class: "sub-title", text: "注意 (notices)" }));
    detail.appendChild(ul);
  }

  detail.appendChild(
    promptBlock("Claude system プロンプト", prompt.systemPrompt, "system プロンプトをコピー"),
  );
  detail.appendChild(
    promptBlock("Claude user プロンプト", prompt.userPrompt, "user プロンプトをコピー"),
  );
  detail.appendChild(promptBlock("DESIGN.md 本文", markdown, "DESIGN.md をコピー"));
}

/** 見出し + コピー + <pre> のブロック。 */
function promptBlock(heading: string, content: string, copyLabel: string): HTMLElement {
  const head = el("div", { class: "block-head" }, [
    el("h3", { class: "sub-title", text: heading }),
    copyButton(copyLabel, () => content),
  ]);
  const pre = el("pre", { class: "code" });
  pre.appendChild(el("code", { text: content }));
  return el("section", { class: "block" }, [head, pre]);
}

/** index.json を取込んで初期表示する。 */
async function bootstrap(): Promise<void> {
  const status = byId("status");
  status.textContent = "index.json を取得中…";
  try {
    const res = await fetch(DS_INDEX_URL, { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const index = parseDesignIndex(await res.text());
    allEntries = index.entries;
  } catch (err) {
    status.className = "error";
    status.textContent = `index.json を取得できませんでした: ${
      err instanceof Error ? err.message : String(err)
    }`;
    return;
  }
  runSearch();
}

function wireForm(): void {
  const form = byId<HTMLFormElement>("search-form");
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    runSearch();
  });
  byId<HTMLButtonElement>("reset").addEventListener("click", () => {
    form.reset();
    runSearch();
  });
}

wireForm();
void bootstrap();

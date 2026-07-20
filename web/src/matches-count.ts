import type { Locale } from "./lib.js";

/** Render the match count while preserving the stable label hook used by locale updates. */
export function renderMatchesCount(
  container: HTMLElement,
  document: Document,
  total: number,
  locale: Locale,
  label: string,
): void {
  const labelElement = document.createElement("span");
  labelElement.id = "label-matches-count";
  labelElement.className = "matches-count-label";
  labelElement.textContent = ` ${label}`;

  container.replaceChildren(
    document.createTextNode(total.toLocaleString(locale === "ja" ? "ja-JP" : "en-US")),
    labelElement,
  );
}

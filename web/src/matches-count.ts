import type { Locale } from "./lib.js";

export type MatchesCountView =
  | {
      readonly status: "loading";
      readonly label: string;
    }
  | {
      readonly status: "ready";
      readonly total: number;
      readonly locale: Locale;
      readonly label: string;
    };

/** Render the match count while preserving the stable label hook used by locale updates. */
export function renderMatchesCount(
  container: HTMLElement,
  document: Document,
  view: MatchesCountView,
): void {
  const labelElement = document.createElement("span");
  labelElement.id = "label-matches-count";
  labelElement.className = "matches-count-label";

  if (view.status === "loading") {
    labelElement.textContent = view.label;
    container.replaceChildren(labelElement);
    container.setAttribute("aria-busy", "true");
    return;
  }

  labelElement.textContent = ` ${view.label}`;
  container.replaceChildren(
    document.createTextNode(view.total.toLocaleString(view.locale === "ja" ? "ja-JP" : "en-US")),
    labelElement,
  );
  container.removeAttribute("aria-busy");
}

import { describe, expect, it } from "vitest";
import { renderMatchesCount } from "./matches-count.js";

interface FakeElement {
  id: string;
  className: string;
  textContent: string;
}

function harness() {
  const children: Array<string | FakeElement> = [];
  const document = {
    createElement: () => ({ id: "", className: "", textContent: "" }),
    createTextNode: (text: string) => text,
  };
  const container = {
    replaceChildren: (...next: Array<string | FakeElement>) => {
      children.splice(0, children.length, ...next);
    },
  };
  const label = () => children.find((child): child is FakeElement => typeof child !== "string");
  return { children, container, document, label };
}

describe("renderMatchesCount", () => {
  it("keeps the locale label hook after a filtered-search count rerender", () => {
    const view = harness();
    renderMatchesCount(
      view.container as unknown as HTMLElement,
      view.document as unknown as Document,
      1234,
      "ja",
      "件が一致",
    );

    expect(() =>
      renderMatchesCount(
        view.container as unknown as HTMLElement,
        view.document as unknown as Document,
        12,
        "en",
        "files match",
      ),
    ).not.toThrow();
    expect(view.label()).toMatchObject({
      id: "label-matches-count",
      className: "matches-count-label",
      textContent: " files match",
    });
  });

  it("keeps the hidden search label addressable while detail locale changes rerender state", () => {
    const view = harness();
    renderMatchesCount(
      view.container as unknown as HTMLElement,
      view.document as unknown as Document,
      24,
      "ja",
      "件が一致",
    );

    const label = view.label();
    expect(label?.id).toBe("label-matches-count");
    expect(() => {
      if (!label) throw new Error("label missing");
      label.textContent = " files match";
    }).not.toThrow();
  });
});

import { describe, expect, it } from "vitest";
import { renderMatchesCount } from "./matches-count.js";

interface FakeElement {
  id: string;
  className: string;
  textContent: string;
}

function harness() {
  const children: Array<string | FakeElement> = [];
  const attrs = new Map<string, string>();
  const document = {
    createElement: () => ({ id: "", className: "", textContent: "" }),
    createTextNode: (text: string) => text,
  };
  const container = {
    replaceChildren: (...next: Array<string | FakeElement>) => {
      children.splice(0, children.length, ...next);
    },
    setAttribute: (name: string, value: string) => {
      attrs.set(name, value);
    },
    removeAttribute: (name: string) => {
      attrs.delete(name);
    },
  };
  const label = () => children.find((child): child is FakeElement => typeof child !== "string");
  return { children, container, document, label, attrs };
}

describe("renderMatchesCount", () => {
  it("keeps the locale label hook after a filtered-search count rerender", () => {
    const view = harness();
    renderMatchesCount(
      view.container as unknown as HTMLElement,
      view.document as unknown as Document,
      {
        status: "ready",
        total: 1234,
        locale: "ja",
        label: "件が一致",
      },
    );

    expect(() =>
      renderMatchesCount(
        view.container as unknown as HTMLElement,
        view.document as unknown as Document,
        {
          status: "ready",
          total: 12,
          locale: "en",
          label: "files match",
        },
      ),
    ).not.toThrow();
    expect(view.label()).toMatchObject({
      id: "label-matches-count",
      className: "matches-count-label",
      textContent: " files match",
    });
    expect(view.attrs.has("aria-busy")).toBe(false);
  });

  it("keeps the hidden search label addressable while detail locale changes rerender state", () => {
    const view = harness();
    renderMatchesCount(
      view.container as unknown as HTMLElement,
      view.document as unknown as Document,
      {
        status: "ready",
        total: 24,
        locale: "ja",
        label: "件が一致",
      },
    );

    const label = view.label();
    expect(label?.id).toBe("label-matches-count");
    expect(() => {
      if (!label) throw new Error("label missing");
      label.textContent = " files match";
    }).not.toThrow();
  });

  it("shows loading copy instead of a zero match count while the catalog is pending", () => {
    const view = harness();
    renderMatchesCount(
      view.container as unknown as HTMLElement,
      view.document as unknown as Document,
      {
        status: "loading",
        label: "読み込み中…",
      },
    );

    expect(view.children).toHaveLength(1);
    expect(view.children.every((child) => typeof child !== "string" || child !== "0")).toBe(true);
    expect(view.label()).toMatchObject({
      id: "label-matches-count",
      className: "matches-count-label",
      textContent: "読み込み中…",
    });
    expect(view.attrs.get("aria-busy")).toBe("true");
  });

  it("switches from loading copy to the exact ready count without keeping a zero prefix", () => {
    const view = harness();
    renderMatchesCount(
      view.container as unknown as HTMLElement,
      view.document as unknown as Document,
      {
        status: "loading",
        label: "Loading…",
      },
    );
    renderMatchesCount(
      view.container as unknown as HTMLElement,
      view.document as unknown as Document,
      {
        status: "ready",
        total: 19_635_840_000,
        locale: "en",
        label: "files match",
      },
    );

    expect(view.children[0]).toBe((19_635_840_000).toLocaleString("en-US"));
    expect(view.label()?.textContent).toBe(" files match");
    expect(view.attrs.has("aria-busy")).toBe(false);
  });
});

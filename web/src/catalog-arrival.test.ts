import { describe, expect, it } from "vitest";
import {
  type ColorEditorHost,
  colorEditorReusable,
  createPendingDeepLink,
  writeColorEditorMarker,
} from "./catalog-arrival.js";

const HOME = "https://matrix.example/app/";
const CELL = "6061_white_minimal";

describe("pending deep link", () => {
  it("opens once while the URL has not moved", () => {
    const link = createPendingDeepLink(CELL, HOME);
    expect(link.claim(HOME)).toBe(CELL);
    expect(link.claim(HOME)).toBeNull();
  });

  it("ignores writes that leave the URL as it was, such as a language switch", () => {
    const link = createPendingDeepLink(CELL, HOME);
    link.noteUrlWrite(HOME, HOME);
    link.noteUrlWrite(HOME, HOME);
    expect(link.claim(HOME)).toBe(CELL);
  });

  it("is dropped once a search, filter or sort changes the URL", () => {
    const link = createPendingDeepLink(CELL, HOME);
    const searched = `${HOME}?q=dashboard`;
    link.noteUrlWrite(HOME, searched);
    expect(link.claim(searched)).toBeNull();
  });

  it("stays dropped after the user returns to the armed URL", () => {
    const link = createPendingDeepLink(CELL, HOME);
    const other = `${HOME}?cell=virtual_0100_h2v-vv_minimal_clp_sminimal_v0`;
    link.noteUrlWrite(HOME, other);
    link.noteUrlWrite(other, HOME);
    link.noteUrlWrite(HOME, HOME);
    expect(link.claim(HOME)).toBeNull();
  });

  it("stays dropped when a reported move is followed by an unreported return", () => {
    const link = createPendingDeepLink(CELL, HOME);
    link.noteUrlWrite(HOME, `${HOME}?q=dashboard`);
    expect(link.claim(HOME)).toBeNull();
  });

  it("is dropped when the URL moved without a reported write", () => {
    const link = createPendingDeepLink(CELL, HOME);
    expect(link.claim(`${HOME}#top`)).toBeNull();
  });

  it("is dropped when a write starts from a URL other than the armed one", () => {
    const link = createPendingDeepLink(CELL, HOME);
    link.noteUrlWrite(`${HOME}#top`, `${HOME}#top`);
    expect(link.claim(HOME)).toBeNull();
  });
});

function fakeEditor(): ColorEditorHost {
  const attributes = new Map<string, string>();
  return {
    getAttribute: (name) => attributes.get(name) ?? null,
    setAttribute: (name, value) => {
      attributes.set(name, value);
    },
    removeAttribute: (name) => {
      attributes.delete(name);
    },
  };
}

describe("color editor reuse", () => {
  const built = { cellId: CELL, locale: "ja", count: 2 };

  it("keeps an editor that was completely built for the same cell, locale and colors", () => {
    const editor = fakeEditor();
    writeColorEditorMarker(editor, built);
    expect(colorEditorReusable(editor, built, 2)).toBe(true);
  });

  it("rebuilds an editor that was never marked or whose marker was cleared", () => {
    const editor = fakeEditor();
    expect(colorEditorReusable(editor, built, 2)).toBe(false);
    writeColorEditorMarker(editor, built);
    writeColorEditorMarker(editor, null);
    expect(colorEditorReusable(editor, built, 2)).toBe(false);
  });

  it("rebuilds for another cell, another locale or another number of colors", () => {
    const editor = fakeEditor();
    writeColorEditorMarker(editor, built);
    const otherCell = { ...built, cellId: "7281_h17b-lt_trustworthy" };
    expect(colorEditorReusable(editor, otherCell, 2)).toBe(false);
    const otherLocale = { ...built, locale: "en" };
    expect(colorEditorReusable(editor, otherLocale, 2)).toBe(false);
    const otherCount = { ...built, count: 3 };
    expect(colorEditorReusable(editor, otherCount, 3)).toBe(false);
  });

  it("rebuilds when fewer blocks are on screen than the marker promises", () => {
    const editor = fakeEditor();
    writeColorEditorMarker(editor, built);
    expect(colorEditorReusable(editor, built, 1)).toBe(false);
    expect(colorEditorReusable(editor, built, 0)).toBe(false);
  });

  it("does not confuse ids that only differ in where the separators fall", () => {
    const editor = fakeEditor();
    writeColorEditorMarker(editor, { cellId: "a:b", locale: "c", count: 2 });
    expect(colorEditorReusable(editor, { cellId: "a", locale: "b:c", count: 2 }, 2)).toBe(false);
  });
});

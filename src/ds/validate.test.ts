import { describe, expect, it } from "vitest";
import { DesignIndexError, parseDesignIndex, validateDesignIndex } from "./validate.js";

const validEntry = {
  id: "7412_h17b-lt_trustworthy",
  path: "design-md/7412/h17b-lt/trustworthy/DESIGN.md",
  jsic: "7412",
  color: "h17b-lt",
  mood: "trustworthy",
  tags: ["professional"],
  title: "経営コンサルタント業 × ライトブルー × 信頼",
  hash: "sha256:a52a165a297d54aa3a93149f7ba66f00b6a200b599da12ca9b8cfc8a8954bdbf",
  createdAt: "2026-07-11T00:00:00Z",
};

const validIndex = { version: 1, generatedAt: "2026-07-11T00:00:00Z", entries: [validEntry] };

describe("validateDesignIndex", () => {
  it("正しい index を検証して返す", () => {
    const index = validateDesignIndex(validIndex);
    expect(index.version).toBe(1);
    expect(index.entries).toHaveLength(1);
    expect(index.entries[0]?.id).toBe("7412_h17b-lt_trustworthy");
    expect(index.generatedAt).toBe("2026-07-11T00:00:00Z");
  });

  it("tags 省略を許容する", () => {
    const { tags: _tags, ...noTags } = validEntry;
    const index = validateDesignIndex({ version: 1, entries: [noTags] });
    expect(index.entries[0]?.tags).toBeUndefined();
  });

  it("generatedAt 省略を許容する", () => {
    const index = validateDesignIndex({ version: 1, entries: [] });
    expect(index.generatedAt).toBeUndefined();
  });

  it.each([
    ["非オブジェクト", 42],
    ["version 欠落", { entries: [] }],
    ["version が 0", { version: 0, entries: [] }],
    ["entries が配列でない", { version: 1, entries: {} }],
  ])("不正な envelope (%s) で投げる", (_label, input) => {
    expect(() => validateDesignIndex(input)).toThrow(DesignIndexError);
  });

  it.each([
    ["id 形式不正", { ...validEntry, id: "bad id" }],
    ["path 形式不正", { ...validEntry, path: "wrong/path.md" }],
    ["jsic が4桁でない", { ...validEntry, jsic: "12" }],
    ["color が slug でない", { ...validEntry, color: "Bad_Color" }],
    ["hash 形式不正", { ...validEntry, hash: "md5:abc" }],
    ["title 欠落", { ...validEntry, title: undefined }],
    ["tags に非 slug", { ...validEntry, tags: ["OK", "Bad Tag"] }],
  ])("不正な entry (%s) で投げる", (_label, entry) => {
    expect(() => validateDesignIndex({ version: 1, entries: [entry] })).toThrow(DesignIndexError);
  });

  it("重複 id で投げる", () => {
    expect(() => validateDesignIndex({ version: 1, entries: [validEntry, validEntry] })).toThrow(
      /重複した entry id/,
    );
  });
});

describe("parseDesignIndex", () => {
  it("JSON 文字列をパースして検証する", () => {
    const index = parseDesignIndex(JSON.stringify(validIndex));
    expect(index.entries).toHaveLength(1);
  });

  it("不正な JSON で DesignIndexError を投げる", () => {
    expect(() => parseDesignIndex("{ not json")).toThrow(DesignIndexError);
  });
});

import { describe, expect, it } from "vitest";
import { VERSION } from "./version.js";

describe("VERSION", () => {
  it("semver 形式である", () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

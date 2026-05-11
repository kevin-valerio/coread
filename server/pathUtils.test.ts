import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { expandUserPath } from "./pathUtils";

describe("expandUserPath", () => {
  it("expands a bare tilde", () => {
    expect(expandUserPath("~")).toBe(os.homedir());
  });

  it("expands a tilde prefix", () => {
    expect(expandUserPath("~/Desktop")).toBe(path.join(os.homedir(), "Desktop"));
  });
});


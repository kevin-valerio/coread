import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { expandUserPath, resolveFileInsideDirectory } from "./pathUtils";

describe("expandUserPath", () => {
  it("expands a bare tilde", () => {
    expect(expandUserPath("~")).toBe(os.homedir());
  });

  it("expands a tilde prefix", () => {
    expect(expandUserPath("~/Desktop")).toBe(path.join(os.homedir(), "Desktop"));
  });
});

describe("resolveFileInsideDirectory", () => {
  it("resolves a relative file inside the root", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "reviewer-root-"));
    const file = path.join(root, "src", "app.ts");
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, "export const ok = true;\n");

    await expect(resolveFileInsideDirectory(root, "src/app.ts")).resolves.toBe(await fs.realpath(file));
  });

  it("allows a file with a dot-dot prefix inside the root", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "reviewer-root-"));
    const file = path.join(root, "..inside.ts");
    await fs.writeFile(file, "export const ok = true;\n");

    await expect(resolveFileInsideDirectory(root, "..inside.ts")).resolves.toBe(await fs.realpath(file));
  });

  it("rejects a relative path outside the root", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "reviewer-root-"));
    const outside = path.join(os.tmpdir(), `outside-${randomUUID()}.ts`);
    await fs.writeFile(outside, "export const bad = true;\n");

    await expect(resolveFileInsideDirectory(root, path.relative(root, outside))).rejects.toThrow(
      "File is outside the selected codebase"
    );
  });
});

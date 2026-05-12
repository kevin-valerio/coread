import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  findCodebaseFiles,
  getCodebaseOverview,
  listCodebaseDirectory,
  readCodebaseFileExcerpt,
  runRipgrepCodebase,
  searchCodebase
} from "./codebaseContext";

const hasRipgrep = spawnSync("rg", ["--version"], { encoding: "utf8" }).status === 0;

async function makeFixture(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "coread-context-"));
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.mkdir(path.join(root, "src", "auth"), { recursive: true });
  await fs.mkdir(path.join(root, "node_modules", "ignored"), { recursive: true });
  await fs.writeFile(path.join(root, "README.md"), "Coread fixture\n\nFast voice answers.\n");
  await fs.writeFile(
    path.join(root, "src", "app.ts"),
    ["export function answerQuestion() {", "  return 'fast local tool result';", "}", ""].join("\n")
  );
  await fs.writeFile(
    path.join(root, "src", "auth", "session.ts"),
    ["export function requireUser() {", "  return 'session ready';", "}", ""].join("\n")
  );
  await fs.writeFile(path.join(root, "node_modules", "ignored", "index.ts"), "fast local tool result\n");

  return root;
}

describe("codebase context tools", () => {
  it("returns a bounded overview with key files and ignores dependency folders", async () => {
    const root = await makeFixture();
    const overview = await getCodebaseOverview(root);

    expect(overview.files).toContain("README.md");
    expect(overview.files).toContain(path.join("src", "app.ts"));
    expect(overview.files).not.toContain(path.join("node_modules", "ignored", "index.ts"));
    expect(overview.keyFiles).toEqual([
      {
        path: "README.md",
        content: "Coread fixture\n\nFast voice answers.\n",
        truncated: false
      }
    ]);
  });

  it("finds files by relative path substring", async () => {
    const root = await makeFixture();
    const result = await findCodebaseFiles(root, "auth", 10);

    expect(result).toEqual({
      query: "auth",
      matches: [path.join("src", "auth", "session.ts")],
      truncated: false
    });
  });

  it("lists a bounded directory tree", async () => {
    const root = await makeFixture();
    const result = await listCodebaseDirectory(root, "src", 1, 10);

    expect(result.path).toBe("src");
    expect(result.truncated).toBe(false);
    expect(result.entries).toContainEqual({
      path: path.join("src", "auth"),
      name: "auth",
      type: "directory"
    });
    expect(result.entries).toContainEqual({
      path: path.join("src", "app.ts"),
      name: "app.ts",
      type: "file"
    });
  });

  it("searches text files with line references", async () => {
    const root = await makeFixture();
    const result = await searchCodebase(root, "fast local tool result", 10);

    expect(result.matches).toEqual([
      {
        path: path.join("src", "app.ts"),
        line: 2,
        column: 11,
        text: "return 'fast local tool result';"
      }
    ]);
  });

  it.runIf(hasRipgrep)("runs ripgrep inside the selected codebase", async () => {
    const root = await makeFixture();
    const result = await runRipgrepCodebase(root, "requireUser", {
      fixedStringsInput: true,
      maxResultsInput: 5
    });

    expect(result.matches).toEqual([
      {
        path: path.join("src", "auth", "session.ts"),
        line: 1,
        column: 17,
        text: "export function requireUser() {"
      }
    ]);
  });

  it("reads a numbered file excerpt", async () => {
    const root = await makeFixture();
    const excerpt = await readCodebaseFileExcerpt(root, path.join("src", "app.ts"), 2, 2);

    expect(excerpt).toMatchObject({
      path: path.join("src", "app.ts"),
      startLine: 2,
      endLine: 3,
      totalLines: 4,
      truncated: true
    });
    expect(excerpt.content).toBe("2:   return 'fast local tool result';\n3: }");
  });
});

const fs = require("fs");
const path = require("path");
const temp = require("temp").track();

const loadPathsHandler = require("../lib/load-paths-handler");

const UNICODE_NAME = "café-δ.txt";

function buildFixture() {
  const dir = temp.mkdirSync("fuzzy-files-crawl-");
  fs.writeFileSync(path.join(dir, "visible.txt"), "hello\n");
  fs.mkdirSync(path.join(dir, "sub"));
  fs.writeFileSync(path.join(dir, "sub", "nested.txt"), "nested\n");
  fs.writeFileSync(path.join(dir, ".gitignore"), "ignored.txt\n");
  fs.writeFileSync(path.join(dir, "ignored.txt"), "secret\n");
  fs.mkdirSync(path.join(dir, ".git"));
  fs.writeFileSync(path.join(dir, ".git", "config"), "[core]\n");
  fs.writeFileSync(path.join(dir, UNICODE_NAME), "unicode\n");
  return dir;
}

function relSet(dir, paths) {
  return new Set(paths.map((p) => path.relative(dir, p).split(path.sep).join("/")));
}

// The crawler is an Atom Task handler: it streams results through the global `emit` and
// signals completion via `this.async()`. Drive it directly so the test exercises the
// real `rg` invocation without the child-process indirection.
function run(
  rootPath,
  { followSymlinks = false, excludeVcsIgnoredPaths = true, ignores = [] } = {},
) {
  const collected = [];
  global.emit = (event, paths) => {
    if (event === "load-paths:paths-found") collected.push(...paths);
  };
  return new Promise((resolve) => {
    const fakeThis = { async: () => () => resolve(collected) };
    loadPathsHandler.call(fakeThis, [rootPath], followSymlinks, excludeVcsIgnoredPaths, ignores);
  });
}

describe("fuzzy-files load-paths handler", () => {
  let originalEmit;

  beforeEach(() => {
    originalEmit = global.emit;
  });

  afterEach(() => {
    global.emit = originalEmit;
  });

  it("lists tracked files and hides VCS-ignored and .git contents by default", async () => {
    const dir = buildFixture();
    const rels = relSet(dir, await run(dir, { excludeVcsIgnoredPaths: true }));

    expect(rels.has("visible.txt")).toBe(true);
    expect(rels.has("sub/nested.txt")).toBe(true);
    expect(rels.has(UNICODE_NAME)).toBe(true);
    expect(rels.has("ignored.txt")).toBe(false);
    expect([...rels].some((r) => r.startsWith(".git/"))).toBe(false);
  });

  it("reveals VCS-ignored files but still never descends into .git when the setting is off", async () => {
    const dir = buildFixture();
    const rels = relSet(dir, await run(dir, { excludeVcsIgnoredPaths: false }));

    expect(rels.has("ignored.txt")).toBe(true);
    expect([...rels].some((r) => r.startsWith(".git/"))).toBe(false);
  });

  it("returns multibyte filenames intact", async () => {
    const dir = buildFixture();
    const rels = relSet(dir, await run(dir, { excludeVcsIgnoredPaths: true }));

    expect(rels.has(UNICODE_NAME)).toBe(true);
    for (const rel of rels) {
      expect(rel).not.toContain("�");
    }
  });
});

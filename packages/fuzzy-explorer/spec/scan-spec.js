const fs = require("fs");
const path = require("path");
const temp = require("temp").track();

const scanHandler = require("../lib/scan");

const UNICODE_NAME = "café-δ.txt";

function buildFixture() {
  const dir = temp.mkdirSync("fuzzy-explorer-scan-");
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

// `scan` is an Atom Task handler: it emits `fuzzy-explorer:entries` and completes via
// `this.async()`. Drive it directly against the real `rg` binary.
function run(
  rootPath,
  { followSymlinks = false, excludeVcsIgnoredPaths = true, ignoredNames = [] } = {},
) {
  const collected = [];
  global.emit = (event, entries) => {
    if (event === "fuzzy-explorer:entries") collected.push(...entries);
  };
  return new Promise((resolve) => {
    const fakeThis = { async: () => () => resolve(collected) };
    const pattern = path.join(rootPath, "**");
    scanHandler.call(fakeThis, pattern, ignoredNames, followSymlinks, excludeVcsIgnoredPaths);
  });
}

describe("fuzzy-explorer scan handler", () => {
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

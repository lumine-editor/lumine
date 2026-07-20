const TreeView = require("../lib/tree-view");

describe("TreeView.entryForPath", () => {
  function makeEntry(entryPath, { realPath = entryPath, containedPaths = [] } = {}) {
    const entry = document.createElement("li");
    entry.classList.add("entry");
    entry.getPath = () => entryPath;
    entry.isPathEqual = (pathToCompare) =>
      pathToCompare === entryPath || pathToCompare === realPath;
    if (containedPaths.length > 0) {
      entry.directory = { contains: (p) => containedPaths.includes(p) };
    }
    return entry;
  }

  function entryForPath(entries, entryPath) {
    const list = document.createElement("ol");
    for (const entry of entries) list.appendChild(entry);
    return TreeView.prototype.entryForPath.call({ list }, entryPath);
  }

  it("prefers an exact path match over an earlier symlink whose realpath matches", () => {
    const symlink = makeEntry("/root/AGENTS.md", { realPath: "/root/CLAUDE.md" });
    const target = makeEntry("/root/CLAUDE.md");

    expect(entryForPath([symlink, target], "/root/CLAUDE.md")).toBe(target);
    expect(entryForPath([symlink, target], "/root/AGENTS.md")).toBe(symlink);
  });

  it("resolves a realpath alias when no exact entry exists", () => {
    const symlink = makeEntry("/root/AGENTS.md", { realPath: "/elsewhere/CLAUDE.md" });
    const other = makeEntry("/root/README.md");

    expect(entryForPath([symlink, other], "/elsewhere/CLAUDE.md")).toBe(symlink);
  });

  it("falls back to the deepest directory containing the path", () => {
    const shallow = makeEntry("/root", { containedPaths: ["/root/sub/missing.md"] });
    const deep = makeEntry("/root/sub", { containedPaths: ["/root/sub/missing.md"] });

    expect(entryForPath([shallow, deep], "/root/sub/missing.md")).toBe(deep);
    expect(entryForPath([shallow], "/nowhere/missing.md")).toBeNull();
  });
});

describe("TreeView root updates", () => {
  it("ignores updates after the project has been cleared during teardown", () => {
    const project = atom.project;
    const treeView = { selectedPaths: jasmine.createSpy("selectedPaths") };

    try {
      atom.project = null;
      expect(() => TreeView.prototype.updateRoots.call(treeView)).not.toThrow();
      expect(treeView.selectedPaths).not.toHaveBeenCalled();
    } finally {
      atom.project = project;
    }
  });
});

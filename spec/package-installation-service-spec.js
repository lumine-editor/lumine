const fs = require("fs");
const os = require("os");
const path = require("path");
const CSON = require("@lumine-code/season");
const PackageInstallationService = require("../src/package-installation-service");

const SHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

describe("PackageInstallationService", function () {
  let root;
  let npmCalls;
  let manifest;
  let service;

  beforeEach(function () {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "lumine-installer-spec-"));
    npmCalls = 0;
    manifest = {
      name: "sample-package",
      version: "1.0.0",
      repository: "https://github.com/owner/repo.git",
      engines: { atom: "*" },
    };
    service = new PackageInstallationService({
      packagesDirectory: root,
      gitCommand: "git",
      npmCommand: "npm",
      run: async (command, args, options) => {
        if (command === "git" && args[0] === "checkout") {
          fs.writeFileSync(path.join(options.cwd, "package.json"), `${JSON.stringify(manifest)}\n`);
          fs.mkdirSync(path.join(options.cwd, ".git"));
        }
        if (command === "npm") npmCalls++;
        return { stdout: "" };
      },
      capture: async () => ({ stdout: SHA }),
      resolveSource: async () => {
        throw new Error("moving refs must not be resolved for a hydrated card");
      },
      atomVersion: "1.132.1",
    });
  });

  afterEach(function () {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function pack(overrides = {}) {
    return {
      name: "sample-package",
      repository: "owner/repo",
      installSource: "owner/repo",
      resolvedSha: SHA,
      selectedRef: { type: "latest", value: "v1.0.0" },
      updatePolicy: "latest-tag",
      ...overrides,
    };
  }

  it("installs the exact hydrated SHA and writes an origin receipt", function () {
    waitsForPromise(() =>
      service.install(pack()).then((installed) => {
        const written = JSON.parse(fs.readFileSync(path.join(installed.target, "package.json")));
        expect(npmCalls).toBe(1);
        expect(installed.resolvedSha).toBe(SHA);
        expect(written.apmInstallSource).toEqual(
          jasmine.objectContaining({
            origin: "github.com/owner/repo",
            updatePolicy: "latest-tag",
            sha: SHA,
          }),
        );
        expect(fs.existsSync(path.join(installed.target, ".git"))).toBe(false);
      }),
    );
  });

  it("uses a temporary package.json to install a CSON manifest", function () {
    const originalRun = service.run;
    service.run = async (command, args, options) => {
      const result = await originalRun(command, args, options);
      if (command === "git" && args[0] === "checkout") {
        fs.rmSync(path.join(options.cwd, "package.json"));
        CSON.writeFileSync(path.join(options.cwd, "package.cson"), manifest);
      }
      if (command === "npm") {
        expect(fs.existsSync(path.join(options.cwd, "package.json"))).toBe(true);
      }
      return result;
    };

    waitsForPromise(() =>
      service.install(pack()).then((installed) => {
        expect(fs.existsSync(path.join(installed.target, "package.json"))).toBe(false);
        const written = CSON.readFileSync(path.join(installed.target, "package.cson"));
        expect(written.apmInstallSource.sha).toBe(SHA);
      }),
    );
  });

  it("rejects a mismatched manifest before npm runs", function () {
    manifest.repository = "different/repository";
    waitsForPromise(() =>
      service.install(pack()).then(
        () => Promise.reject(new Error("expected rejection")),
        (error) => {
          expect(error.message).toContain("does not match install origin");
          expect(npmCalls).toBe(0);
        },
      ),
    );
  });

  it("rejects a semantic tag whose manifest version differs", function () {
    manifest.version = "2.0.0";
    waitsForPromise(() =>
      service.install(pack()).then(
        () => Promise.reject(new Error("expected rejection")),
        (error) => {
          expect(error.message).toContain("does not match package version");
          expect(npmCalls).toBe(0);
        },
      ),
    );
  });

  it("blocks another community origin unless Replace is explicit", function () {
    const target = path.join(root, "sample-package");
    fs.mkdirSync(target);
    fs.writeFileSync(
      path.join(target, "package.json"),
      JSON.stringify({
        name: "sample-package",
        repository: "other/repo",
        engines: { atom: "*" },
      }),
    );
    waitsForPromise(() =>
      service.install(pack()).then(
        () => Promise.reject(new Error("expected rejection")),
        (error) => {
          expect(error.message).toContain("Use Replace");
          expect(npmCalls).toBe(0);
        },
      ),
    );
  });

  it("treats a linked package directory as an occupied install slot", function () {
    const linkedSource = fs.mkdtempSync(path.join(os.tmpdir(), "lumine-linked-slot-"));
    fs.writeFileSync(
      path.join(linkedSource, "package.json"),
      JSON.stringify({
        name: "sample-package",
        repository: "other/repo",
        engines: { atom: "*" },
      }),
    );
    fs.symlinkSync(
      linkedSource,
      path.join(root, "sample-package"),
      process.platform === "win32" ? "junction" : "dir",
    );

    waitsForPromise(() =>
      service
        .install(pack())
        .then(
          () => Promise.reject(new Error("expected rejection")),
          (error) => expect(error.message).toContain("Use Replace"),
        )
        .finally(() => fs.rmSync(linkedSource, { recursive: true, force: true })),
    );
  });

  it("requires uninstall when another ref of the same origin changes its package name", function () {
    const oldSlot = path.join(root, "old-package-name");
    fs.mkdirSync(oldSlot);
    fs.writeFileSync(
      path.join(oldSlot, "package.json"),
      JSON.stringify({
        name: "old-package-name",
        repository: "owner/repo",
        engines: { atom: "*" },
        apmInstallSource: { type: "git", origin: "github.com/owner/repo" },
      }),
    );

    waitsForPromise(() =>
      service.install(pack()).then(
        () => Promise.reject(new Error("expected rejection")),
        (error) => expect(error.message).toContain("already installed in slot"),
      ),
    );
  });

  it("does not reload an existing package when preparation fails before unloading", function () {
    const originalRun = service.run;
    service.run = async (command, args, options) => {
      if (command === "npm") throw new Error("npm failed");
      return originalRun(command, args, options);
    };
    spyOn(service, "beforeSwap").andCallThrough();
    spyOn(service, "afterRollback").andCallThrough();

    waitsForPromise(() =>
      service.install(pack()).then(
        () => Promise.reject(new Error("expected rejection")),
        (error) => {
          expect(error.message).toContain("npm failed");
          expect(service.beforeSwap).not.toHaveBeenCalled();
          expect(service.afterRollback).not.toHaveBeenCalled();
        },
      ),
    );
  });

  it("restores the old directory when the atomic swap fails", function () {
    const target = path.join(root, "sample-package");
    fs.mkdirSync(target);
    fs.writeFileSync(
      path.join(target, "package.json"),
      JSON.stringify({
        name: "sample-package",
        repository: "other/repo",
        engines: { atom: "*" },
      }),
    );
    fs.writeFileSync(path.join(target, "old-marker"), "old");
    const originalRename = fs.promises.rename;
    let renameCalls = 0;
    spyOn(fs.promises, "rename").andCallFake((from, to) => {
      renameCalls++;
      if (renameCalls === 2) return Promise.reject(new Error("swap failed"));
      return originalRename(from, to);
    });

    waitsForPromise(() =>
      service.install(pack(), { allowReplace: true }).then(
        () => Promise.reject(new Error("expected rejection")),
        (error) => {
          expect(error.message).toContain("swap failed");
          expect(fs.readFileSync(path.join(target, "old-marker"), "utf8")).toBe("old");
        },
      ),
    );
  });
});

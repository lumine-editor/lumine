const { spawnOptions } = require("../src/package-cli");

describe("package-cli spawnOptions", function () {
  it("spawns .cmd/.bat through a shell on Windows so npm.cmd does not throw EINVAL", function () {
    expect(spawnOptions("npm.cmd", { cwd: "/pkg" }, "win32")).toEqual({
      cwd: "/pkg",
      shell: true,
    });
    expect(spawnOptions("build.BAT", {}, "win32")).toEqual({ shell: true });
  });

  it("leaves plain executables (git) direct so their URL/ref args are not shell interpreted", function () {
    expect(spawnOptions("git", { cwd: "/pkg" }, "win32")).toEqual({ cwd: "/pkg" });
  });

  it("never uses a shell off Windows", function () {
    expect(spawnOptions("npm.cmd", { cwd: "/pkg" }, "linux")).toEqual({ cwd: "/pkg" });
    expect(spawnOptions("npm", {}, "darwin")).toEqual({});
  });
});

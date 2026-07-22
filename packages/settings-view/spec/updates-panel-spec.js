const UpdatesPanel = require("../lib/updates-panel");
const PackageManager = require("../lib/package-manager");
const SettingsView = require("../lib/settings-view");

describe("UpdatesPanel", () => {
  let panel = null;
  let packageManager = null;

  beforeEach(() => {
    packageManager = new PackageManager();
  });

  afterEach(() => {
    if (panel) panel.destroy();
  });

  it("lists the installed packages that have a newer version", function () {
    const getUpdates = spyOn(packageManager, "getGitPackageUpdates").andReturn(
      Promise.resolve([
        { name: "updatable", repository: "owner/updatable", latestSha: "a".repeat(40) },
      ]),
    );

    panel = new UpdatesPanel(new SettingsView(), packageManager);

    waitsForPromise(() => panel.loadPromise);
    runs(() => {
      // Updates come from the install receipts, not the catalog.
      expect(getUpdates).toHaveBeenCalled();
      expect(panel.packageCards.map((card) => card.pack.name)).toEqual(["updatable"]);
      expect(panel.refs.updateCount.textContent).toBe("1");
    });
  });

  it("reports when everything is up to date", function () {
    spyOn(packageManager, "getGitPackageUpdates").andReturn(Promise.resolve([]));

    panel = new UpdatesPanel(new SettingsView(), packageManager);

    waitsForPromise(() => panel.loadPromise);
    runs(() => {
      expect(panel.packageCards.length).toBe(0);
      expect(panel.refs.updateCount.textContent).toBe("0");
      expect(panel.refs.statusMessage.textContent).toContain("up to date");
    });
  });
});

const fs = require("fs");
const path = require("path");

const temp = require("@lumine-code/temp").track();

const SecretStore = require("../src/secret-store");

// A stand-in for Electron's safeStorage that "encrypts" by prefixing, so the
// spec never depends on the OS keyring (unavailable on headless CI) and never
// touches the user's real secret store.
function fakeSafeStorage(available = true) {
  return {
    available,
    isEncryptionAvailable() {
      return this.available;
    },
    encryptString(value) {
      return Buffer.from(`enc:${value}`, "utf8");
    },
    decryptString(buffer) {
      return buffer.toString("utf8").replace(/^enc:/, "");
    },
  };
}

describe("SecretStore", () => {
  let storagePath;

  beforeEach(() => {
    storagePath = path.join(temp.mkdirSync("secret-store"), "secret-store.json");
  });

  it("encrypts, persists, and reads back a secret", async () => {
    const safeStorage = fakeSafeStorage(true);
    const store = new SecretStore({ safeStorage, storagePath });

    await store.set("gh:token", "hunter2");
    expect(await store.get("gh:token")).toBe("hunter2");

    // On disk it is ciphertext, not the plaintext value.
    expect(fs.readFileSync(storagePath, "utf8")).not.toContain("hunter2");

    // A fresh store over the same file decrypts it.
    const reopened = new SecretStore({ safeStorage, storagePath });
    expect(await reopened.get("gh:token")).toBe("hunter2");
  });

  it("returns null for a missing key and after delete", async () => {
    const store = new SecretStore({ safeStorage: fakeSafeStorage(), storagePath });

    expect(await store.get("absent")).toBe(null);
    await store.set("k", "v");
    await store.delete("k");
    expect(await store.get("k")).toBe(null);
  });

  it("emits did-change on set and delete", async () => {
    const store = new SecretStore({ safeStorage: fakeSafeStorage(), storagePath });
    const changed = [];
    store.onDidChange(({ key }) => changed.push(key));

    await store.set("a", "1");
    await store.delete("a");
    expect(changed).toEqual(["a", "a"]);
  });

  it("keeps secrets in session-only memory and warns once when encryption is unavailable", async () => {
    const warnings = [];
    const store = new SecretStore({
      safeStorage: fakeSafeStorage(false),
      storagePath,
      notify: (message) => warnings.push(message),
    });

    await store.set("k", "v");
    expect(await store.get("k")).toBe("v"); // usable within the session
    expect(fs.existsSync(storagePath)).toBe(false); // never written to disk

    await store.get("other"); // a second operation must not warn again
    expect(warnings.length).toBe(1);
  });
});

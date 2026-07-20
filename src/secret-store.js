const fs = require("fs");
const path = require("path");
const { Emitter } = require("event-kit");

// A small, forge-agnostic secret store for tokens and other sensitive strings a
// package must persist across sessions. It follows VS Code's SecretStorage
// shape: opaque string keys, string values, async get/set/delete, and a change
// event; callers namespace their own keys.
//
// Values are encrypted at rest with Electron's safeStorage — OS-backed (DPAPI on
// Windows, Keychain on macOS, libsecret/kwallet on Linux) — and stored as base64
// in a single JSON file under the config directory. safeStorage is a main-process
// module, so the renderer reaches it through @electron/remote (resolved lazily so
// specs can inject a fake). When OS encryption is unavailable (e.g. a headless
// Linux box with no keyring) the store degrades to an in-memory, session-only
// map and warns once, rather than writing secrets to disk in the clear.
class SecretStore {
  constructor({ safeStorage, storagePath, notify } = {}) {
    this._safeStorage = safeStorage;
    this.storagePath = storagePath;
    this.notify = notify || null;
    this.emitter = new Emitter();
    this.entries = null; // Map<key, base64 ciphertext>, loaded on first use
    this.memory = new Map(); // session-only fallback when encryption is off
    this.encryptionAvailable = null;
    this.warned = false;
  }

  get safeStorage() {
    if (this._safeStorage == null) {
      this._safeStorage = require("@electron/remote").safeStorage;
    }
    return this._safeStorage;
  }

  isEncryptionAvailable() {
    if (this.encryptionAvailable === null) {
      try {
        this.encryptionAvailable = Boolean(this.safeStorage.isEncryptionAvailable());
      } catch {
        this.encryptionAvailable = false;
      }
      if (!this.encryptionAvailable) this.warnUnavailable();
    }
    return this.encryptionAvailable;
  }

  warnUnavailable() {
    if (this.warned) return;
    this.warned = true;
    const message =
      "Secret storage encryption is unavailable, so secrets such as access tokens are kept only for this session and are not saved to disk.";
    if (this.notify) {
      this.notify(message);
    } else {
      console.warn(message);
    }
  }

  loadEntries() {
    if (this.entries) return this.entries;
    this.entries = new Map();
    try {
      const parsed = JSON.parse(fs.readFileSync(this.storagePath, "utf8"));
      for (const key of Object.keys(parsed)) {
        if (typeof parsed[key] === "string") this.entries.set(key, parsed[key]);
      }
    } catch {
      // No store yet, or an unreadable/corrupt file: start empty.
    }
    return this.entries;
  }

  persistEntries() {
    const object = {};
    for (const [key, value] of this.loadEntries()) object[key] = value;
    fs.mkdirSync(path.dirname(this.storagePath), { recursive: true });
    fs.writeFileSync(this.storagePath, JSON.stringify(object), { mode: 0o600 });
  }

  // Resolve to the stored string for `key`, or null if absent or undecryptable.
  async get(key) {
    if (!this.isEncryptionAvailable()) {
      return this.memory.has(key) ? this.memory.get(key) : null;
    }
    const ciphertext = this.loadEntries().get(key);
    if (ciphertext == null) return null;
    try {
      return this.safeStorage.decryptString(Buffer.from(ciphertext, "base64"));
    } catch {
      return null;
    }
  }

  // Store `value` (a string) under `key`. A null/undefined value deletes it.
  async set(key, value) {
    if (value == null) return this.delete(key);
    if (!this.isEncryptionAvailable()) {
      this.memory.set(key, String(value));
      this.emitter.emit("did-change", { key });
      return;
    }
    const ciphertext = this.safeStorage.encryptString(String(value)).toString("base64");
    this.loadEntries().set(key, ciphertext);
    this.persistEntries();
    this.emitter.emit("did-change", { key });
  }

  async delete(key) {
    let changed = this.memory.delete(key);
    if (this.loadEntries().delete(key)) {
      this.persistEntries();
      changed = true;
    }
    if (changed) this.emitter.emit("did-change", { key });
  }

  onDidChange(callback) {
    return this.emitter.on("did-change", callback);
  }

  dispose() {
    this.emitter.dispose();
  }
}

module.exports = SecretStore;

"use strict";

// Native package-management commands for the Lumine CLI.
//
// These replace the external `ppm` binary. Everything runs headlessly in the
// main process (no editor window) using `git`, `npm`, and the filesystem, then
// exits. The behavior mirrors how the Settings view installs packages: a
// GitHub package is cloned, its production dependencies are installed, and it
// is copied into `~/.lumine/packages` with an `apmInstallSource` record so it
// can be updated later.

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const CSON = require("@lumine-code/season");
const { resolvePackageSource } = require("./package-source");
const PackageInstallationService = require("./package-installation-service");

function packagesDirectory() {
  return path.join(process.env.LUMINE_HOME, "packages");
}

function devPackagesDirectory() {
  return path.join(process.env.LUMINE_HOME, "dev", "packages");
}

function gitCommand() {
  return "git";
}

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function symlinkType() {
  return process.platform === "win32" ? "junction" : "dir";
}

// On Windows a .cmd/.bat (e.g. npm.cmd) must be spawned through a shell — Node
// >= 18.20 / 20.12 rejects them with EINVAL otherwise (CVE-2024-27980). git is
// an .exe, so it keeps its direct spawn and its URL/ref args are never shell
// interpreted.
function spawnOptions(command, options, platform = process.platform) {
  if (platform === "win32" && /\.(cmd|bat)$/i.test(command)) {
    return { ...options, shell: true };
  }
  return options;
}

// Runs a child process synchronously, streaming its output to the user. Throws
// on a non-zero exit code.
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", ...spawnOptions(command, options) });
  if (result.error) {
    if (result.error.code === "ENOENT") {
      throw new Error(`Could not find the \`${command}\` command on your PATH.`);
    }
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`\`${command} ${args.join(" ")}\` failed with exit code ${result.status}.`);
  }
  return result;
}

// Runs a child process synchronously and returns its captured stdout.
function capture(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...spawnOptions(command, options) });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`\`${command} ${args.join(" ")}\` failed with exit code ${result.status}.`);
  }
  return result.stdout;
}

function readMetadata(packagePath) {
  const metadataPath = CSON.resolve(path.join(packagePath, "package"));
  if (!metadataPath) {
    return null;
  }
  return { path: metadataPath, metadata: CSON.readFileSync(metadataPath) };
}

async function install(source) {
  if (!source) {
    throw new Error("Specify a package to install, e.g. `lumine --install owner/repo`.");
  }
  console.log(`Installing ${source}…`);
  const service = new PackageInstallationService({
    packagesDirectory: packagesDirectory(),
    gitCommand: gitCommand(),
    npmCommand: npmCommand(),
    run: async (command, args, options) => {
      run(command, args, options);
      return { stdout: "" };
    },
    capture: async (command, args, options) => ({
      stdout: capture(command, args, options),
    }),
    resolveSource: (value) =>
      resolvePackageSource(value, async (cloneUrl, options, patterns) =>
        capture(gitCommand(), ["ls-remote", ...options, cloneUrl, ...patterns]),
      ),
    atomVersion: require("../package.json").version.split("-")[0],
  });
  const installed = await service.install({ installSource: source, name: source });
  console.log(`Installed ${installed.packageName} to ${installed.target}`);
}

function uninstall(name) {
  if (!name) {
    throw new Error("Specify a package to uninstall, e.g. `lumine --uninstall my-package`.");
  }

  const targetDir = path.join(packagesDirectory(), name);
  if (!fs.existsSync(targetDir)) {
    throw new Error(`'${name}' is not installed in ${packagesDirectory()}.`);
  }

  fs.rmSync(targetDir, { recursive: true, force: true });
  console.log(`Uninstalled ${name}`);
}

function readVersion(packagePath) {
  const read = readMetadata(packagePath);
  return read && read.metadata && read.metadata.version ? read.metadata.version : null;
}

function listDirectory(directory) {
  if (!fs.existsSync(directory)) {
    return [];
  }
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .filter(
      (entry) => !entry.name.startsWith(".") && (entry.isDirectory() || entry.isSymbolicLink()),
    )
    .map((entry) => {
      const version = readVersion(path.join(directory, entry.name));
      return version ? `${entry.name}@${version}` : entry.name;
    })
    .sort();
}

function list() {
  const sections = [
    { title: "Community Packages", directory: packagesDirectory() },
    { title: "Development Packages", directory: devPackagesDirectory() },
  ];

  let printedAny = false;
  for (const { title, directory } of sections) {
    const names = listDirectory(directory);
    if (names.length === 0) {
      continue;
    }
    printedAny = true;
    console.log(`${title} (${names.length})`);
    for (const name of names) {
      console.log(`└── ${name}`);
    }
    console.log("");
  }

  if (!printedAny) {
    console.log("No packages installed.");
  }
}

function link(target, { dev } = {}) {
  if (!target) {
    throw new Error("Specify a package directory to link, e.g. `lumine --link .`.");
  }

  const packagePath = path.resolve(target);
  if (!fs.existsSync(packagePath)) {
    throw new Error(`No such directory: ${packagePath}`);
  }

  const read = readMetadata(packagePath);
  const name = (read && read.metadata && read.metadata.name) || path.basename(packagePath);
  const linkDirectory = dev ? devPackagesDirectory() : packagesDirectory();
  const linkPath = path.join(linkDirectory, name);

  fs.mkdirSync(linkDirectory, { recursive: true });
  fs.rmSync(linkPath, { recursive: true, force: true });
  fs.symlinkSync(packagePath, linkPath, symlinkType());

  console.log(`Linked ${packagePath} -> ${linkPath}`);
}

function unlink(target, { dev } = {}) {
  if (!target) {
    throw new Error("Specify a package name or directory to unlink, e.g. `lumine --unlink .`.");
  }

  // Accept either a package name or a path to the linked directory.
  const name = fs.existsSync(target) ? path.basename(path.resolve(target)) : target;
  const directories = dev
    ? [devPackagesDirectory()]
    : [packagesDirectory(), devPackagesDirectory()];

  let unlinked = false;
  for (const directory of directories) {
    const linkPath = path.join(directory, name);
    if (fs.existsSync(linkPath) && fs.lstatSync(linkPath).isSymbolicLink()) {
      fs.rmSync(linkPath, { recursive: true, force: true });
      console.log(`Unlinked ${linkPath}`);
      unlinked = true;
    }
  }

  if (!unlinked) {
    throw new Error(`No linked package named '${name}' was found.`);
  }
}

const COMMANDS = { install, uninstall, list, link, unlink };

// Runs a parsed package command. `command` is `{ name, arg, dev }`. Returns a
// process exit code.
async function runPackageCommand(command) {
  const handler = COMMANDS[command.name];
  if (!handler) {
    process.stderr.write(`Unknown package command: ${command.name}\n`);
    return 1;
  }

  try {
    await handler(command.arg, { dev: command.dev });
    return 0;
  } catch (error) {
    process.stderr.write(`${error.message || error}\n`);
    return 1;
  }
}

module.exports = { runPackageCommand, spawnOptions };

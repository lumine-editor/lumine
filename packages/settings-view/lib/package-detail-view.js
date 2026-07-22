/** @babel */
/** @jsx etch.dom */

import path from "path";

import _ from "@lumine-code/underscore-plus";
import fs from "@lumine-code/fs-plus";
import { CompositeDisposable, Disposable } from "atom";
import etch from "@lumine-code/etch";

import PackageCard from "./package-card";
import PackageGrammarsView from "./package-grammars-view";
import PackageKeymapView from "./package-keymap-view";
import PackageReadmeView from "./package-readme-view";
import PackageSnippetsView from "./package-snippets-view";
import SettingsPanel from "./settings-panel";
import { packageOrigin } from "./utils";

const NORMALIZE_PACKAGE_DATA_README_ERROR = "ERROR: No README data found!";

export default class PackageDetailView {
  constructor(pack, settingsView, packageManager, snippetsProvider) {
    this.pack = pack;
    if (Array.isArray(pack.badges)) {
      // Badges are only available on the object when loading their data from the
      // API server. Once local the badge data is lost.
      // Plus we want to modify the original item to ensure further changes can take effect properly
      pack.metadata.badges = pack.badges;
    }
    this.settingsView = settingsView;
    this.packageManager = packageManager;
    this.snippetsProvider = snippetsProvider;
    this.disposables = new CompositeDisposable();
    this.collapsedPackageSections = new Set();
    etch.initialize(this);
    this.setupCollapsibleSections();
    this.loadPackage();

    this.disposables.add(
      atom.commands.add(this.element, {
        "core:move-up": () => {
          this.scrollUp();
        },
        "core:move-down": () => {
          this.scrollDown();
        },
        "core:page-up": () => {
          this.pageUp();
        },
        "core:page-down": () => {
          this.pageDown();
        },
        "core:move-to-top": () => {
          this.scrollToTop();
        },
        "core:move-to-bottom": () => {
          this.scrollToBottom();
        },
      }),
    );

    const packageRepoClickHandler = (event) => {
      event.preventDefault();
      const repoUrl = this.packageManager.getRepositoryUrl(this.pack);
      if (typeof repoUrl === "string") {
        if (URL.parse(repoUrl)?.pathname === "/lumine-code/lumine") {
          atom.openExternal(`${repoUrl}/tree/master/packages/${this.pack.name}`);
        } else {
          atom.openExternal(repoUrl);
        }
      }
    };
    this.refs.packageRepo.addEventListener("click", packageRepoClickHandler);
    this.disposables.add(
      new Disposable(() => {
        this.refs.packageRepo.removeEventListener("click", packageRepoClickHandler);
      }),
    );

    const issueButtonClickHandler = (event) => {
      event.preventDefault();
      let bugUri = this.packageManager.getRepositoryBugUri(this.pack);
      if (bugUri) {
        atom.openExternal(bugUri);
      }
    };
    this.refs.issueButton.addEventListener("click", issueButtonClickHandler);
    this.disposables.add(
      new Disposable(() => {
        this.refs.issueButton.removeEventListener("click", issueButtonClickHandler);
      }),
    );

    const changelogButtonClickHandler = (event) => {
      event.preventDefault();
      if (this.changelogPath) {
        this.openMarkdownFile(this.changelogPath);
      }
    };
    this.refs.changelogButton.addEventListener("click", changelogButtonClickHandler);
    this.disposables.add(
      new Disposable(() => {
        this.refs.changelogButton.removeEventListener("click", changelogButtonClickHandler);
      }),
    );

    const licenseButtonClickHandler = (event) => {
      event.preventDefault();
      if (this.licensePath) {
        this.openMarkdownFile(this.licensePath);
      }
    };
    this.refs.licenseButton.addEventListener("click", licenseButtonClickHandler);
    this.disposables.add(
      new Disposable(() => {
        this.refs.licenseButton.removeEventListener("click", licenseButtonClickHandler);
      }),
    );

    const openButtonClickHandler = (event) => {
      event.preventDefault();
      if (fs.existsSync(this.pack.path)) {
        atom.open({ pathsToOpen: [this.pack.path] });
      }
    };
    this.refs.openButton.addEventListener("click", openButtonClickHandler);
    this.disposables.add(
      new Disposable(() => {
        this.refs.openButton.removeEventListener("click", openButtonClickHandler);
      }),
    );

    const learnMoreButtonClickHandler = (event) => {
      event.preventDefault();
      const repoUrl = this.packageManager.getRepositoryUrl(this.pack);
      if (repoUrl) {
        atom.openExternal(repoUrl);
      }
    };
    this.refs.learnMoreButton.addEventListener("click", learnMoreButtonClickHandler);
    this.disposables.add(
      new Disposable(() => {
        this.refs.learnMoreButton.removeEventListener("click", learnMoreButtonClickHandler);
      }),
    );

    const breadcrumbClickHandler = (event) => {
      event.preventDefault();
      this.settingsView.showPanel(this.breadcrumbBackPanel);
    };
    this.refs.breadcrumb.addEventListener("click", breadcrumbClickHandler);
    this.disposables.add(
      new Disposable(() => {
        this.refs.breadcrumb.removeEventListener("click", breadcrumbClickHandler);
      }),
    );
  }

  completeInitialization() {
    this.hideLoadingMessage();
    if (this.refs.packageCard) {
      this.packageCard = this.refs.packageCard.packageCard;
    } else if (!this.packageCard) {
      // Had to load this from the network
      this.packageCard = new PackageCard(
        this.pack.metadata,
        this.settingsView,
        this.packageManager,
        {
          onSettingsView: true,
          onPackUpdated: (updatedPack) => this.applySelectedRef(updatedPack),
        },
      );
      this.refs.packageCardParent.replaceChild(this.packageCard.element, this.refs.loadingMessage);
    }

    this.refs.packageRepo.classList.remove("hidden");
    this.refs.startupTime.classList.remove("hidden");
    this.refs.buttons.classList.remove("hidden");
    this.activateConfig();
    this.populate();
    this.updateFileButtons();
    this.subscribeToPackageManager();
    this.renderReadme();
  }

  loadPackage() {
    const loadedPackage = this.getMatchingLoadedPackage();
    if (loadedPackage) {
      this.pack = loadedPackage;
      this.completeInitialization();
    } else if (this.pack.metadata) {
      // A same-named loaded package may be a bundled package or another
      // community origin. Keep the exact card metadata instead of crossing
      // package identities, and never query the legacy registry by name.
      this.completeInitialization();
    } else {
      this.showErrorMessage();
    }
  }

  getMatchingLoadedPackage() {
    const loadedPackage = atom.packages.getLoadedPackage(this.pack.name);
    if (!loadedPackage) return null;

    const requested = this.pack.metadata || this.pack;
    const requestedOrigin = packageOrigin(requested);
    const loadedOrigin = packageOrigin(loadedPackage.metadata);
    if (requestedOrigin) return requestedOrigin === loadedOrigin ? loadedPackage : null;

    const requestsBuiltin =
      this.pack.packageKind === "builtin" ||
      this.pack.isBuiltinDescriptor ||
      requested.packageKind === "builtin" ||
      requested.isBuiltinDescriptor;
    if (requestsBuiltin && loadedOrigin) return null;
    return loadedPackage;
  }

  hideLoadingMessage() {
    if (this.refs.loadingMessage) this.refs.loadingMessage.classList.add("hidden");
  }

  showErrorMessage() {
    this.hideLoadingMessage();
    this.refs.errorMessage.classList.remove("hidden");
  }

  hideErrorMessage() {
    this.refs.errorMessage.classList.add("hidden");
  }

  activateConfig() {
    // Package.activateConfig() is part of the Private package API and should not be used outside of core.
    if (this.getMatchingLoadedPackage() && !atom.packages.isPackageActive(this.pack.name)) {
      this.pack.activateConfig();
    }
  }

  destroy() {
    if (this.settingsPanel) {
      this.settingsPanel.destroy();
      this.settingsPanel = null;
    }

    if (this.keymapView) {
      this.keymapView.destroy();
      this.keymapView = null;
    }

    if (this.grammarsView) {
      this.grammarsView.destroy();
      this.grammarsView = null;
    }

    if (this.snippetsView) {
      this.snippetsView.destroy();
      this.snippetsView = null;
    }

    if (this.readmeView) {
      this.readmeView.destroy();
      this.readmeView = null;
    }

    if (this.packageCard) {
      this.packageCard.destroy();
      this.packageCard = null;
    }

    this.disposables.dispose();
    return etch.destroy(this);
  }

  setupCollapsibleSections() {
    const toggleHandler = (event) => {
      const toggle = event.target.closest(".package-section-toggle");
      if (!toggle || !this.refs.sections.contains(toggle)) return;

      const section = toggle.closest(".package-collapsible-section");
      const key = section.dataset.packageSectionKey;
      const collapsed = section.classList.toggle("is-collapsed");
      toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
      if (collapsed) {
        this.collapsedPackageSections.add(key);
      } else {
        this.collapsedPackageSections.delete(key);
      }
    };
    this.refs.sections.addEventListener("click", toggleHandler);
    this.disposables.add(
      new Disposable(() => this.refs.sections.removeEventListener("click", toggleHandler)),
    );

    this.sectionsObserver = new MutationObserver(() => this.enhancePackageSections());
    this.sectionsObserver.observe(this.refs.sections, { childList: true, subtree: true });
    this.disposables.add(new Disposable(() => this.sectionsObserver.disconnect()));
  }

  enhancePackageSections() {
    for (const section of this.refs.sections.querySelectorAll("section.section")) {
      if (section.classList.contains("package-collapsible-section")) continue;

      const heading =
        section.querySelector(":scope > .section-heading") ||
        section.querySelector(":scope > .section-container > .section-heading");
      if (!heading) continue;

      const key = this.packageSectionKey(heading.textContent);
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = heading.className;
      toggle.classList.add("package-section-toggle");
      while (heading.firstChild) toggle.appendChild(heading.firstChild);
      heading.replaceWith(toggle);

      section.classList.add("package-collapsible-section");
      section.dataset.packageSectionKey = key;
      const collapsed = this.collapsedPackageSections.has(key);
      section.classList.toggle("is-collapsed", collapsed);
      toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
    }
  }

  packageSectionKey(title) {
    return String(title).trim().toLocaleLowerCase().replace(/\s+/g, "-");
  }

  update() {}

  beforeShow(opts) {
    if (opts.back == null) {
      opts.back = "Install";
    }

    this.breadcrumbBackPanel = opts.back;
    this.refs.breadcrumb.textContent = this.breadcrumbBackPanel;
  }

  show() {
    this.element.style.display = "";
  }

  focus() {
    this.element.focus();
  }

  render() {
    let packageCardView;
    if (this.pack && this.pack.metadata && this.pack.metadata.owner) {
      packageCardView = (
        <div ref="packageCardParent" className="row">
          <PackageCardComponent
            ref="packageCard"
            settingsView={this.settingsView}
            packageManager={this.packageManager}
            metadata={this.pack.metadata}
            options={{
              onSettingsView: true,
              onPackUpdated: (updatedPack) => this.applySelectedRef(updatedPack),
            }}
          />
        </div>
      );
    } else {
      packageCardView = (
        <div ref="packageCardParent" className="row">
          <div
            ref="loadingMessage"
            className="alert alert-info icon icon-hourglass"
          >{`Loading ${this.pack.name}\u2026`}</div>
          <div ref="errorMessage" className="alert alert-danger icon icon-hourglass hidden">
            Failed to load {this.pack.name} - try again later.
          </div>
        </div>
      );
    }
    return (
      <div tabIndex="0" className="package-detail">
        <ol ref="breadcrumbContainer" className="native-key-bindings breadcrumb" tabIndex="-1">
          <li>
            <a ref="breadcrumb" />
          </li>
          <li className="active">
            <a ref="title" />
          </li>
        </ol>

        <div className="panels-item">
          <section className="section">
            <form className="section-container package-detail-view">
              <div className="container package-container">{packageCardView}</div>

              <p ref="packageRepo" className="link icon icon-repo repo-link hidden" />
              <p ref="startupTime" className="text icon icon-dashboard hidden" tabIndex="-1" />

              <div ref="buttons" className="btn-wrap-group hidden">
                <button ref="learnMoreButton" className="btn btn-default icon icon-link">
                  View on GitHub
                </button>
                <button ref="issueButton" className="btn btn-default icon icon-bug">
                  Report Issue
                </button>
                <button ref="changelogButton" className="btn btn-default icon icon-squirrel">
                  CHANGELOG
                </button>
                <button ref="licenseButton" className="btn btn-default icon icon-law">
                  LICENSE
                </button>
                <button ref="openButton" className="btn btn-default icon icon-link-external">
                  View Code
                </button>
              </div>

              <div ref="errors" />
            </form>
          </section>

          <div ref="sections" />
        </div>
      </div>
    );
  }

  populate() {
    this.refs.title.textContent = `${_.undasherize(_.uncamelcase(this.pack.name))}`;
    this.type = this.pack.metadata.theme ? "theme" : "package";

    const repoUrl = this.packageManager.getRepositoryUrl(this.pack);
    if (repoUrl) {
      const repoName = URL.parse(repoUrl)?.pathname ?? repoUrl;
      this.refs.packageRepo.textContent = repoName.substring(1);
      this.refs.packageRepo.style.display = "";
    } else {
      this.refs.packageRepo.style.display = "none";
    }

    this.updateInstalledState();
  }

  updateInstalledState() {
    if (this.settingsPanel) {
      this.settingsPanel.destroy();
      this.settingsPanel = null;
    }

    if (this.keymapView) {
      this.keymapView.destroy();
      this.keymapView = null;
    }

    if (this.grammarsView) {
      this.grammarsView.destroy();
      this.grammarsView = null;
    }

    if (this.snippetsView) {
      this.snippetsView.destroy();
      this.snippetsView = null;
    }

    if (this.readmeView) {
      this.readmeView.destroy();
      this.readmeView = null;
    }

    this.updateFileButtons();
    this.activateConfig();
    this.refs.startupTime.style.display = "none";

    const loadedPackage = this.getMatchingLoadedPackage();
    if (loadedPackage) {
      if (!atom.packages.isPackageDisabled(this.pack.name)) {
        this.settingsPanel = new SettingsPanel({ namespace: this.pack.name, includeTitle: false });
        this.keymapView = new PackageKeymapView(this.pack);
        this.refs.sections.appendChild(this.settingsPanel.element);
        this.refs.sections.appendChild(this.keymapView.element);

        if (this.pack.path) {
          this.grammarsView = new PackageGrammarsView(this.pack.path);
          this.snippetsView = new PackageSnippetsView(this.pack, this.snippetsProvider);
          this.refs.sections.appendChild(this.grammarsView.element);
          this.refs.sections.appendChild(this.snippetsView.element);
        }

        this.refs.startupTime.innerHTML = `This ${this.type} added <span class='highlight'>${this.getStartupTime()}ms</span> to startup time.`;
        this.refs.startupTime.style.display = "";
      }
    }

    const sourceIsAvailable =
      loadedPackage &&
      loadedPackage.path &&
      ((loadedPackage.metadata.apmInstallSource &&
        loadedPackage.metadata.apmInstallSource.type === "git") ||
        !atom.packages.isBundledPackage(this.pack.name));
    if (sourceIsAvailable) {
      this.refs.openButton.style.display = "";
    } else {
      this.refs.openButton.style.display = "none";
    }

    this.renderReadme();
  }

  // The embedded card changed its selected ref. Reflect the new commit in the
  // detail view and re-fetch the README for that exact commit, since a README
  // belongs to the version it ships with.
  applySelectedRef(pack) {
    if (!this.pack || !this.pack.metadata) return;
    const meta = this.pack.metadata;
    const sha = pack.resolvedSha || pack.latestSha || null;
    const shaChanged = !!sha && sha !== meta.resolvedSha;
    if (pack.selectedRef) meta.selectedRef = pack.selectedRef;
    if (pack.originKey) meta.originKey = pack.originKey;
    if (pack.version != null) meta.version = pack.version;
    if (sha) meta.resolvedSha = sha;
    if (pack.name && pack.name !== this.pack.name) {
      this.pack.name = pack.name;
      meta.name = pack.name;
      this.refs.title.textContent = _.undasherize(_.uncamelcase(pack.name));
    }
    if (shaChanged) {
      meta.readme = undefined;
      meta.readmeSource = undefined;
      this.readmeRequested = false;
      this.renderReadme();
    }
  }

  renderReadme() {
    let readme;
    if (
      this.pack.metadata.readme &&
      this.pack.metadata.readme.trim() !== NORMALIZE_PACKAGE_DATA_README_ERROR
    ) {
      readme = this.pack.metadata.readme;
    } else {
      readme = null;
    }

    if (
      !readme &&
      !this.readmeRequested &&
      this.pack.metadata.originKey &&
      this.pack.metadata.resolvedSha
    ) {
      this.readmeRequested = true;
      this.packageManager
        .getCatalogClient()
        .loadReadme(this.pack.metadata)
        .then((entry) => {
          if (!entry) return;
          this.pack.metadata.readme = entry.body;
          this.pack.metadata.readmeSource = entry.source;
          this.renderReadme();
        })
        .catch(() => {});
    }

    if (
      this.readmePath &&
      fs.existsSync(this.readmePath) &&
      fs.statSync(this.readmePath).isFile() &&
      !readme
    ) {
      readme = fs.readFileSync(this.readmePath, { encoding: "utf8" });
    }

    let readmeSrc, readmeIsLocal;

    if (this.pack.path) {
      // If package is installed, use installed path
      readmeSrc = this.readmePath || path.join(this.pack.path, "README.md");
      readmeIsLocal = true;
    } else {
      // If package isn't installed, use url path
      let repoUrl = this.packageManager.getRepositoryUrl(this.pack);
      readmeIsLocal = false;

      // Check if URL is undefined (i.e. package is unpublished)
      if (repoUrl) {
        readmeSrc = this.pack.metadata.readmeSource || repoUrl;
      }
    }

    const readmeView = new PackageReadmeView(readme, readmeSrc, readmeIsLocal);
    if (this.readmeView) {
      this.readmeView.element.parentElement.replaceChild(
        readmeView.element,
        this.readmeView.element,
      );
      this.readmeView.destroy();
    } else {
      this.refs.sections.appendChild(readmeView.element);
    }
    this.readmeView = readmeView;
    this.enhancePackageSections();
  }

  subscribeToPackageManager() {
    this.disposables.add(
      this.packageManager.on("theme-installed package-installed", ({ pack }) => {
        if (this.isSamePackage(pack)) {
          this.loadPackage();
          this.updateInstalledState();
        }
      }),
    );

    this.disposables.add(
      this.packageManager.on("theme-uninstalled package-uninstalled", ({ pack }) => {
        if (this.isSamePackage(pack)) {
          return this.updateInstalledState();
        }
      }),
    );

    this.disposables.add(
      this.packageManager.on("theme-updated package-updated", ({ pack }) => {
        if (this.isSamePackage(pack)) {
          this.loadPackage();
          this.updateFileButtons();
          this.populate();
        }
      }),
    );
  }

  isSamePackage(pack) {
    if (!pack) return false;
    const currentOrigin = packageOrigin(this.pack.metadata || this.pack);
    const eventOrigin = packageOrigin(pack.metadata || pack);
    if (currentOrigin && eventOrigin) return currentOrigin === eventOrigin;
    return this.pack.name === pack.name;
  }

  openMarkdownFile(path) {
    if (atom.packages.isPackageActive("markdown-preview")) {
      atom.workspace.open(encodeURI(`markdown-preview://${path}`));
    } else {
      atom.workspace.open(path);
    }
  }

  updateFileButtons() {
    this.changelogPath = null;
    this.licensePath = null;
    this.readmePath = null;

    const matchingLoadedPackage = this.getMatchingLoadedPackage();
    const packagePath =
      this.pack.path != null
        ? this.pack.path
        : matchingLoadedPackage && matchingLoadedPackage.path
          ? matchingLoadedPackage.path
          : null;
    if (!packagePath) {
      this.refs.changelogButton.style.display = "none";
      this.refs.licenseButton.style.display = "none";
      return;
    }
    for (const child of fs.listSync(packagePath)) {
      switch (path.basename(child, path.extname(child)).toLowerCase()) {
        case "changelog":
        case "history":
          this.changelogPath = child;
          break;
        case "license":
        case "licence":
          this.licensePath = child;
          break;
        case "readme":
          this.readmePath = child;
          break;
      }

      if (this.readmePath && this.changelogPath && this.licensePath) {
        break;
      }
    }

    if (this.changelogPath) {
      this.refs.changelogButton.style.display = "";
    } else {
      this.refs.changelogButton.style.display = "none";
    }

    if (this.licensePath) {
      this.refs.licenseButton.style.display = "";
    } else {
      this.refs.licenseButton.style.display = "none";
    }
  }

  getStartupTime() {
    const loadTime = this.pack.loadTime != null ? this.pack.loadTime : 0;
    const activateTime = this.pack.activateTime != null ? this.pack.activateTime : 0;
    return loadTime + activateTime;
  }

  scrollUp() {
    this.element.scrollTop -= document.body.offsetHeight / 20;
  }

  scrollDown() {
    this.element.scrollTop += document.body.offsetHeight / 20;
  }

  pageUp() {
    this.element.scrollTop -= this.element.offsetHeight;
  }

  pageDown() {
    this.element.scrollTop += this.element.offsetHeight;
  }

  scrollToTop() {
    this.element.scrollTop = 0;
  }

  scrollToBottom() {
    this.element.scrollTop = this.element.scrollHeight;
  }
}

class PackageCardComponent {
  constructor(props) {
    this.packageCard = new PackageCard(
      props.metadata,
      props.settingsView,
      props.packageManager,
      props.options,
    );
    this.element = this.packageCard.element;
  }

  update() {}

  destroy() {}
}

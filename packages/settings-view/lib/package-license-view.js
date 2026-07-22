/** @babel */

// Displays a package's LICENSE file inline, as a detail-view chapter alongside
// the README. A markdown license is rendered; a plain-text license is shown
// verbatim in a <pre>.
export default class PackageLicenseView {
  constructor(content, isMarkdown, licenseSrc) {
    this.element = document.createElement("section");
    this.element.classList.add("section");

    const container = document.createElement("div");
    container.classList.add("section-container");

    const heading = document.createElement("div");
    heading.classList.add("section-heading", "icon", "icon-law");
    heading.textContent = "License";
    container.appendChild(heading);

    const body = document.createElement("div");
    body.classList.add("package-license", "native-key-bindings");
    body.tabIndex = -1;

    content ||= "No license file.";

    if (isMarkdown) {
      try {
        body.innerHTML = atom.ui.markdown.render(content, {
          breaks: false,
          taskCheckboxDisabled: true,
          useGitHubHeadings: true,
          filePath: licenseSrc,
        });
      } catch {
        body.innerHTML = "<h3>Error parsing LICENSE</h3>";
      }
    } else {
      const pre = document.createElement("pre");
      pre.classList.add("package-license-text");
      pre.textContent = content;
      body.appendChild(pre);
    }

    container.appendChild(body);
    this.element.appendChild(container);
  }

  destroy() {
    this.element.remove();
  }
}

const { CompositeDisposable, Disposable } = require("atom");
const { Liquid } = require("liquidjs");

const templateEngine = new Liquid({ jsTruthy: true });
const presetTemplates = Object.freeze({
  "Row and Column": "{{ end.row }}:{{ end.col }}",
  "Row and Column, Lines and Chars":
    "{{ end.row }}:{{ end.col }}{% if chars %} ({{ lines }}:{{ chars }}){% endif %}",
  "With Selection":
    "{{ start.row }}:{{ start.col }}{% if chars %}-{{ end.row }}:{{ end.col }}{% endif %}",
  "With Selection and Cursors":
    "{{ start.row }}:{{ start.col }}{% if chars %}-{{ end.row }}:{{ end.col }}{% endif %}{% if n > 1 %} #{{ n }}{% endif %}",
  Hide: "",
});

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

module.exports = class EditorPositionView {
  constructor() {
    this.viewUpdatePending = false;
    this.templateSelection = "";
    this.customTemplate = "";
    this.parsedTemplate = null;

    this.element = document.createElement("status-bar-editor");
    this.element.classList.add("editor-position", "inline-block");
    this.link = document.createElement("a");
    this.link.classList.add("inline-block");
    this.element.appendChild(this.link);

    this.activeItemSubscription = atom.workspace.onDidChangeActiveTextEditor(() =>
      this.subscribeToActiveTextEditor(),
    );

    this.subscribeToConfig();
    this.subscribeToActiveTextEditor();

    this.tooltip = atom.tooltips.add(this.element, {
      title: () => this.tooltipTitle(),
    });

    this.handleClick();
  }

  destroy() {
    this.activeItemSubscription.dispose();
    this.selectionSubscription?.dispose();
    this.tooltip.dispose();
    this.configSubscriptions?.dispose();
    this.clickSubscription.dispose();
    this.updateSubscription?.dispose();
  }

  subscribeToActiveTextEditor() {
    this.selectionSubscription?.dispose();
    const selectionsMarkerLayer = atom.workspace.getActiveTextEditor()?.selectionsMarkerLayer;
    this.selectionSubscription = selectionsMarkerLayer?.onDidUpdate(this.scheduleUpdate.bind(this));
    this.scheduleUpdate();
  }

  subscribeToConfig() {
    this.configSubscriptions?.dispose();
    this.configSubscriptions = new CompositeDisposable();
    this.configSubscriptions.add(
      atom.config.observe("editor-status.template", (value) => {
        this.templateSelection = value || "";
        this.updateTemplate();
      }),
      atom.config.observe("editor-status.custom", (value) => {
        this.customTemplate = value || "";
        this.updateTemplate();
      }),
    );
  }

  updateTemplate() {
    let template;
    if (this.templateSelection === "Custom") {
      template = this.customTemplate;
    } else if (Object.prototype.hasOwnProperty.call(presetTemplates, this.templateSelection)) {
      // A known preset (including `Hide`, which maps to an empty template).
      template = presetTemplates[this.templateSelection];
    } else {
      // An unrecognized value is treated as a raw template.
      template = this.templateSelection;
    }
    this.parsedTemplate = null;
    if (template && template.trim()) {
      try {
        this.parsedTemplate = templateEngine.parse(template);
      } catch (error) {
        atom.notifications.addWarning("editor-status: invalid template", {
          detail: error.message || String(error),
        });
      }
    }
    this.scheduleUpdate();
  }

  handleClick() {
    const clickHandler = () =>
      atom.commands.dispatch(
        atom.views.getView(atom.workspace.getActiveTextEditor()),
        "go-to-line:toggle",
      );
    this.element.addEventListener("click", clickHandler);
    this.clickSubscription = new Disposable(() =>
      this.element.removeEventListener("click", clickHandler),
    );
  }

  tooltipTitle() {
    if (this.startRow == null) {
      return "";
    }
    let title;
    if (this.selectionEmpty) {
      title = `Line ${this.startRow}, Column ${this.startColumn}`;
    } else {
      title =
        `Line ${this.startRow}, Column ${this.startColumn} to Line ${this.endRow}, Column ${this.endColumn}` +
        ` — ${plural(this.selectionLines, "line")}, ${plural(this.selectionLength, "character")} selected`;
    }
    if (this.cursorCount > 1) {
      title += ` — ${plural(this.cursorCount, "cursor")}`;
    }
    return title;
  }

  scheduleUpdate() {
    if (this.viewUpdatePending) {
      return;
    }

    this.viewUpdatePending = true;
    this.updateSubscription = atom.views.updateDocument(() => {
      this.viewUpdatePending = false;
      this.update();
    });
  }

  update() {
    const editor = atom.workspace?.getActiveTextEditor();

    if (!editor || !this.parsedTemplate) {
      this.startRow = null;
      this.link.textContent = "";
      this.element.classList.add("hide");
      return;
    }

    // Report the most recently added selection. `start` is the anchor where the
    // selection began and `end` is the head where the cursor is, so the pair
    // respects the selection's direction (they collapse to the cursor position
    // when nothing is selected).
    const selection = editor.getLastSelection();
    const tail = selection.getTailBufferPosition();
    const head = selection.getHeadBufferPosition();
    const range = selection.getBufferRange();
    this.selectionEmpty = range.isEmpty();
    this.startRow = tail.row + 1;
    this.startColumn = tail.column + 1;
    this.endRow = head.row + 1;
    this.endColumn = head.column + 1;

    this.selectionLength = selection.getText().length;
    this.selectionLines = this.selectionEmpty
      ? 0
      : range.getRowCount() - (range.end.column === 0 ? 1 : 0);
    this.cursorCount = editor.getCursors().length;

    let text;
    try {
      text = templateEngine.renderSync(this.parsedTemplate, {
        start: { row: this.startRow, col: this.startColumn },
        end: { row: this.endRow, col: this.endColumn },
        lines: this.selectionLines,
        chars: this.selectionLength,
        n: this.cursorCount,
      });
    } catch {
      // a template that fails at render time hides the tile
      text = "";
    }

    if (text) {
      this.link.textContent = text;
      this.element.classList.remove("hide");
    } else {
      this.link.textContent = "";
      this.element.classList.add("hide");
    }
  }
};

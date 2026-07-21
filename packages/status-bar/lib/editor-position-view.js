const { CompositeDisposable, Disposable } = require("atom");

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

module.exports = class EditorPositionView {
  constructor() {
    this.viewUpdatePending = false;

    this.element = document.createElement("status-bar-editor");
    this.element.classList.add("editor-position", "inline-block");
    this.link = document.createElement("a");
    this.link.classList.add("inline-block");
    this.element.appendChild(this.link);

    this.positionFormat = atom.config.get("status-bar.positionFormat") ?? "%L:%C";
    this.selectionFormat = atom.config.get("status-bar.selectionFormat") ?? ":%L:%C";
    this.multipleFormat = atom.config.get("status-bar.multipleFormat") ?? " #%n";

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
      atom.config.observe("status-bar.positionFormat", (value) => {
        this.positionFormat = value ?? "%L:%C";
        this.scheduleUpdate();
      }),
      atom.config.observe("status-bar.selectionFormat", (value) => {
        this.selectionFormat = value ?? ":%L:%C";
        this.scheduleUpdate();
      }),
      atom.config.observe("status-bar.multipleFormat", (value) => {
        this.multipleFormat = value ?? " #%n";
        this.scheduleUpdate();
      }),
    );
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
    if (this.row == null) {
      return "";
    }
    let title = `Line ${this.row}, Column ${this.column}`;
    if (this.selectionLength > 0) {
      title += ` — ${plural(this.selectionLines, "line")}, ${plural(this.selectionLength, "character")} selected`;
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
    const position = editor?.getCursorBufferPosition();

    if (!position) {
      this.row = null;
      this.column = null;
      this.selectionLength = 0;
      this.selectionLines = 0;
      this.cursorCount = 0;
      this.link.textContent = "";
      this.element.classList.add("hide");
      return;
    }

    this.element.classList.remove("hide");
    this.row = position.row + 1;
    this.column = position.column + 1;
    let text = this.positionFormat.replace("%L", this.row).replace("%C", this.column);

    this.selectionLength = editor.getSelectedText().length;
    const range = editor.getSelectedBufferRange();
    this.selectionLines = range.getRowCount();
    if (range.end.column === 0) {
      this.selectionLines -= 1;
    }
    if (this.selectionLength > 0) {
      text += this.selectionFormat
        .replace("%L", this.selectionLines)
        .replace("%C", this.selectionLength);
    }

    this.cursorCount = editor.getCursors().length;
    if (this.cursorCount > 1) {
      text += this.multipleFormat.replace("%n", this.cursorCount);
    }

    this.link.textContent = text;
  }
};

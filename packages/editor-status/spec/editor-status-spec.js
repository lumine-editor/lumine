const fs = require("@lumine-code/fs-plus");
const path = require("path");
const os = require("os");

describe("Editor Status", function () {
  let [statusBar, workspaceElement, dummyView] = [];

  beforeEach(function () {
    workspaceElement = atom.views.getView(atom.workspace);
    dummyView = document.createElement("div");
    statusBar = null;

    waitsForPromise(() => atom.packages.activatePackage("status-bar"));
    waitsForPromise(() => atom.packages.activatePackage("editor-status"));

    runs(() => (statusBar = workspaceElement.querySelector("status-bar")));
  });

  describe("the file info and editor position tiles", function () {
    let [editor, buffer, fileInfo, editorPosition] = [];

    beforeEach(function () {
      waitsForPromise(() => atom.workspace.open("sample.js"));

      runs(function () {
        [fileInfo, editorPosition] = statusBar.getLeftTiles().map((tile) => tile.getItem());
        editor = atom.workspace.getActiveTextEditor();
        return (buffer = editor.getBuffer());
      });
    });

    describe("when associated with an unsaved buffer", () =>
      it("displays 'untitled' instead of the buffer's path, but still displays the buffer position", function () {
        waitsForPromise(() => atom.workspace.open());

        runs(function () {
          atom.views.performDocumentUpdate();
          expect(fileInfo.currentPath.textContent).toBe("untitled");
          expect(editorPosition.textContent).toBe("1:1");
        });
      }));

    describe("when the associated editor's path changes", () =>
      it("updates the path in the status bar", function () {
        waitsForPromise(() => atom.workspace.open("sample.txt"));

        runs(() => expect(fileInfo.currentPath.textContent).toBe("sample.txt"));
      }));

    describe("when associated with remote file path", function () {
      beforeEach(function () {
        jasmine.attachToDOM(workspaceElement);
        dummyView.getPath = () => "remote://server:123/folder/remote_file.txt";
        return atom.workspace.getActivePane().activateItem(dummyView);
      });

      it("updates the path in the status bar", function () {
        // The remote path isn't relativized in the test because no remote directory provider is registered.
        expect(fileInfo.currentPath.textContent).toBe("remote://server:123/folder/remote_file.txt");
        expect(fileInfo.currentPath).toBeVisible();
      });

      it("when the path is clicked", function () {
        fileInfo.currentPath.click();
        expect(atom.clipboard.read()).toBe("/folder/remote_file.txt");
      });

      it("calls relativize with the remote URL on shift-click", function () {
        const spy = spyOn(atom.project, "relativize").andReturn("remote_file.txt");
        const event = new MouseEvent("click", { shiftKey: true });
        fileInfo.dispatchEvent(event);
        expect(atom.clipboard.read()).toBe("remote_file.txt");
        expect(spy).toHaveBeenCalledWith("remote://server:123/folder/remote_file.txt");
      });
    });

    describe("when file info tile is clicked", () =>
      it("copies the absolute path into the clipboard if available", function () {
        waitsForPromise(() => atom.workspace.open("sample.txt"));

        runs(function () {
          fileInfo.click();
          expect(atom.clipboard.read()).toBe(fileInfo.getActiveItem().getPath());
        });
      }));

    describe("when the file info tile is shift-clicked", () =>
      it("copies the relative path into the clipboard if available", function () {
        waitsForPromise(() => atom.workspace.open("sample.txt"));

        runs(function () {
          const event = new MouseEvent("click", { shiftKey: true });
          fileInfo.dispatchEvent(event);
          expect(atom.clipboard.read()).toBe("sample.txt");
        });
      }));

    describe("when path of an unsaved buffer is clicked", () =>
      it("copies the 'untitled' into clipboard", function () {
        waitsForPromise(() => atom.workspace.open());

        runs(function () {
          fileInfo.currentPath.click();
          expect(atom.clipboard.read()).toBe("untitled");
        });
      }));

    describe("when buffer's path is not clicked", () =>
      it("doesn't display a path tooltip", function () {
        jasmine.attachToDOM(workspaceElement);
        waitsForPromise(() => atom.workspace.open());

        runs(() => expect(document.querySelector(".tooltip")).not.toExist());
      }));

    describe("when buffer's path is clicked", () =>
      it("displays path tooltip and the tooltip disappears after ~2 seconds", function () {
        jasmine.attachToDOM(workspaceElement);
        waitsForPromise(() => atom.workspace.open());

        runs(function () {
          fileInfo.currentPath.click();
          expect(document.querySelector(".tooltip")).toBeVisible();
          // extra leeway so test won't fail because tooltip disappeared few milliseconds too late
          advanceClock(2100);
          expect(document.querySelector(".tooltip")).not.toExist();
        });
      }));

    describe("when saved buffer's path is clicked", function () {
      it("displays a tooltip containing text 'Copied:' and an absolute native path", function () {
        jasmine.attachToDOM(workspaceElement);
        waitsForPromise(() => atom.workspace.open("sample.txt"));

        runs(function () {
          fileInfo.currentPath.click();
          expect(document.querySelector(".tooltip")).toHaveText(
            `Copied: ${fileInfo.getActiveItem().getPath()}`,
          );
        });
      });

      it("displays a tooltip containing text 'Copied:' for an absolute Unix path", function () {
        jasmine.attachToDOM(workspaceElement);
        dummyView.getPath = () => "/user/path/for/my/file.txt";
        atom.workspace.getActivePane().activateItem(dummyView);

        runs(function () {
          fileInfo.currentPath.click();
          expect(document.querySelector(".tooltip")).toHaveText(`Copied: ${dummyView.getPath()}`);
        });
      });

      it("displays a tooltip containing text 'Copied:' for an absolute Windows path", function () {
        jasmine.attachToDOM(workspaceElement);
        dummyView.getPath = () => "c:\\user\\path\\for\\my\\file.txt";
        atom.workspace.getActivePane().activateItem(dummyView);

        runs(function () {
          fileInfo.currentPath.click();
          expect(document.querySelector(".tooltip")).toHaveText(`Copied: ${dummyView.getPath()}`);
        });
      });
    });

    describe("when unsaved buffer's path is clicked", () =>
      it("displays a tooltip containing text 'Copied: untitled", function () {
        jasmine.attachToDOM(workspaceElement);
        waitsForPromise(() => atom.workspace.open());

        runs(function () {
          fileInfo.currentPath.click();
          expect(document.querySelector(".tooltip")).toHaveText("Copied: untitled");
        });
      }));

    describe("when the associated editor's buffer's content changes", () =>
      it("enables the buffer modified indicator", function () {
        expect(fileInfo.classList.contains("buffer-modified")).toBe(false);
        editor.insertText("\n");
        advanceClock(buffer.stoppedChangingDelay);
        expect(fileInfo.classList.contains("buffer-modified")).toBe(true);
        return editor.backspace();
      }));

    describe("when the buffer content has changed from the content on disk", function () {
      it("disables the buffer modified indicator on save", function () {
        const filePath = path.join(os.tmpdir(), "atom-whitespace.txt");
        fs.writeFileSync(filePath, "");

        waitsForPromise(() => atom.workspace.open(filePath));

        runs(function () {
          editor = atom.workspace.getActiveTextEditor();
          expect(fileInfo.classList.contains("buffer-modified")).toBe(false);
          editor.insertText("\n");
          advanceClock(buffer.stoppedChangingDelay);
          expect(fileInfo.classList.contains("buffer-modified")).toBe(true);
        });

        waitsForPromise(() =>
          // TODO - remove this Promise.resolve once atom/atom#14435 lands.
          Promise.resolve(editor.getBuffer().save()),
        );

        runs(() => expect(fileInfo.classList.contains("buffer-modified")).toBe(false));
      });

      it("disables the buffer modified indicator if the content matches again", function () {
        expect(fileInfo.classList.contains("buffer-modified")).toBe(false);
        editor.insertText("\n");
        advanceClock(buffer.stoppedChangingDelay);
        expect(fileInfo.classList.contains("buffer-modified")).toBe(true);
        editor.backspace();
        advanceClock(buffer.stoppedChangingDelay);
        expect(fileInfo.classList.contains("buffer-modified")).toBe(false);
      });

      it("disables the buffer modified indicator when the change is undone", function () {
        expect(fileInfo.classList.contains("buffer-modified")).toBe(false);
        editor.insertText("\n");
        advanceClock(buffer.stoppedChangingDelay);
        expect(fileInfo.classList.contains("buffer-modified")).toBe(true);
        editor.undo();
        advanceClock(buffer.stoppedChangingDelay);
        expect(fileInfo.classList.contains("buffer-modified")).toBe(false);
      });
    });

    describe("when the buffer changes", function () {
      it("updates the buffer modified indicator for the new buffer", function () {
        expect(fileInfo.classList.contains("buffer-modified")).toBe(false);

        waitsForPromise(() => atom.workspace.open("sample.txt"));

        runs(function () {
          editor = atom.workspace.getActiveTextEditor();
          editor.insertText("\n");
          advanceClock(buffer.stoppedChangingDelay);
          expect(fileInfo.classList.contains("buffer-modified")).toBe(true);
        });
      });

      it("doesn't update the buffer modified indicator for the old buffer", function () {
        const oldBuffer = editor.getBuffer();
        expect(fileInfo.classList.contains("buffer-modified")).toBe(false);

        waitsForPromise(() => atom.workspace.open("sample.txt"));

        runs(function () {
          oldBuffer.setText("new text");
          advanceClock(buffer.stoppedChangingDelay);
          expect(fileInfo.classList.contains("buffer-modified")).toBe(false);
        });
      });
    });

    describe("when the associated editor's cursor position changes", function () {
      it("updates the cursor position in the status bar", function () {
        jasmine.attachToDOM(workspaceElement);
        editor.setCursorScreenPosition([1, 2]);
        atom.views.performDocumentUpdate();
        expect(editorPosition.textContent).toBe("2:3");
      });

      it("does not throw an exception if the cursor is moved as the result of the active pane item changing to a non-editor (regression)", function () {
        waitsForPromise(() => Promise.resolve(atom.packages.deactivatePackage("editor-status"))); // Wrapped so works with Promise & non-Promise deactivate
        runs(() =>
          atom.workspace.onDidChangeActivePaneItem(() => editor.setCursorScreenPosition([1, 2])),
        );
        waitsForPromise(() => atom.packages.activatePackage("editor-status"));
        runs(function () {
          editorPosition = statusBar.getLeftTiles()[1].getItem();

          atom.workspace.getActivePane().activateItem(document.createElement("div"));
          expect(editor.getCursorScreenPosition()).toEqual([1, 2]);
          atom.views.performDocumentUpdate();
          expect(editorPosition).toBeHidden();
        });
      });
    });

    describe("when the associated editor's selection changes", function () {
      beforeEach(() => atom.config.set("editor-status.template", "With Selection and Cursors"));

      it("shows the selection range in the status bar", function () {
        jasmine.attachToDOM(workspaceElement);

        editor.setSelectedBufferRange([
          [0, 0],
          [0, 0],
        ]);
        atom.views.performDocumentUpdate();
        expect(editorPosition.textContent).toBe("1:1");

        editor.setSelectedBufferRange([
          [0, 0],
          [0, 2],
        ]);
        atom.views.performDocumentUpdate();
        expect(editorPosition.textContent).toBe("1:1-1:3");

        editor.setSelectedBufferRange([
          [0, 0],
          [1, 30],
        ]);
        atom.views.performDocumentUpdate();
        expect(editorPosition.textContent).toBe("1:1-2:31");
      });

      it("shows the selection end coordinate even when it lands at the start of a line", function () {
        jasmine.attachToDOM(workspaceElement);
        editor.setSelectedBufferRange([
          [0, 0],
          [1, 0],
        ]);
        atom.views.performDocumentUpdate();
        expect(editorPosition.textContent).toBe("1:1-2:1");
      });

      it("respects the selection direction (anchor as start, cursor as end)", function () {
        jasmine.attachToDOM(workspaceElement);
        editor.setSelectedBufferRange(
          [
            [0, 0],
            [1, 30],
          ],
          { reversed: true },
        );
        atom.views.performDocumentUpdate();
        // The cursor sits at the top of a reversed selection, so start is the
        // anchor (bottom) and end is the cursor (top).
        expect(editorPosition.textContent).toBe("2:31-1:1");
      });

      it("appends the cursor count when there is more than one cursor", function () {
        jasmine.attachToDOM(workspaceElement);

        editor.setCursorBufferPosition([0, 0]);
        editor.addCursorAtBufferPosition([1, 2]);
        atom.views.performDocumentUpdate();
        expect(editorPosition.textContent).toBe("2:3 #2");

        editor.setSelectedBufferRanges([
          [
            [0, 0],
            [0, 1],
          ],
          [
            [1, 0],
            [1, 3],
          ],
        ]);
        atom.views.performDocumentUpdate();
        expect(editorPosition.textContent).toBe("2:1-2:4 #2");
      });

      it("does not throw an exception if the cursor is moved as the result of the active pane item changing to a non-editor (regression)", function () {
        waitsForPromise(() => Promise.resolve(atom.packages.deactivatePackage("editor-status"))); // Wrapped so works with Promise & non-Promise deactivate
        runs(() =>
          atom.workspace.onDidChangeActivePaneItem(() =>
            editor.setSelectedBufferRange([
              [1, 2],
              [1, 3],
            ]),
          ),
        );
        waitsForPromise(() => atom.packages.activatePackage("editor-status"));
        runs(function () {
          editorPosition = statusBar.getLeftTiles()[1].getItem();

          atom.workspace.getActivePane().activateItem(document.createElement("div"));
          expect(editor.getSelectedBufferRange()).toEqual([
            [1, 2],
            [1, 3],
          ]);
          atom.views.performDocumentUpdate();
          expect(editorPosition).toBeHidden();
        });
      });
    });

    describe("when the active pane item does not implement getCursorBufferPosition()", () =>
      it("hides the editor position view", function () {
        jasmine.attachToDOM(workspaceElement);
        atom.workspace.getActivePane().activateItem(dummyView);
        atom.views.performDocumentUpdate();
        expect(editorPosition).toBeHidden();
      }));

    describe("when the active pane item implements getTitle() but not getPath()", () =>
      it("displays the title", function () {
        jasmine.attachToDOM(workspaceElement);
        dummyView.getTitle = () => "View Title";
        atom.workspace.getActivePane().activateItem(dummyView);
        expect(fileInfo.currentPath.textContent).toBe("View Title");
        expect(fileInfo.currentPath).toBeVisible();
      }));

    describe("when the active pane item neither getTitle() nor getPath()", () =>
      it("hides the path view", function () {
        jasmine.attachToDOM(workspaceElement);
        atom.workspace.getActivePane().activateItem(dummyView);
        expect(fileInfo.currentPath).toBeHidden();
      }));

    describe("when the active pane item's title changes", () =>
      it("updates the path view with the new title", function () {
        jasmine.attachToDOM(workspaceElement);
        const callbacks = [];
        dummyView.onDidChangeTitle = function (fn) {
          callbacks.push(fn);
          return {
            dispose() {},
          };
        };
        dummyView.getTitle = () => "View Title";
        atom.workspace.getActivePane().activateItem(dummyView);
        expect(fileInfo.currentPath.textContent).toBe("View Title");
        dummyView.getTitle = () => "New Title";
        for (let callback of Array.from(callbacks)) {
          callback();
        }
        expect(fileInfo.currentPath.textContent).toBe("New Title");
      }));

    describe("the editor position tile", function () {
      it("renders the selected preset without a selection", function () {
        atom.config.set("editor-status.template", "Row and Column");
        jasmine.attachToDOM(workspaceElement);
        editor.setCursorScreenPosition([1, 2]);
        atom.views.performDocumentUpdate();
        expect(editorPosition.textContent).toBe("2:3");
      });

      it("shows the cursor (end) and omits the range for the 'Row and Column' preset", function () {
        atom.config.set("editor-status.template", "Row and Column");
        jasmine.attachToDOM(workspaceElement);
        editor.setSelectedBufferRange([
          [0, 0],
          [1, 30],
        ]);
        atom.views.performDocumentUpdate();
        expect(editorPosition.textContent).toBe("2:31");
      });

      it("shows the cursor and selection size for the 'Row and Column, Lines and Chars' preset", function () {
        atom.config.set("editor-status.template", "Row and Column, Lines and Chars");
        jasmine.attachToDOM(workspaceElement);

        editor.setCursorScreenPosition([1, 2]);
        atom.views.performDocumentUpdate();
        expect(editorPosition.textContent).toBe("2:3");

        editor.setSelectedBufferRange([
          [0, 0],
          [1, 30],
        ]);
        atom.views.performDocumentUpdate();
        expect(editorPosition.textContent).toBe("2:31 (2:60)");

        editor.setCursorBufferPosition([0, 0]);
        editor.addCursorAtBufferPosition([1, 2]);
        atom.views.performDocumentUpdate();
        expect(editorPosition.textContent).toBe("2:3 #2");
      });

      it("shows the range for the 'With Selection' preset", function () {
        atom.config.set("editor-status.template", "With Selection");
        jasmine.attachToDOM(workspaceElement);
        editor.setSelectedBufferRange([
          [0, 0],
          [1, 30],
        ]);
        atom.views.performDocumentUpdate();
        expect(editorPosition.textContent).toBe("1:1-2:31");
      });

      it("respects a custom template", function () {
        atom.config.set("editor-status.template", "Custom");
        atom.config.set("editor-status.custom", "{{ lines }} lines, {{ chars }} chars");
        jasmine.attachToDOM(workspaceElement);
        editor.setSelectedBufferRange([
          [0, 0],
          [1, 30],
        ]);
        atom.views.performDocumentUpdate();
        expect(editorPosition.textContent).toBe("2 lines, 60 chars");
      });

      it("updates when the custom template changes", function () {
        atom.config.set("editor-status.template", "Custom");
        atom.config.set("editor-status.custom", "L{{ start.row }}");
        jasmine.attachToDOM(workspaceElement);
        editor.setCursorScreenPosition([1, 2]);
        atom.views.performDocumentUpdate();
        expect(editorPosition.textContent).toBe("L2");

        atom.config.set("editor-status.custom", "C{{ start.col }}");
        atom.views.performDocumentUpdate();
        expect(editorPosition.textContent).toBe("C3");
      });

      it("supports conditional cursor-count sections in a custom template", function () {
        atom.config.set("editor-status.template", "Custom");
        atom.config.set(
          "editor-status.custom",
          "{{ start.row }}{% if n > 1 %} ({{ n }}){% endif %}",
        );
        jasmine.attachToDOM(workspaceElement);

        editor.setCursorBufferPosition([0, 0]);
        atom.views.performDocumentUpdate();
        expect(editorPosition.textContent).toBe("1");

        editor.addCursorAtBufferPosition([1, 2]);
        atom.views.performDocumentUpdate();
        expect(editorPosition.textContent).toBe("2 (2)");
      });

      it("hides the tile for the 'Hide' preset", function () {
        atom.config.set("editor-status.template", "Hide");
        jasmine.attachToDOM(workspaceElement);
        editor.setCursorScreenPosition([1, 2]);
        atom.views.performDocumentUpdate();
        expect(editorPosition).toBeHidden();
      });

      it("hides the tile when the template renders empty", function () {
        atom.config.set("editor-status.template", "Custom");
        atom.config.set("editor-status.custom", "{% if chars %}{{ chars }}{% endif %}");
        jasmine.attachToDOM(workspaceElement);
        editor.setCursorBufferPosition([0, 0]);
        atom.views.performDocumentUpdate();
        expect(editorPosition).toBeHidden();
      });

      describe("when clicked", () =>
        it("triggers the go-to-line toggle event", function () {
          const eventHandler = jasmine.createSpy("eventHandler");
          atom.commands.add("atom-text-editor", "go-to-line:toggle", eventHandler);
          editorPosition.click();
          expect(eventHandler).toHaveBeenCalled();
        }));
    });
  });
});

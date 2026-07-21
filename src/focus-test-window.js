module.exports = async function focusTestWindow() {
  if (document.hasFocus()) return;

  const remote = require("@electron/remote");
  const currentWindow = remote.getCurrentWindow();
  const webContents = remote.getCurrentWebContents();
  const timeoutAt = Date.now() + 10000;

  // BrowserWindow.focus() requests native-window focus, while
  // WebContents.focus() focuses the page itself. Both transitions are
  // asynchronous on CI hosts, so do not continue until the renderer confirms
  // that they have completed.
  while (!document.hasFocus()) {
    currentWindow.focus();
    webContents.focus();
    await new Promise((resolve) => setTimeout(resolve, 50));

    if (Date.now() >= timeoutAt) {
      throw new Error("Timed out waiting for the CI spec window to receive focus");
    }
  }
};

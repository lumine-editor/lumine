const WatcherTask = require("../src/watcher-task");

describe("WatcherTask", function () {
  it("drops the child and emits task:exited when the worker dies", async function () {
    const task = new WatcherTask(require.resolve("../src/parcel-watcher-worker"));
    task.createChildProcess();

    const exited = new Promise((resolve) => task.on("task:exited", resolve));
    task.childProcess.kill("SIGKILL");
    await exited;

    // The dead channel must not be sent to again (an unguarded send would
    // emit an uncaught "Channel closed" error), and the task must know it no
    // longer owns a process.
    expect(task.childProcess).toBe(null);
    expect(() => task.send("hello")).not.toThrow();
    expect(task.terminate()).toBe(false);
  });
});

const { userAgent } = process.env;
const taskPath = process.argv.at(-1);
const compileCachePath = process.env.LUMINE_COMPILE_CACHE_PATH;

const CompileCache = require("./compile-cache");
CompileCache.setCacheDirectory(compileCachePath);
CompileCache.install(`${process.resourcesPath}`, require);

function setupGlobals() {
  global.attachEvent = () => {};

  const console = {
    warn() {
      return global.emit("task:warn", ...arguments);
    },
    log() {
      return global.emit("task:log", ...arguments);
    },
    error() {
      return global.emit("task:error", ...arguments);
    },
    trace() {},
  };

  global.__defineGetter__("console", () => console);

  global.document = {
    createElement() {
      return {
        setAttribute() {},
        getElementsByTagName() {
          return [];
        },
        appendChild() {},
      };
    },
    documentElement: {
      insertBefore() {},
      removeChild() {},
    },
    getElementById() {
      return {};
    },
    createComment() {
      return {};
    },
    createDocumentFragment() {
      return {};
    },
  };

  // A send on a closed channel emits an uncaught `error` event; the parent
  // window may go away at any time, so drop messages once disconnected.
  global.emit = (event, ...args) => {
    if (process.connected) process.send({ event, args });
  };
  global.navigator = { userAgent };

  return (global.window = global);
}

let handler;

function handleEvents() {
  process.on("uncaughtException", (error) => {
    console.error(error.message, error.stack);
  });

  // The uncaughtException handler above keeps this process alive; without
  // this, a worker whose window closed would linger forever as a zombie.
  process.on("disconnect", () => process.exit(0));

  return process.on("message", function ({ event, args } = {}) {
    if (event !== "start") return;
    handler(...args);
  });
}

setupGlobals();
handleEvents();
handler = require(taskPath);

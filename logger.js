const LEVEL = process.env.LOG_LEVEL || "info";
const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

function log(level, message, meta = {}) {
  if (LEVELS[level] < LEVELS[LEVEL]) return;

  const entry = {
    ts: new Date().toISOString(),
    level,
    message,
    ...meta,
  };

  const output = JSON.stringify(entry, serializeError);
  if (level === "error" || level === "warn") {
    console.error(output);
  } else {
    console.log(output);
  }
}

function serializeError(key, value) {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }

  return value;
}

export const logger = {
  debug: (msg, meta) => log("debug", msg, meta),
  info: (msg, meta) => log("info", msg, meta),
  warn: (msg, meta) => log("warn", msg, meta),
  error: (msg, meta) => log("error", msg, meta),
};

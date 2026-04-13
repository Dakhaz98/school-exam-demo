/**
 * File-based error logging (append-only). Safe no-op if disk fails.
 */
const fs = require("fs");
const path = require("path");

const LOG_DIR = path.join(__dirname, "..", "data", "logs");
const LOG_FILE = path.join(LOG_DIR, "server-errors.log");

function ensureDir() {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  } catch {
    /* ignore */
  }
}

function line(level, msg, extra) {
  const ts = new Date().toISOString();
  const tail = extra != null ? ` ${typeof extra === "string" ? extra : JSON.stringify(extra)}` : "";
  return `[${ts}] [${level}] ${msg}${tail}\n`;
}

function logError(message, errOrMeta) {
  ensureDir();
  const err =
    errOrMeta && typeof errOrMeta === "object" && errOrMeta.stack
      ? `${errOrMeta.message}\n${errOrMeta.stack}`
      : String(errOrMeta ?? "");
  try {
    fs.appendFileSync(LOG_FILE, line("ERROR", message, err), "utf8");
  } catch {
    // eslint-disable-next-line no-console
    console.error("[logger]", message, errOrMeta);
  }
}

function logWarn(message, meta) {
  ensureDir();
  try {
    fs.appendFileSync(LOG_FILE, line("WARN", message, meta), "utf8");
  } catch {
    // eslint-disable-next-line no-console
    console.warn("[logger]", message, meta);
  }
}

function logInfo(message, meta) {
  ensureDir();
  try {
    fs.appendFileSync(LOG_FILE, line("INFO", message, meta), "utf8");
  } catch {
    /* ignore */
  }
}

module.exports = { logError, logWarn, logInfo, LOG_FILE };

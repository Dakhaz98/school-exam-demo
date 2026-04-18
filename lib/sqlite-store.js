/**
 * SQLite persistence for exam platform state (WAL, debounced writes).
 * Uses Node.js built-in `node:sqlite` (no native compile; needs Node >= 22.5).
 * Audit & integrity long tails are stored in dedicated tables.
 */
const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");
const logger = require("./logger");

const DATA_DIR = path.join(__dirname, "..", "data");
const DB_PATH = path.join(DATA_DIR, "exam-platform.db");

let db = null;
let persistTimer = null;
const DEBOUNCE_MS = 280;

function openDb() {
  if (db) return db;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  db = new DatabaseSync(DB_PATH);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA synchronous = NORMAL;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS kv (
      k TEXT PRIMARY KEY,
      v TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      at TEXT NOT NULL,
      action TEXT NOT NULL,
      detail TEXT,
      actor_role TEXT,
      actor_id TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(at);
    CREATE TABLE IF NOT EXISTS integrity_log (
      id TEXT PRIMARY KEY,
      at TEXT NOT NULL,
      room_id TEXT,
      student_id TEXT,
      type TEXT NOT NULL,
      detail TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_integ_at ON integrity_log(at);
  `);
  return db;
}

function isoNow() {
  return new Date().toISOString();
}

/**
 * Merge persisted data into live state object (mutates in place).
 * @param {object} state
 */
function hydrateState(state) {
  try {
    const d = openDb();
    const get = d.prepare("SELECT v FROM kv WHERE k = ?");
    const read = (k, fallback) => {
      const row = get.get(k);
      if (!row?.v) return fallback;
      try {
        return JSON.parse(row.v);
      } catch {
        return fallback;
      }
    };

    const students = read("students", null);
    if (Array.isArray(students)) state.students = students;
    const teachers = read("teachers", null);
    if (Array.isArray(teachers)) state.teachers = teachers;
    const models = read("uploadedQuestionModels", null);
    if (Array.isArray(models)) state.uploadedQuestionModels = models;
    const ex = read("examSession", null);
    if (ex && typeof ex === "object" && Array.isArray(ex.rooms)) state.examSession = ex;
    const answers = read("answers", null);
    if (answers && typeof answers === "object") state.answers = answers;
    const honesty = read("studentHonestyAck", null);
    if (honesty && typeof honesty === "object") state.studentHonestyAck = honesty;
    const paperSets = read("studentPaperSets", null);
    if (paperSets && typeof paperSets === "object") state.studentPaperSets = paperSets;
    const paperCur = read("studentPaperCursor", null);
    if (paperCur && typeof paperCur === "object") state.studentPaperCursor = paperCur;
    const entry = read("studentEntryStatus", null);
    if (entry && typeof entry === "object") state.studentEntryStatus = entry;
    const revoked = read("studentExamRevoked", null);
    if (revoked && typeof revoked === "object") state.studentExamRevoked = revoked;
    const rp = read("roomPaperReleased", null);
    if (rp && typeof rp === "object") state.roomPaperReleased = rp;
    const inc = read("incidents", null);
    if (Array.isArray(inc)) state.incidents = inc;

    const keyRow = read("examAccessKey", null);
    if (typeof keyRow === "string") state.examAccessKey = keyRow;

    const sebReq = read("sebRequireForStudents", null);
    if (typeof sebReq === "boolean") state.sebRequireForStudents = sebReq;
    const sebKeys = read("sebAllowedBrowserExamKeys", null);
    if (Array.isArray(sebKeys)) state.sebAllowedBrowserExamKeys = sebKeys;

    const essayWork = read("essayWork", null);
    if (essayWork && typeof essayWork === "object" && essayWork.byBlindId && typeof essayWork.byBlindId === "object") {
      state.essayWork = essayWork;
    }

    const sched = read("scheduledExams", null);
    if (Array.isArray(sched)) state.scheduledExams = sched;
    const notif = read("studentNotifications", null);
    if (Array.isArray(notif)) state.studentNotifications = notif;

    const audits = d.prepare("SELECT id, at, action, detail, actor_role, actor_id FROM audit_log ORDER BY at ASC LIMIT 500").all();
    if (audits.length) {
      state.auditLog = audits.map((r) => ({
        id: r.id,
        at: r.at,
        action: r.action,
        detail: r.detail || "",
        actorRole: r.actor_role,
        actorId: r.actor_id,
      }));
    }

    const ints = d
      .prepare("SELECT id, at, room_id, student_id, type, detail FROM integrity_log ORDER BY at ASC LIMIT 500")
      .all();
    if (ints.length) {
      state.integrityEvents = ints.map((r) => ({
        id: r.id,
        at: r.at,
        roomId: r.room_id,
        studentId: r.student_id,
        type: r.type,
        detail: r.detail || "",
      }));
    }

    logger.logInfo("SQLite hydrate complete", { db: DB_PATH, students: state.students.length });
  } catch (e) {
    logger.logError("SQLite hydrate failed (starting with defaults)", e);
  }
}

function persistCoreNow(state) {
  if (!db) openDb();
  const d = db;
  const upsert = d.prepare("INSERT OR REPLACE INTO kv (k, v, updated_at) VALUES (?, ?, ?)");
  const t = isoNow();
  d.exec("BEGIN IMMEDIATE;");
  try {
    upsert.run("students", JSON.stringify(state.students), t);
    upsert.run("teachers", JSON.stringify(state.teachers), t);
    upsert.run("uploadedQuestionModels", JSON.stringify(state.uploadedQuestionModels), t);
    upsert.run("examSession", JSON.stringify(state.examSession), t);
    upsert.run("answers", JSON.stringify(state.answers), t);
    upsert.run("studentHonestyAck", JSON.stringify(state.studentHonestyAck), t);
    upsert.run("studentPaperSets", JSON.stringify(state.studentPaperSets), t);
    upsert.run("studentPaperCursor", JSON.stringify(state.studentPaperCursor), t);
    upsert.run("studentEntryStatus", JSON.stringify(state.studentEntryStatus), t);
    upsert.run("studentExamRevoked", JSON.stringify(state.studentExamRevoked || {}), t);
    upsert.run("roomPaperReleased", JSON.stringify(state.roomPaperReleased), t);
    upsert.run("incidents", JSON.stringify(state.incidents), t);
    upsert.run("examAccessKey", JSON.stringify(state.examAccessKey || ""), t);
    upsert.run("sebRequireForStudents", JSON.stringify(!!state.sebRequireForStudents), t);
    upsert.run("sebAllowedBrowserExamKeys", JSON.stringify(state.sebAllowedBrowserExamKeys || []), t);
    upsert.run("essayWork", JSON.stringify(state.essayWork || { byBlindId: {} }), t);
    upsert.run("scheduledExams", JSON.stringify(state.scheduledExams || []), t);
    upsert.run("studentNotifications", JSON.stringify(state.studentNotifications || []), t);
    d.exec("COMMIT;");
  } catch (e) {
    try {
      d.exec("ROLLBACK;");
    } catch {
      /* ignore */
    }
    throw e;
  }
}

function schedulePersistCore(state) {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    try {
      persistCoreNow(state);
    } catch (e) {
      logger.logError("persistCore failed", e);
    }
  }, DEBOUNCE_MS);
}

function persistCoreImmediate(state) {
  clearTimeout(persistTimer);
  try {
    persistCoreNow(state);
  } catch (e) {
    logger.logError("persistCoreImmediate failed", e);
  }
}

function insertAuditRow(entry) {
  try {
    const d = openDb();
    d.prepare("INSERT INTO audit_log (id, at, action, detail, actor_role, actor_id) VALUES (?, ?, ?, ?, ?, ?)").run(
      entry.id,
      entry.at,
      entry.action,
      entry.detail || "",
      entry.actorRole,
      entry.actorId
    );
  } catch (e) {
    logger.logError("insertAuditRow failed", e);
  }
}

function insertIntegrityRow(ev) {
  try {
    const d = openDb();
    d.prepare("INSERT INTO integrity_log (id, at, room_id, student_id, type, detail) VALUES (?, ?, ?, ?, ?, ?)").run(
      ev.id,
      ev.at,
      ev.roomId,
      ev.studentId,
      ev.type,
      ev.detail || ""
    );
  } catch (e) {
    logger.logError("insertIntegrityRow failed", e);
  }
}

module.exports = {
  openDb,
  hydrateState,
  schedulePersistCore,
  persistCoreImmediate,
  insertAuditRow,
  insertIntegrityRow,
  DB_PATH,
};

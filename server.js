/**
 * School exam demo: Excel rosters, exam builder, lobby window, extend end time only.
 * Run: npm install && npm start then open http://localhost:3780
 */

const path = require("path");
const fs = require("fs");
const http = require("http");
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const xlsx = require("xlsx");
const { Server } = require("socket.io");

const PORT = process.env.PORT || 3780;
/** Bumped when API shape changes; client checks /api/health */
const SERVER_BUILD_ID = "exam-demo-build-27";

/** Proctor may enter the live monitoring room this many minutes before scheduled exam start (policy). */
const PROCTOR_JOIN_LEAD_MINUTES = 20;

/** Machine-readable feature list for procurement / demos (also drives the admin capability panel). */
const PLATFORM_SHIPPED = [
  { id: "rosters", label: "Student & teacher rosters via Excel / CSV" },
  { id: "questions_xlsx", label: "Question papers via Excel (MCQ, true/false, fill-in, essay) + optional Subject/Grade columns" },
  { id: "exam_wizard", label: "Exam session: grade, rooms, lobby window, schedule, model selection" },
  { id: "publish", label: "Publish with proctor validation" },
  { id: "lobby_gate", label: "Lobby window & time-based access (student / proctor)" },
  { id: "live_control", label: "Live control: extend end, open lobby (testing), rooms, incidents, integrity tail" },
  { id: "proctor_desk", label: "Proctor desk: join room, private messages, live progress (no scores)" },
  { id: "student_desk", label: "Student desk: camera/mic consent, integrity policy acknowledgement, paper, timer" },
  { id: "mcq_auto", label: "Automatic MCQ scoring (per-student choice shuffle)" },
  { id: "item_analysis", label: "Item analysis (% correct per keyed question)" },
  { id: "audit_tail_sqlite", label: "Audit log tail persisted to SQLite alongside live state" },
  { id: "question_pool", label: "Optional random subset (questions per student) from the selected model" },
  { id: "socket_realtime", label: "Socket.IO: roster signals, integrity flags, state refresh" },
  { id: "webrtc_mesh", label: "Demo WebRTC: proctor & admin can open live camera tiles per room (STUN; production needs TURN)" },
  { id: "sequential_mcq", label: "Sequential MCQ: one question at a time with submit before the next item unlocks" },
  { id: "proctor_admit_release", label: "Proctor must admit each student and release the paper before questions load" },
  { id: "exam_evidence_disk", label: "Append-only exam evidence files (JSONL per student under data/exam-evidence)" },
  { id: "results_report_api", label: "Admin results report: MCQ summary plus evidence file index" },
  { id: "a11y_basics", label: "Accessibility basics: skip link, tab roles, focus-visible" },
  { id: "headers", label: "Security headers: X-Content-Type-Options, build id on API responses" },
  { id: "sqlite_persist", label: "SQLite WAL persistence for roster, exam session, answers, and audit/integrity tails" },
  { id: "exam_access_key", label: "Optional X-Exam-Access-Key header required for all student exam APIs when configured" },
  { id: "tab_switch_alert", label: "Tab visibility loss emits potential-cheating signal to proctor staff channel" },
  {
    id: "seb_browser_exam_key",
    label:
      "Optional Safe Exam Browser: require student APIs to present X-SafeExamBrowser-RequestHash matching SHA256(requestURL + BrowserExamKey) (keys from SEB Config Tool)",
  },
];

const PLATFORM_ROADMAP = [
  { id: "sso", label: "SSO / SAML / OIDC & institutional MFA" },
  { id: "lti", label: "LTI 1.3 with your LMS (Canvas, Moodle, Blackboard, …)" },
  { id: "lockdown", label: "Deep lockdown (Respondus-style) beyond SEB header checks" },
  { id: "db", label: "PostgreSQL (or other) durable state, file storage, backups" },
  { id: "video", label: "Certified live invigilation & recording pipeline" },
  { id: "essay", label: "Essay / file tasks with rubrics & second-marker workflow" },
  { id: "plagiarism", label: "Plagiarism / similarity integrations" },
  { id: "accommodations", label: "Formal accommodations (extra time, accessibility profiles)" },
  { id: "vpat", label: "WCAG 2.1 AA audit & VPAT / ACR for procurement" },
  { id: "compliance", label: "Data residency, DPA, retention policies, right-to-erasure tooling" },
  { id: "sla", label: "SLA, on-call, staging / production environments" },
];

/** Shown to students before the paper loads; version bumps reset acknowledgement. */
const INTEGRITY_POLICY = {
  version: "2026-04-1",
  title: "Academic integrity & exam rules",
  intro:
    "By continuing you agree to follow your school’s academic honesty policy. This trial records basic session events for administration.",
  bullets: [
    "Complete this attempt yourself unless an approved accommodation says otherwise.",
    "Do not share questions, answers, or screen captures outside the platform while the exam window is open.",
    "Do not use unauthorised materials, devices, or communication with others, except tools explicitly allowed for this paper.",
    "If you lose connection, return through the same login; the timer follows the scheduled end time on the server.",
    "Report technical issues to your proctor through the messaging tools provided.",
  ],
  feedbackAfterExam:
    "After the scheduled end time you may see your automatic multiple-choice score where a key is configured. Detailed answer keys may be released only after the exam closes, per school policy.",
};

/** Ready-made trial logins (POST /api/admin/seed-demo-roster with JSON body {"variant":"dmes"}) */
const DMES_TRIAL_MODEL_ID = "upload-dmes-trial";
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
});

/** @typedef {{ id: string, text: string, choices?: string[], correctIndex?: number, type?: string, maxPoints?: number, authoredByStaffId?: string, correctFill?: string }} Question */
/** @typedef {{ id: string, label: string, questions: Question[] }} QuestionModel */

/** @type {QuestionModel[]} */
const teacherModels = [
  {
    id: "m1",
    label: "Model A (teacher draft)",
    questions: [
      { id: "q1", text: "What is 12 + 8?", choices: ["18", "20", "19", "21"], correctIndex: 1 },
      { id: "q2", text: "Which planet is closest to the Sun?", choices: ["Venus", "Mercury", "Earth", "Mars"], correctIndex: 1 },
      { id: "q3", text: "Choose the correct spelling.", choices: ["Recieve", "Receive", "Receeve", "Receiv"], correctIndex: 1 },
    ],
  },
  {
    id: "m2",
    label: "Model B (teacher draft)",
    questions: [
      { id: "q1", text: "What is 7 × 6?", choices: ["36", "42", "48", "40"], correctIndex: 1 },
      { id: "q2", text: "Water boils at 100°C at sea level. This is a:", choices: ["Law", "Theory", "Hypothesis", "Opinion"], correctIndex: 0 },
      { id: "q3", text: "Capital of France?", choices: ["Lyon", "Marseille", "Paris", "Nice"], correctIndex: 2 },
    ],
  },
  {
    id: "m3",
    label: "Model C (teacher draft)",
    questions: [
      { id: "q1", text: "A triangle with a 90° angle is called:", choices: ["Acute", "Obtuse", "Right", "Equilateral"], correctIndex: 2 },
      { id: "q2", text: "Which gas do plants absorb for photosynthesis?", choices: ["Oxygen", "Nitrogen", "Carbon dioxide", "Hydrogen"], correctIndex: 2 },
      { id: "q3", text: "10% of 200 equals:", choices: ["2", "20", "200", "0.2"], correctIndex: 1 },
    ],
  },
];

function shuffle(arr, seedStr) {
  const a = [...arr];
  let h = 0;
  for (let i = 0; i < seedStr.length; i++) h = (h * 31 + seedStr.charCodeAt(i)) >>> 0;
  const rnd = () => {
    h = (h * 1664525 + 1013904223) >>> 0;
    return h / 0xffffffff;
  };
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function normHeader(s) {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function normGrade(s) {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function getCell(row, names) {
  const keys = Object.keys(row);
  for (const want of names) {
    const w = normHeader(want);
    for (const k of keys) {
      if (normHeader(k) === w) return row[k];
    }
  }
  for (const want of names) {
    const w = normHeader(want).replace(/ /g, "");
    for (const k of keys) {
      if (normHeader(k).replace(/ /g, "") === w) return row[k];
    }
  }
  return "";
}

function readSheetRowsFromBuffer(buf, filename) {
  const name = String(filename || "").toLowerCase();
  let wb;
  if (name.endsWith(".csv")) {
    let text = buf.toString("utf8");
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    wb = xlsx.read(text, { type: "string" });
  } else {
    wb = xlsx.read(buf, { type: "buffer" });
  }
  const sheet = wb.Sheets[wb.SheetNames[0]];
  return xlsx.utils.sheet_to_json(sheet, { defval: "" });
}

function parseStudentsSheet(buf, filename) {
  const rows = readSheetRowsFromBuffer(buf, filename);
  const out = [];
  const seen = new Set();
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const studentId = String(getCell(row, ["Student ID", "student id", "StudentId", "ID"])).trim();
    const fullName = String(getCell(row, ["Full Name", "Full name", "Name", "Student Name"])).trim();
    const email = String(getCell(row, ["Email", "E-mail", "School Email"])).trim();
    const stage = String(getCell(row, ["Academic Stage", "Stage", "Educational Stage", "Level"])).trim();
    const grade = String(getCell(row, ["Grade", "Class", "Form"])).trim();
    if (!studentId) continue;
    if (seen.has(studentId)) continue;
    seen.add(studentId);
    out.push({ studentId, fullName, email, stage, grade });
  }
  return out;
}

function parseTeachersSheet(buf, filename) {
  const rows = readSheetRowsFromBuffer(buf, filename);
  const out = [];
  const seen = new Set();
  for (const row of rows) {
    const staffId = String(getCell(row, ["Staff ID", "staff id", "Teacher ID", "Employee ID"])).trim();
    const fullName = String(getCell(row, ["Full Name", "Full name", "Name"])).trim();
    const email = String(getCell(row, ["Email", "E-mail", "School Email"])).trim();
    const supervisedGrade = String(getCell(row, ["Supervised Grade", "Grade", "Class", "Homeroom Grade"])).trim();
    if (!staffId) continue;
    if (seen.has(staffId)) continue;
    seen.add(staffId);
    out.push({ staffId, fullName, email, supervisedGrade });
  }
  return out;
}

/**
 * Maps Correct column (A–D, 1–4, or matching option text) to an index in the filtered choices array.
 * @param {Record<string, unknown>} row
 * @param {string[]} choices non-empty options in A→D order
 */
function parseCorrectChoiceIndex(row, choices) {
  const a = String(getCell(row, ["Choice A", "Option A", "A"])).trim();
  const b = String(getCell(row, ["Choice B", "Option B", "B"])).trim();
  const c = String(getCell(row, ["Choice C", "Option C", "C"])).trim();
  const d = String(getCell(row, ["Choice D", "Option D", "D"])).trim();
  const letters = ["A", "B", "C", "D"];
  const texts = [a, b, c, d];
  /** @type {{ letter: string; text: string }[]} */
  const filtered = [];
  for (let i = 0; i < 4; i++) {
    if (texts[i].length) filtered.push({ letter: letters[i], text: texts[i] });
  }
  if (!filtered.length || choices.length !== filtered.length) return undefined;
  const raw = String(getCell(row, ["Correct", "Correct answer", "Answer key", "Key", "Answer"])).trim();
  if (!raw) return undefined;
  const up = raw.toUpperCase();
  if (/^[ABCD]$/.test(up)) {
    const i = filtered.findIndex((x) => x.letter === up);
    return i >= 0 ? i : undefined;
  }
  const n = parseInt(raw, 10);
  if (!Number.isNaN(n) && n >= 1 && n <= 4) {
    const want = letters[n - 1];
    const i = filtered.findIndex((x) => x.letter === want);
    return i >= 0 ? i : undefined;
  }
  const low = raw.toLowerCase();
  const i = filtered.findIndex((x) => x.text.toLowerCase() === low);
  return i >= 0 ? i : undefined;
}

function parsePointsCell(row) {
  const raw = String(getCell(row, ["Points", "Marks", "Score", "Point", "الدرجة"])).trim();
  if (!raw) return null;
  const n = parseFloat(raw.replace(",", "."));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.min(100, n);
}

function normalizeQuestionType(raw) {
  const s = String(raw || "").trim().toLowerCase();
  if (!s) return "";
  if (/essay|written|مقال/.test(s)) return "essay";
  const compact = s.replace(/\s+/g, "");
  if (/true|false|^tf$|^t\/f$|صحيح|خطأ|صح\/خطأ/.test(compact) || /^tf$/i.test(s.trim())) return "tf";
  if (/fill|blank|cloze|gap|فراغ|اكمل/.test(s)) return "fill";
  if (/mcq|multiple|choice|اختيار|multi/.test(s)) return "mcq";
  return "";
}

function normalizeFillAnswerForCompare(s) {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function fillAnswerMatches(studentAnswer, correctSpec) {
  const st = normalizeFillAnswerForCompare(studentAnswer);
  const parts = String(correctSpec || "")
    .split("|")
    .map((p) => normalizeFillAnswerForCompare(p))
    .filter(Boolean);
  if (!parts.length) return false;
  return parts.some((p) => st === p);
}

/**
 * @returns {{ questions: Question[], subject: string, modelGrade: string }}
 */
function parseQuestionModelSheet(buf, filename) {
  const rows = readSheetRowsFromBuffer(buf, filename);
  /** @type {Question[]} */
  const questions = [];
  let subject = "";
  let modelGrade = "";
  let auto = 0;
  for (const row of rows) {
    const subjHint = String(getCell(row, ["Subject", "Course", "Material", "المادة"])).trim();
    const gradeHint = String(getCell(row, ["Grade", "Level", "Class", "Stage", "الصف", "المرحلة"])).trim();
    if (subjHint && !subject) subject = subjHint.slice(0, 120);
    if (gradeHint && !modelGrade) modelGrade = gradeHint.slice(0, 80);

    const qtype = normalizeQuestionType(getCell(row, ["Question Type", "Type", "Item Type", "نوع السؤال"]));
    const qid = String(getCell(row, ["Question ID", "QuestionId", "ID"])).trim();
    const text = String(getCell(row, ["Question Text", "Question", "Stem", "Text", "Prompt"])).trim();
    const ptsRaw = parsePointsCell(row);
    const a = String(getCell(row, ["Choice A", "Option A", "A"])).trim();
    const b = String(getCell(row, ["Choice B", "Option B", "B"])).trim();
    const c = String(getCell(row, ["Choice C", "Option C", "C"])).trim();
    const d = String(getCell(row, ["Choice D", "Option D", "D"])).trim();
    const choices = [a, b, c, d].filter((x) => x.length > 0);

    if (!text) continue;

    if (qtype === "essay") {
      const id = qid || `q${++auto}`;
      const mp = ptsRaw != null ? Math.min(100, Math.max(1, Math.floor(ptsRaw))) : 10;
      questions.push({ id, text, type: "essay", choices: [], maxPoints: mp });
      continue;
    }

    if (qtype === "fill") {
      const key = String(getCell(row, ["Correct", "Correct answer", "Answer key", "Key", "Answer", "الإجابة"])).trim();
      if (!key) continue;
      const id = qid || `q${++auto}`;
      const mp = ptsRaw != null ? Math.min(100, Math.max(1, Math.floor(ptsRaw))) : 1;
      questions.push({ id, text, type: "fill", choices: [], correctFill: key, maxPoints: mp });
      continue;
    }

    if (qtype === "tf") {
      const id = qid || `q${++auto}`;
      const correctRaw = String(getCell(row, ["Correct", "Correct answer", "Answer key", "Key", "Answer"])).trim();
      let correctIndex = 0;
      if (/^f(alse)?$/i.test(correctRaw) || /^0$/i.test(correctRaw) || /^خطأ/.test(correctRaw)) correctIndex = 1;
      else if (/^t(rue)?$/i.test(correctRaw) || /^1$/i.test(correctRaw) || /^صح/.test(correctRaw)) correctIndex = 0;
      else continue;
      const mp = ptsRaw != null ? Math.min(100, Math.max(1, Math.floor(ptsRaw))) : 1;
      questions.push({ id, text, type: "tf", choices: ["True", "False"], correctIndex, maxPoints: mp });
      continue;
    }

    if (qtype === "mcq" || (!qtype && choices.length >= 2)) {
      if (choices.length < 2) continue;
      const id = qid || `q${++auto}`;
      const correctIndex = parseCorrectChoiceIndex(row, choices);
      /** @type {Question} */
      const q = { id, text, type: "mcq", choices, maxPoints: ptsRaw != null ? Math.min(100, Math.max(1, Math.floor(ptsRaw))) : 1 };
      if (typeof correctIndex === "number") q.correctIndex = correctIndex;
      questions.push(q);
    }
  }
  return { questions, subject, modelGrade };
}

function syncExamTargetGradeFromStudents() {
  const dg = distinctGradesFromStudents();
  if (dg.length) {
    if (!dg.some((g) => normGrade(g) === normGrade(state.examSession.targetGrade))) {
      state.examSession.targetGrade = dg[0];
    }
  }
}

function ensureProctorsMeetRequirements() {
  const ex = state.examSession;
  const pool = teachersForGrade(state.teachers, ex.targetGrade);
  const poolIds = pool.map((t) => t.staffId);
  for (const room of ex.rooms) {
    const need = Math.max(0, Number(room.proctorsRequired) || 0);
    let cur = [...(room.proctorStaffIds || [])].filter((id) => poolIds.includes(id));
    let p = 0;
    while (poolIds.length > 0 && cur.length < need) {
      cur.push(poolIds[p % poolIds.length]);
      p++;
    }
    room.proctorStaffIds = cur;
  }
}

function publishProctorValidationFails() {
  const ex = state.examSession;
  const pool = teachersForGrade(state.teachers, ex.targetGrade);
  const poolIds = pool.map((t) => t.staffId);
  const bad = [];
  for (const r of ex.rooms) {
    const need = Math.max(0, Number(r.proctorsRequired) || 0);
    if (need > 0 && r.proctorStaffIds.length < need) {
      bad.push({
        id: r.id,
        label: r.label,
        required: need,
        have: r.proctorStaffIds.length,
      });
    }
  }
  if (!poolIds.length && ex.rooms.some((r) => (Number(r.proctorsRequired) || 0) > 0)) {
    return { ok: false, error: "No teachers in the roster match this exam grade (Supervised Grade column).", rooms: bad };
  }
  if (bad.length) {
    return {
      ok: false,
      error: "Some rooms still need more proctors than the roster can supply. Lower Proctors required or add teachers for this grade.",
      rooms: bad,
    };
  }
  return { ok: true };
}

function splitStudentsIntoRooms(studentIds, roomCount) {
  const rooms = [];
  const n = studentIds.length;
  if (roomCount < 1) return rooms;
  const base = Math.floor(n / roomCount);
  let extra = n % roomCount;
  let idx = 0;
  for (let r = 0; r < roomCount; r++) {
    const size = base + (extra > 0 ? 1 : 0);
    if (extra > 0) extra--;
    const slice = studentIds.slice(idx, idx + size);
    idx += size;
    rooms.push({
      id: `room-${r + 1}`,
      label: `Exam room ${r + 1}`,
      studentIds: slice,
      proctorStaffIds: [],
      proctorsRequired: 1,
    });
  }
  return rooms;
}

/** Minimum number of rooms so each has at most `maxPerRoom` students (balanced split like splitStudentsIntoRooms). */
function splitStudentsIntoRoomsWithMaxCap(studentIds, maxPerRoom) {
  const n = studentIds.length;
  if (n === 0 || maxPerRoom < 1) return [];
  const roomCount = Math.ceil(n / maxPerRoom);
  return splitStudentsIntoRooms(studentIds, roomCount);
}

function teachersForGrade(teachers, targetGrade) {
  const g = normGrade(targetGrade);
  return teachers.filter((t) => normGrade(t.supervisedGrade) === g || normGrade(t.supervisedGrade).includes(g));
}

function assignProctorsRandom(rooms, pool) {
  const ids = pool.map((t) => t.staffId);
  for (const room of rooms) {
    room.proctorStaffIds = [];
    const need = Math.max(0, Math.min(20, Number(room.proctorsRequired) || 0));
    if (!ids.length || !need) continue;
    const shuffled = shuffle([...ids], room.id + String(need) + Date.now());
    for (let k = 0; k < need; k++) room.proctorStaffIds.push(shuffled[k % shuffled.length]);
  }
}

const state = {
  students: [],
  teachers: [],
  /** @type {{ id: string, label: string, questions: Question[], uploadedAt: string, uploadedByStaffId?: string }[]} */
  uploadedQuestionModels: [],
  /** @type {{ targetGrade: string, subject?: string, roomCount: number, lobbyOpensMinutesBefore: number, examStartAt: string, examEndAt: string, selectedModelId: string | null, paperDrawCount: number | null, rooms: { id: string, label: string, studentIds: string[], proctorStaffIds: string[], proctorsRequired: number }[], published: boolean, proctorMaxCameraTilesVisible?: number }} */
  examSession: {
    targetGrade: "Grade 4",
    subject: "",
    roomCount: 5,
    lobbyOpensMinutesBefore: 10,
    examStartAt: new Date(Date.now() + 86400000).toISOString(),
    examEndAt: new Date(Date.now() + 86400000 + 45 * 60000).toISOString(),
    selectedModelId: "m1",
    paperDrawCount: null,
    rooms: [],
    published: false,
    /** How many camera tiles fit in the proctor viewport before scrolling (admin 9–12 later). Default 12 = policy maximum. */
    proctorMaxCameraTilesVisible: 12,
  },
  /** @type {{ id: string, targetGrade: string, subject: string, modelId: string, examStartAt: string, examEndAt: string, lobbyOpensMinutesBefore: number, maxStudentsPerRoom: number, published: boolean, cancelled: boolean, createdAt: string, rooms: object[], notificationBody?: string }[]} */
  scheduledExams: [],
  /** @type {{ id: string, at: string, targetGrade: string, subject: string, examStartAt: string, body: string }[]} */
  studentNotifications: [],
  /** @type {Record<string, Record<string, number>>} */
  answers: {},
  /** @type {{ id: string, at: string, action: string, detail: string, actorRole: string | null, actorId: string | null }[]} */
  auditLog: [],
  /** @type {Record<string, string>} studentId -> ISO time when honesty policy was accepted */
  studentHonestyAck: {},
  /** @type {Record<string, string[]>} studentId -> question ids issued on last paper load */
  studentPaperSets: {},
  /** @type {Record<string, number>} studentId -> next question index (sequential delivery) */
  studentPaperCursor: {},
  integrityEvents: [],
  /** @type {{ id: string, at: string, roomId: string, staffId: string, message: string, note?: string }[]} */
  incidents: [],
  /** @type {Record<string, string>} studentId -> none | pending | admitted */
  studentEntryStatus: {},
  /** @type {Record<string, { at: string, reason: string }>} studentId -> revoked (cannot continue this exam) */
  studentExamRevoked: {},
  /** @type {Record<string, boolean>} roomId -> paper released to students */
  roomPaperReleased: {},
  /** When non-empty, student APIs require header X-Exam-Access-Key to match (set via admin). */
  examAccessKey: "",
  /** When true, student gate + student APIs require valid Safe Exam Browser Browser Exam Key header. */
  sebRequireForStudents: false,
  /** Browser Exam Key strings from SEB Config Tool (Exam tab); one per line / array entry; multiple SEB versions supported. */
  sebAllowedBrowserExamKeys: [],
  /**
   * Essay submissions keyed by blind id (teacher sees no student name).
   * @type {{ byBlindId: Record<string, { studentId: string, questionId: string, modelId: string, text: string, submittedAt: string, maxPoints: number, authorStaffId: string | null, score?: number, gradedAt?: string }> }}
   */
  essayWork: { byBlindId: {} },
};

const logger = require("./lib/logger");
const sqliteStore = require("./lib/sqlite-store");
const seb = require("./lib/seb");
try {
  sqliteStore.hydrateState(state);
} catch (e) {
  logger.logError("Initial SQLite hydrate threw", e);
}
{
  const ex = state.examSession;
  const v = ex.proctorMaxCameraTilesVisible;
  if (typeof v !== "number" || !Number.isFinite(v)) ex.proctorMaxCameraTilesVisible = 12;
  else ex.proctorMaxCameraTilesVisible = Math.min(12, Math.max(9, Math.floor(v)));
  if (typeof ex.subject !== "string") ex.subject = "";
}
if (!Array.isArray(state.scheduledExams)) state.scheduledExams = [];
if (!Array.isArray(state.studentNotifications)) state.studentNotifications = [];
ensureRoomsBuilt();

const MAX_AUDIT = 500;

/**
 * @param {string} action
 * @param {string} [detail]
 * @param {{ actorRole?: string | null, actorId?: string | null }} [meta]
 */
function appendAudit(action, detail = "", meta = {}) {
  const entry = {
    id: `aud-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    at: new Date().toISOString(),
    action,
    detail: String(detail || "").slice(0, 480),
    actorRole: meta.actorRole != null ? String(meta.actorRole) : null,
    actorId: meta.actorId != null ? String(meta.actorId) : null,
  };
  state.auditLog.push(entry);
  while (state.auditLog.length > MAX_AUDIT) state.auditLog.shift();
  try {
    sqliteStore.insertAuditRow(entry);
  } catch (e) {
    logger.logError("appendAudit sqlite", e);
  }
}

function clearIssuedPapers() {
  state.studentPaperSets = {};
  state.studentPaperCursor = {};
  state.studentExamRevoked = {};
}

function resetStudentExamRuntimeFlags() {
  state.studentHonestyAck = {};
  clearIssuedPapers();
}

function getModel(id) {
  return state.uploadedQuestionModels.find((m) => m.id === id) || teacherModels.find((m) => m.id === id) || null;
}

const MAX_TEACHER_QUESTION_MODELS = 3;

function countTeacherUploadedModels(staffId) {
  return state.uploadedQuestionModels.filter((m) => m.uploadedByStaffId === staffId).length;
}

function isEssayQuestion(q) {
  if (!q) return false;
  if (q.type === "fill" || q.type === "tf" || q.type === "mcq") return false;
  if (q.type === "essay") return true;
  return !Array.isArray(q.choices) || q.choices.length < 2;
}

function newEssayBlindId() {
  return `anon-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function findEssaySubmissionForStudent(studentId, questionId) {
  const map = state.essayWork?.byBlindId || {};
  for (const row of Object.values(map)) {
    if (row && row.studentId === studentId && row.questionId === questionId) return row;
  }
  return null;
}

/** Question ids to score for this student (subset after pool draw, or full model). */
function servedQuestionIdsForScoring(studentId) {
  const modelId = state.examSession.selectedModelId;
  const model = modelId ? getModel(modelId) : null;
  if (!model) return [];
  const ids = state.studentPaperSets[studentId];
  if (ids && ids.length) return ids;
  return model.questions.map((q) => q.id);
}

/**
 * Auto-score stored MCQ answers. Choices are shuffled per student on the paper; answers are stored as display indices.
 * Essay items are excluded from MCQ counts; optional admin-only essay totals.
 * @param {string} studentId
 * @param {{ includeAdminEssay?: boolean }} [opts]
 */
function computeMcqScoreForStudent(studentId, opts = {}) {
  const emptyEssay = opts.includeAdminEssay ? { essayGradedPoints: 0, essayGradedMax: 0, essayPending: 0 } : {};
  const modelId = state.examSession.selectedModelId;
  const model = modelId ? getModel(modelId) : null;
  if (!model || !model.questions.length) {
    return {
      modelId: modelId || "",
      modelLabel: "",
      questionsWithKey: 0,
      correctCount: 0,
      answeredWithKey: 0,
      percent: null,
      perQuestion: [],
      ...emptyEssay,
    };
  }
  const ans = state.answers[studentId] || {};
  let correctCount = 0;
  let questionsWithKey = 0;
  let answeredWithKey = 0;
  /** @type {{ questionId: string, status: string }[]} */
  const perQuestion = [];
  const idOrder = servedQuestionIdsForScoring(studentId);
  for (const qid of idOrder) {
    const q = model.questions.find((x) => x.id === qid);
    if (!q) continue;
    if (isEssayQuestion(q)) continue;
    if (q.type === "fill") {
      if (!q.correctFill) {
        perQuestion.push({ questionId: q.id, status: "no_key" });
        continue;
      }
      questionsWithKey++;
      const stored = ans[q.id];
      if (typeof stored !== "string" || !String(stored).trim()) {
        perQuestion.push({ questionId: q.id, status: "unanswered" });
        continue;
      }
      answeredWithKey++;
      const ok = fillAnswerMatches(stored, q.correctFill);
      if (ok) correctCount++;
      perQuestion.push({ questionId: q.id, status: ok ? "correct" : "wrong" });
      continue;
    }
    if (typeof q.correctIndex !== "number") {
      perQuestion.push({ questionId: q.id, status: "no_key" });
      continue;
    }
    questionsWithKey++;
    const displayIdx = ans[q.id];
    if (typeof displayIdx !== "number") {
      perQuestion.push({ questionId: q.id, status: "unanswered" });
      continue;
    }
    answeredWithKey++;
    const perm = shuffle(
      q.choices.map((_, i) => i),
      studentId + q.id
    );
    const original = perm[displayIdx];
    const ok = original === q.correctIndex;
    if (ok) correctCount++;
    perQuestion.push({ questionId: q.id, status: ok ? "correct" : "wrong" });
  }
  const percent = questionsWithKey > 0 ? Math.round((correctCount / questionsWithKey) * 1000) / 10 : null;
  const base = {
    modelId: model.id,
    modelLabel: model.label,
    questionsWithKey,
    correctCount,
    answeredWithKey,
    percent,
    perQuestion,
  };
  if (!opts.includeAdminEssay) return base;
  let essayGradedPoints = 0;
  let essayGradedMax = 0;
  let essayPending = 0;
  for (const qid of idOrder) {
    const q = model.questions.find((x) => x.id === qid);
    if (!q || !isEssayQuestion(q)) continue;
    const maxP = Math.min(100, Math.max(1, Math.floor(Number(q.maxPoints) || 10)));
    const sub = findEssaySubmissionForStudent(studentId, q.id);
    if (sub && typeof sub.score === "number") {
      essayGradedPoints += sub.score;
      essayGradedMax += maxP;
    } else if (ans[q.id] === -1) {
      essayPending++;
    }
  }
  return { ...base, essayGradedPoints, essayGradedMax, essayPending };
}

/** Simple item analysis: share correct among students in target grade who saw the question. */
function computeItemAnalysis() {
  const model = state.examSession.selectedModelId ? getModel(state.examSession.selectedModelId) : null;
  if (!model) return [];
  const gradeStudents = state.students.filter((s) => normGrade(s.grade) === normGrade(state.examSession.targetGrade));
  return model.questions.map((q) => {
    if (isEssayQuestion(q)) {
      return { questionId: q.id, text: q.text, keyed: false, attempts: 0, correct: 0, pCorrect: null, kind: "essay" };
    }
    if (q.type === "fill" && q.correctFill) {
      let attempts = 0;
      let correct = 0;
      for (const s of gradeStudents) {
        const ids = state.studentPaperSets[s.studentId];
        if (ids && ids.length > 0 && !ids.includes(q.id)) continue;
        const stAns = state.answers[s.studentId]?.[q.id];
        if (typeof stAns !== "string" || !stAns.trim()) continue;
        attempts++;
        if (fillAnswerMatches(stAns, q.correctFill)) correct++;
      }
      const pCorrect = attempts > 0 ? Math.round((correct / attempts) * 1000) / 10 : null;
      return {
        questionId: q.id,
        text: q.text.slice(0, 120),
        keyed: true,
        kind: "fill",
        attempts,
        correct,
        pCorrect,
      };
    }
    if (typeof q.correctIndex !== "number") {
      return { questionId: q.id, text: q.text, keyed: false, attempts: 0, correct: 0, pCorrect: null };
    }
    let attempts = 0;
    let correct = 0;
    for (const s of gradeStudents) {
      const ids = state.studentPaperSets[s.studentId];
      if (ids && ids.length > 0 && !ids.includes(q.id)) continue;
      const displayIdx = state.answers[s.studentId]?.[q.id];
      if (typeof displayIdx !== "number" || displayIdx === -1) continue;
      attempts++;
      const perm = shuffle(
        q.choices.map((_, i) => i),
        s.studentId + q.id
      );
      if (perm[displayIdx] === q.correctIndex) correct++;
    }
    const pCorrect = attempts > 0 ? Math.round((correct / attempts) * 1000) / 10 : null;
    return {
      questionId: q.id,
      text: q.text.slice(0, 120),
      keyed: true,
      attempts,
      correct,
      pCorrect,
    };
  });
}

/**
 * @param {Question[]} questions
 * @param {string} labelCore short name without prefix
 * @param {{ uploadedByStaffId?: string | null, autoSelect?: boolean }} [opts]
 */
function registerUploadedQuestionModel(questions, labelCore, opts = {}) {
  const uploadedByStaffId = opts.uploadedByStaffId || null;
  const autoSelect = opts.autoSelect !== false;
  const id = `upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const core = String(labelCore || "paper").trim().slice(0, 120);
  const label = (uploadedByStaffId ? `Teacher upload: ${core}` : `Uploaded: ${core}`).slice(0, 180);
  /** @type {{ id: string, label: string, questions: Question[], uploadedAt: string, uploadedByStaffId?: string, subject?: string, modelGrade?: string }} */
  const rec = {
    id,
    label,
    questions,
    uploadedAt: new Date().toISOString(),
    ...(uploadedByStaffId ? { uploadedByStaffId } : {}),
  };
  const sub = String(opts.subject || "").trim().slice(0, 120);
  const mg = String(opts.modelGrade || "").trim().slice(0, 80);
  if (sub) rec.subject = sub;
  if (mg) rec.modelGrade = mg;
  state.uploadedQuestionModels.push(rec);
  if (autoSelect) state.examSession.selectedModelId = id;
  return id;
}

function demoTenMcqQuestions() {
  return [
    { id: "q1", text: "What is 15 + 7?", choices: ["20", "22", "21", "23"], correctIndex: 1 },
    { id: "q2", text: "Which word is spelled correctly?", choices: ["Accomodate", "Accommodate", "Acommodate", "Acomodate"], correctIndex: 1 },
    { id: "q3", text: "Water at sea level boils at:", choices: ["90°C", "100°C", "110°C", "120°C"], correctIndex: 1 },
    { id: "q4", text: "How many sides does a triangle have?", choices: ["2", "3", "4", "5"], correctIndex: 1 },
    { id: "q5", text: "Which planet is known as the Red Planet?", choices: ["Venus", "Mars", "Jupiter", "Saturn"], correctIndex: 1 },
    { id: "q6", text: "What is the square root of 64?", choices: ["6", "7", "8", "9"], correctIndex: 2 },
    { id: "q7", text: "Which gas do plants absorb from the air for photosynthesis?", choices: ["Oxygen", "Nitrogen", "Carbon dioxide", "Hydrogen"], correctIndex: 2 },
    { id: "q8", text: "A dozen equals:", choices: ["10", "11", "12", "13"], correctIndex: 2 },
    { id: "q9", text: "Which ocean is the largest?", choices: ["Atlantic", "Indian", "Arctic", "Pacific"], correctIndex: 3 },
    { id: "q10", text: "How many minutes are in one hour?", choices: ["30", "45", "60", "90"], correctIndex: 2 },
  ];
}

const DMES_TRIAL_EXAM_ACCESS_KEY = "12345";

/**
 * @param {number} [studentCount] How many roster students (1–12). IDs: std1 … stdN.
 */
function runSeedDmesTrialScenario(studentCount) {
  const n = Math.min(12, Math.max(1, Math.floor(Number(studentCount)) || 12));
  const students = [];
  for (let i = 1; i <= n; i++) {
    const sid = `std${i}`;
    students.push({
      studentId: sid,
      fullName: sid,
      email: `std${i}@demo.school`,
      stage: "Secondary",
      grade: "Grade 10",
    });
  }
  const teachers = [
    {
      staffId: "teacher-1",
      fullName: "teacher-1",
      email: "teacher-1@demo.school",
      supervisedGrade: "Grade 10",
    },
    {
      staffId: "teacher-2",
      fullName: "teacher-2",
      email: "teacher-2@demo.school",
      supervisedGrade: "Grade 10",
    },
  ];
  state.answers = {};
  resetStudentExamRuntimeFlags();
  state.incidents = [];
  state.integrityEvents = [];
  state.students = students;
  state.teachers = teachers;
  state.uploadedQuestionModels = state.uploadedQuestionModels.filter((m) => m.id !== DMES_TRIAL_MODEL_ID);
  state.uploadedQuestionModels.push({
    id: DMES_TRIAL_MODEL_ID,
    label: "Trial paper (10 MCQ)",
    questions: demoTenMcqQuestions(),
    uploadedAt: new Date().toISOString(),
    uploadedByStaffId: teachers[0].staffId,
  });
  const ex = state.examSession;
  const now = Date.now();
  ex.targetGrade = "Grade 10";
  ex.roomCount = 1;
  ex.lobbyOpensMinutesBefore = 120;
  /* Short schedule so trial runs can reach scheduled end (MCQ auto-result unlock) in a few minutes */
  ex.examStartAt = new Date(now + 2 * 60000).toISOString();
  ex.examEndAt = new Date(now + 10 * 60000).toISOString();
  ex.selectedModelId = DMES_TRIAL_MODEL_ID;
  ex.paperDrawCount = null;
  ex.rooms = [];
  ensureRoomsBuilt();
  for (const r of ex.rooms) {
    r.proctorsRequired = 2;
    r.proctorStaffIds = [teachers[0].staffId, teachers[1].staffId];
  }
  ex.published = true;
  ex.proctorMaxCameraTilesVisible = 12;
  state.examAccessKey = DMES_TRIAL_EXAM_ACCESS_KEY;
  resetExamAdmissionState();
  const primary = students[0];
  const primaryT = teachers[0];
  return {
    dmesStudentCount: n,
    trialExamAccessKey: DMES_TRIAL_EXAM_ACCESS_KEY,
    students: students.map((s) => ({ role: "student", userId: s.studentId, displayName: s.fullName })),
    teachers: teachers.map((t) => ({ role: "proctor", userId: t.staffId, displayName: t.fullName })),
    student: { role: "student", userId: primary.studentId, displayName: primary.fullName },
    teacher: { role: "proctor", userId: primaryT.staffId, displayName: primaryT.fullName },
    admin: { role: "admin", userId: "admin", displayName: "Administration" },
    grade: primary.grade,
    note: `${n} student(s) (std1 … std${n}) in one room. teacher-1 and teacher-2 are proctors (Admit + Release question paper required before questions appear). Each student logs in as std# on the welcome screen and must enter exam access key ${DMES_TRIAL_EXAM_ACCESS_KEY} (same for all). One device per student id for live camera.`,
  };
}

const TRIO_DEMO_MODEL_ID = "upload-trio-demo";

function runSeedTrioScenario() {
  state.examAccessKey = "";
  const students = [
    {
      studentId: "DEMO-S1",
      fullName: "Demo Student One",
      email: "demo.s1@school.demo",
      stage: "Secondary",
      grade: "Grade 10",
    },
    {
      studentId: "DEMO-S2",
      fullName: "Demo Student Two",
      email: "demo.s2@school.demo",
      stage: "Secondary",
      grade: "Grade 10",
    },
    {
      studentId: "DEMO-S3",
      fullName: "Demo Student Three",
      email: "demo.s3@school.demo",
      stage: "Secondary",
      grade: "Grade 10",
    },
  ];
  const teachers = [
    { staffId: "DEMO-T1", fullName: "Demo Teacher One", email: "demo.t1@school.demo", supervisedGrade: "Grade 10" },
    { staffId: "DEMO-T2", fullName: "Demo Teacher Two", email: "demo.t2@school.demo", supervisedGrade: "Grade 10" },
    { staffId: "DEMO-T3", fullName: "Demo Teacher Three", email: "demo.t3@school.demo", supervisedGrade: "Grade 10" },
  ];
  state.answers = {};
  resetStudentExamRuntimeFlags();
  state.incidents = [];
  state.integrityEvents = [];
  state.students = students;
  state.teachers = teachers;
  state.uploadedQuestionModels = state.uploadedQuestionModels.filter((m) => m.id !== TRIO_DEMO_MODEL_ID);
  state.uploadedQuestionModels.push({
    id: TRIO_DEMO_MODEL_ID,
    label: "Trio demo paper (10 MCQ)",
    questions: demoTenMcqQuestions(),
    uploadedAt: new Date().toISOString(),
    uploadedByStaffId: teachers[0].staffId,
  });
  const ex = state.examSession;
  const now = Date.now();
  ex.targetGrade = "Grade 10";
  ex.roomCount = 1;
  ex.lobbyOpensMinutesBefore = 120;
  ex.examStartAt = new Date(now + 2 * 60000).toISOString();
  ex.examEndAt = new Date(now + 10 * 60000).toISOString();
  ex.selectedModelId = TRIO_DEMO_MODEL_ID;
  ex.paperDrawCount = null;
  ex.rooms = [];
  ensureRoomsBuilt();
  for (const r of ex.rooms) {
    r.proctorsRequired = 3;
    r.proctorStaffIds = teachers.map((t) => t.staffId);
  }
  ex.published = true;
  resetExamAdmissionState();
  return {
    students: students.map((s) => ({ role: "student", userId: s.studentId, displayName: s.fullName })),
    teachers: teachers.map((t) => ({ role: "proctor", userId: t.staffId, displayName: t.fullName })),
    admin: { role: "admin", userId: "admin", displayName: "Administration" },
    grade: "Grade 10",
    note: "Three students, three proctors, one room. Use Live control → Observe to open the room command center in a new tab.",
  };
}

function studentById(id) {
  return state.students.find((s) => s.studentId === id);
}

function teacherById(id) {
  return state.teachers.find((t) => t.staffId === id);
}

function ensureRoomsBuilt() {
  const ex = state.examSession;
  if (ex.rooms.length) return;
  const inGrade = state.students.filter((s) => normGrade(s.grade) === normGrade(ex.targetGrade)).map((s) => s.studentId);
  ex.rooms = splitStudentsIntoRooms(inGrade, ex.roomCount || 1);
}

function roomForStudent(studentId) {
  ensureRoomsBuilt();
  return state.examSession.rooms.find((r) => r.studentIds.includes(studentId)) || null;
}

function roomForStaff(staffId) {
  ensureRoomsBuilt();
  return state.examSession.rooms.find((r) => r.proctorStaffIds.includes(staffId)) || null;
}

function roomEntityById(roomId) {
  ensureRoomsBuilt();
  return state.examSession.rooms.find((r) => r.id === roomId) || null;
}

const EVIDENCE_DIR = path.join(__dirname, "data", "exam-evidence");

function ensureEvidenceDir() {
  try {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  } catch {
    /* ignore */
  }
}

function safeEvidencePathForStudent(studentId) {
  const safe = String(studentId).replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(EVIDENCE_DIR, `${safe}.jsonl`);
}

function writeExamEvidenceLine(studentId, payload) {
  try {
    ensureEvidenceDir();
    const line = `${JSON.stringify({ ...payload, studentId, at: new Date().toISOString() })}\n`;
    fs.appendFileSync(safeEvidencePathForStudent(studentId), line, "utf8");
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn("[exam-evidence]", e.message);
  }
}

function finalizeExamAttemptEvidence(studentId) {
  const order = state.studentPaperSets[studentId] || [];
  const answers = { ...(state.answers[studentId] || {}) };
  const modelId = state.examSession.selectedModelId;
  const score = computeMcqScoreForStudent(studentId);
  writeExamEvidenceLine(studentId, {
    type: "attempt_summary",
    modelId,
    questionOrder: order,
    answersSnapshot: answers,
    scoreSummary: {
      correctCount: score.correctCount,
      questionsWithKey: score.questionsWithKey,
      percent: score.percent,
    },
  });
}

/** Reset per-room paper lock and student admission (call after publish, layout, or seeded exams). */
function resetExamAdmissionState() {
  state.studentEntryStatus = {};
  state.studentExamRevoked = {};
  ensureRoomsBuilt();
  state.roomPaperReleased = {};
  for (const r of state.examSession.rooms) {
    state.roomPaperReleased[r.id] = false;
  }
}

/**
 * @returns {null | { err: number, body: object }}
 */
function studentProctorFlowGate(studentId) {
  const room = roomForStudent(studentId);
  if (!room) return { err: 404, body: { error: "Student not placed in a room for this exam configuration." } };
  const st = state.studentEntryStatus[studentId] || "none";
  if (st !== "admitted") {
    return {
      err: 403,
      body: {
        error: "proctor_admission_required",
        message: "The assigned proctor must admit you before the exam paper can load.",
        roomId: room.id,
      },
    };
  }
  if (!state.roomPaperReleased[room.id]) {
    return {
      err: 403,
      body: {
        error: "paper_not_released",
        message: "The proctor must release the question paper for this room before questions appear.",
        roomId: room.id,
      },
    };
  }
  return null;
}

function canWebRtcRelay(fromUserId, fromRole, toUserId, roomId) {
  const room = roomEntityById(roomId);
  if (!room) return false;
  const studentInRoom = room.studentIds.includes(fromUserId);
  const proctorInRoom = room.proctorStaffIds.includes(fromUserId);
  if (fromRole === "student" && studentInRoom) {
    if (room.proctorStaffIds.includes(toUserId)) return true;
    if (toUserId === "admin") return true;
    return false;
  }
  if (fromRole === "proctor" && proctorInRoom && room.studentIds.includes(toUserId)) return true;
  if (fromRole === "admin" && (room.studentIds.includes(toUserId) || room.proctorStaffIds.includes(toUserId))) return true;
  return false;
}

/**
 * @returns {{ ok: true, model: object, g: object } | { err: number, body: object }}
 */
function readExamAccessKeyHeader(req) {
  if (!req || !req.headers) return "";
  return String(req.headers["x-exam-access-key"] || req.headers["X-Exam-Access-Key"] || "").trim();
}

function gateHonestyModelForStudent(sid, req) {
  const g = gateFor("student", sid, req);
  if (!g.allowed) return { err: 403, body: { error: g.reason, gate: g } };
  if (state.studentExamRevoked[sid]) {
    return {
      err: 403,
      body: {
        error: "exam_revoked",
        message:
          "This exam attempt was ended because the exam tab was closed or refreshed. You cannot continue this exam session. Contact your proctor if this was a mistake.",
        gate: g,
      },
    };
  }
  if (!state.studentHonestyAck[sid]) {
    return {
      err: 403,
      body: {
        error: "honesty_required",
        gate: g,
        policyVersion: INTEGRITY_POLICY.version,
      },
    };
  }
  const model = state.examSession.selectedModelId ? getModel(state.examSession.selectedModelId) : null;
  if (!model) return { err: 400, body: { error: "No model selected by administration." } };
  return { ok: true, model, g };
}

function buildShuffledQuestionForStudent(sid, qid) {
  const model = state.examSession.selectedModelId ? getModel(state.examSession.selectedModelId) : null;
  if (!model) return null;
  const q = model.questions.find((x) => x.id === qid);
  if (!q) return null;
  if (isEssayQuestion(q)) {
    const maxPoints = Math.min(100, Math.max(1, Math.floor(Number(q.maxPoints) || 10)));
    return { id: q.id, text: q.text, type: "essay", maxPoints };
  }
  if (q.type === "fill") {
    const maxPoints = Math.min(100, Math.max(1, Math.floor(Number(q.maxPoints) || 1)));
    return { id: q.id, text: q.text, type: "fill", maxPoints };
  }
  const perm = shuffle(q.choices.map((_, i) => i), sid + qid);
  const choices = perm.map((i) => q.choices[i]);
  const qt = q.type === "tf" ? "tf" : "mcq";
  return { id: q.id, text: q.text, type: qt, choices };
}

/** Ensures question order exists for sid; preserves issued order if already present. */
function initStudentPaperIfNeeded(sid, req) {
  const chk = gateHonestyModelForStudent(sid, req);
  if (chk.err) return chk;
  const flow = studentProctorFlowGate(sid);
  if (flow) return flow;
  const { model, g } = chk;
  const ex = state.examSession;
  if (state.studentPaperSets[sid]?.length) {
    return { ok: true, model, g };
  }
  let order = shuffle(model.questions.map((q) => q.id), sid + ex.selectedModelId);
  const cap = ex.paperDrawCount;
  if (typeof cap === "number" && cap >= 1 && cap < order.length) {
    order = order.slice(0, cap);
  }
  state.studentPaperSets[sid] = order;
  state.studentPaperCursor[sid] = 0;
  const prev = state.answers[sid] || {};
  const next = {};
  for (const qid of order) {
    const v = prev[qid];
    if (typeof v === "number") next[qid] = v;
    else if (typeof v === "string") next[qid] = v;
  }
  state.answers[sid] = next;
  return { ok: true, model, g };
}

function lobbyOpensAt() {
  const ex = state.examSession;
  const start = new Date(ex.examStartAt).getTime();
  const mins = Number(ex.lobbyOpensMinutesBefore) || 10;
  return start - mins * 60 * 1000;
}

function formatExamHeading(ex, paperLabel) {
  const subj = ex.subject && String(ex.subject).trim() ? `${String(ex.subject).trim()} · ` : "";
  return `${subj}${ex.targetGrade || "Exam"} · ${paperLabel}`;
}

function gateFor(role, userId, req) {
  const now = Date.now();
  const ex = state.examSession;
  const end = new Date(ex.examEndAt).getTime();
  const open = lobbyOpensAt();
  const base = { lobbyOpensAt: new Date(open).toISOString(), examStartAt: ex.examStartAt, examEndAt: ex.examEndAt };

  if (role === "admin") {
    return { allowed: true, reason: "admin", ...base };
  }

  if (now > end) {
    return { allowed: false, reason: "exam_ended", ...base };
  }

  if (now < open) {
    return { allowed: false, reason: "lobby_closed", ...base };
  }

  if (role === "student") {
    const st = studentById(userId);
    if (!st) return { allowed: false, reason: "unknown_student", ...base };
    if (normGrade(st.grade) !== normGrade(ex.targetGrade)) {
      return { allowed: false, reason: "wrong_grade", ...base };
    }
    const need = String(state.examAccessKey || "").trim();
    if (need && readExamAccessKeyHeader(req) !== need) {
      return {
        allowed: false,
        reason: "exam_access_key_required",
        message: "Send HTTP header X-Exam-Access-Key with the key issued by administration.",
        requiresExamAccessKey: true,
        requiresSeb: !!state.sebRequireForStudents,
        ...base,
      };
    }
    const sebCheck = seb.validateStudentSeb(req, state);
    if (!sebCheck.ok) {
      return {
        allowed: false,
        reason: sebCheck.reason,
        message: sebCheck.message,
        requiresExamAccessKey: !!need,
        requiresSeb: true,
        ...base,
      };
    }
    return {
      allowed: true,
      reason: "ok",
      requiresExamAccessKey: !!need,
      requiresSeb: !!state.sebRequireForStudents,
      ...base,
    };
  }

  if (role === "proctor") {
    const t = teacherById(userId);
    if (!t) return { allowed: false, reason: "unknown_staff", ...base };
    if (!state.examSession.published) {
      return { allowed: false, reason: "exam_not_published", message: "Exam is not published yet.", ...base };
    }
    const startMs = new Date(ex.examStartAt).getTime();
    const earliestProctorJoin = startMs - PROCTOR_JOIN_LEAD_MINUTES * 60 * 1000;
    if (now < earliestProctorJoin) {
      return {
        allowed: false,
        reason: "proctor_room_early",
        message: `Live monitoring opens ${PROCTOR_JOIN_LEAD_MINUTES} minutes before the scheduled start.`,
        earliestProctorJoinAt: new Date(earliestProctorJoin).toISOString(),
        ...base,
      };
    }
    ensureRoomsBuilt();
    const assigned = state.examSession.rooms.some((r) => r.proctorStaffIds.includes(userId));
    if (!assigned) return { allowed: false, reason: "not_assigned", ...base };
    return {
      allowed: true,
      reason: "ok",
      earliestProctorJoinAt: new Date(earliestProctorJoin).toISOString(),
      ...base,
    };
  }

  return { allowed: false, reason: "unknown_role", ...base };
}

function distinctGradesFromStudents() {
  const set = new Set();
  for (const s of state.students) {
    const g = String(s.grade ?? "").trim();
    if (g) set.add(g);
  }
  return [...set].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

function publicSnapshot() {
  const ex = state.examSession;
  ensureRoomsBuilt();
  const model = ex.selectedModelId ? getModel(ex.selectedModelId) : null;
  const inGrade = state.students.filter((s) => normGrade(s.grade) === normGrade(ex.targetGrade));
  const teacherPool = teachersForGrade(state.teachers, ex.targetGrade).map((t) => ({
    staffId: t.staffId,
    fullName: t.fullName,
  }));

  const fromRoster = distinctGradesFromStudents();
  let gradesList = [...fromRoster];
  let gradesHint = "";
  if (state.students.length === 0) {
    gradesHint = "Upload the student Excel file first. The grade list is built only from the Grade column in that file.";
    gradesList = [];
  } else if (!fromRoster.length) {
    gradesHint =
      "Students were loaded but no Grade values were found. Fix the header (use Grade or Class) and refill cells, then upload again.";
    gradesList = [];
  }

  const uploadedMeta = state.uploadedQuestionModels.map((m) => ({
    id: m.id,
    label: m.label,
    questionCount: m.questions.length,
    source: "uploaded",
    uploadedByStaffId: m.uploadedByStaffId || null,
    subject: m.subject || "",
    modelGrade: m.modelGrade || "",
  }));
  const builtinMeta = teacherModels.map((m) => ({
    id: m.id,
    label: m.label,
    questionCount: m.questions.length,
    source: "demo",
    subject: m.subject || "",
    modelGrade: m.modelGrade || "",
  }));

  const studentCountByGrade = {};
  const subjectsByGrade = {};
  for (const g of gradesList) {
    studentCountByGrade[g] = state.students.filter((s) => normGrade(s.grade) === normGrade(g)).length;
    const set = new Set();
    for (const m of state.uploadedQuestionModels) {
      const subj = String(m.subject || "").trim();
      if (!subj) continue;
      const mg = String(m.modelGrade || "").trim();
      if (!mg || normGrade(mg) === normGrade(g)) set.add(subj);
    }
    subjectsByGrade[g] = [...set].sort((a, b) => a.localeCompare(b));
  }

  return {
    studentsCount: state.students.length,
    teachersCount: state.teachers.length,
    grades: gradesList,
    gradesHint,
    studentCountByGrade,
    subjectsByGrade,
    teachersRoster: state.teachers.map((t) => ({
      staffId: t.staffId,
      fullName: t.fullName,
      supervisedGrade: t.supervisedGrade,
    })),
    uploadedQuestionModelsCount: state.uploadedQuestionModels.length,
    teachersInGradePool: teacherPool,
    examSession: {
      targetGrade: ex.targetGrade,
      subject: ex.subject || "",
      roomCount: ex.roomCount,
      lobbyOpensMinutesBefore: ex.lobbyOpensMinutesBefore,
      examStartAt: ex.examStartAt,
      examEndAt: ex.examEndAt,
      earliestProctorJoinAt: new Date(new Date(ex.examStartAt).getTime() - PROCTOR_JOIN_LEAD_MINUTES * 60 * 1000).toISOString(),
      selectedModelId: ex.selectedModelId,
      paperDrawCount: ex.paperDrawCount != null ? ex.paperDrawCount : null,
      published: ex.published,
      proctorMaxCameraTilesVisible: (() => {
        const raw = Number(ex.proctorMaxCameraTilesVisible);
        const base = Number.isFinite(raw) ? Math.floor(raw) : 12;
        return Math.min(12, Math.max(9, base));
      })(),
      studentsInTargetGrade: inGrade.length,
      rooms: ex.rooms.map((r) => ({
        id: r.id,
        label: r.label,
        studentCount: r.studentIds.length,
        proctorsRequired: r.proctorsRequired,
        proctorStaffIds: r.proctorStaffIds,
      })),
    },
    teacherModels: [...uploadedMeta, ...builtinMeta],
    selectedModelQuestionCount: model ? model.questions.length : 0,
    integrityEventsTail: state.integrityEvents.slice(-40),
    incidentsTail: state.incidents.slice(-30).reverse(),
    lobbyOpensAtISO: new Date(lobbyOpensAt()).toISOString(),
    auditLogTail: state.auditLog.slice(-45),
    integrityPolicyVersion: INTEGRITY_POLICY.version,
    requiresExamAccessKey: !!String(state.examAccessKey || "").trim(),
    sebRequireForStudents: !!state.sebRequireForStudents,
    sebBrowserExamKeyLineCount: (state.sebAllowedBrowserExamKeys || []).filter((k) => String(k).trim()).length,
  };
}

function xlsxBufferFromRows(sheetName, rows) {
  const ws = xlsx.utils.aoa_to_sheet(rows);
  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  return xlsx.write(wb, { type: "buffer", bookType: "xlsx" });
}

function studentRosterTemplateBuffer() {
  const rows = [
    ["Student ID", "Full Name", "Email", "Academic Stage", "Grade"],
    ["S0001", "Example Student", "student001@school.edu", "Primary", "Grade 4"],
    ["", "", "", "", ""],
    ["", "", "", "", ""],
    ["", "", "", "", ""],
  ];
  return xlsxBufferFromRows("Students", rows);
}

function teacherRosterTemplateBuffer() {
  const rows = [
    ["Staff ID", "Full Name", "Email", "Supervised Grade"],
    ["T001", "Example Teacher", "teacher001@school.edu", "Grade 4"],
    ["", "", "", ""],
    ["", "", "", ""],
  ];
  return xlsxBufferFromRows("Teachers", rows);
}

const UTF8_BOM = "\uFEFF";

function studentRosterTemplateCsv() {
  const lines = [
    ["Student ID", "Full Name", "Email", "Academic Stage", "Grade"],
    ["S0001", "Example Student", "student001@school.edu", "Primary", "Grade 4"],
    ["", "", "", "", ""],
    ["", "", "", "", ""],
  ];
  return UTF8_BOM + lines.map((r) => r.map((c) => csvEscapeCell(c)).join(",")).join("\r\n");
}

function teacherRosterTemplateCsv() {
  const lines = [
    ["Staff ID", "Full Name", "Email", "Supervised Grade"],
    ["T001", "Example Teacher", "teacher001@school.edu", "Grade 4"],
    ["", "", "", ""],
    ["", "", "", ""],
  ];
  return UTF8_BOM + lines.map((r) => r.map((c) => csvEscapeCell(c)).join(",")).join("\r\n");
}

function csvEscapeCell(v) {
  const s = String(v ?? "");
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

const app = express();
app.set("trust proxy", 1);
app.use(cors({ origin: true, credentials: true }));
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true } });

function broadcastState() {
  try {
    sqliteStore.schedulePersistCore(state);
  } catch (e) {
    logger.logError("broadcastState persist schedule", e);
  }
  io.emit("state:update", publicSnapshot());
}

function pushStudentScheduleNotification(targetGrade, subject, examStartAt, contactLine) {
  const line = String(contactLine || "").trim() || "contact your school administration immediately.";
  const when = new Date(examStartAt).toLocaleString();
  const body = `Dear student in ${targetGrade}: an exam for ${subject || "your subject"} is scheduled for ${when} (local time). You will receive another reminder with the exam link before the session begins. If you do not receive the link at least 10 minutes before the start, ${line}`;
  state.studentNotifications.push({
    id: `n-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    at: new Date().toISOString(),
    targetGrade,
    subject: subject || "",
    examStartAt,
    body,
  });
  while (state.studentNotifications.length > 200) state.studentNotifications.shift();
}

function applyScheduledExamToRuntime(entry, opts = {}) {
  const ex = state.examSession;
  ex.targetGrade = entry.targetGrade;
  ex.subject = entry.subject || "";
  ex.roomCount = entry.rooms?.length || entry.roomCount || 1;
  ex.lobbyOpensMinutesBefore = Number(entry.lobbyOpensMinutesBefore) || 10;
  ex.examStartAt = entry.examStartAt;
  ex.examEndAt = entry.examEndAt;
  ex.selectedModelId = entry.modelId;
  ex.rooms = JSON.parse(JSON.stringify(entry.rooms || []));
  ex.published = opts.publish !== undefined ? !!opts.publish : !!entry.published;
  resetStudentExamRuntimeFlags();
  clearIssuedPapers();
}

app.use(express.json({ limit: "2mb" }));
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  next();
});

app.use((req, res, next) => {
  if (String(req.url || "").startsWith("/api")) {
    res.setHeader("X-School-Exam-Build", SERVER_BUILD_ID);
  }
  next();
});

app.get("/api/admin/schedule/list", (_req, res) => {
  res.json({ ok: true, exams: state.scheduledExams.slice().reverse() });
});

app.post("/api/admin/schedule/create", (req, res) => {
  const body = req.body || {};
  const targetGrade = String(body.targetGrade || "").trim();
  const subject = String(body.subject || "").trim().slice(0, 120);
  const modelId = String(body.modelId || "").trim();
  if (!targetGrade || !modelId || !body.examStartAt || !body.examEndAt) {
    return res.status(400).json({ ok: false, error: "targetGrade, modelId, examStartAt, and examEndAt are required." });
  }
  const model = getModel(modelId);
  if (!model) return res.status(400).json({ ok: false, error: "Unknown question model id." });
  const maxPer = Math.min(30, Math.max(1, Math.floor(Number(body.maxStudentsPerRoom) || 12)));
  const monitors = Number(body.monitorsPerRoom) === 2 ? 2 : 1;
  const inGrade = state.students.filter((s) => normGrade(s.grade) === normGrade(targetGrade)).map((s) => s.studentId);
  if (!inGrade.length) {
    return res.status(400).json({ ok: false, error: "No students in that grade in the roster. Upload students first." });
  }
  const rooms = splitStudentsIntoRoomsWithMaxCap(inGrade, maxPer);
  for (const r of rooms) {
    r.proctorsRequired = monitors;
  }
  const subjectTeachers = new Set();
  if (model.uploadedByStaffId) subjectTeachers.add(model.uploadedByStaffId);
  let pool = teachersForGrade(state.teachers, targetGrade).filter((t) => !subjectTeachers.has(t.staffId));
  if (!pool.length) pool = teachersForGrade(state.teachers, targetGrade);
  const poolAll = teachersForGrade(state.teachers, targetGrade);
  const poolAllIds = new Set(poolAll.map((t) => t.staffId));
  const useRandom = body.randomizeProctors !== false;

  if (!useRandom && body.manualProctors && typeof body.manualProctors === "object") {
    for (const r of rooms) {
      const raw = body.manualProctors[r.id] ?? body.manualProctors[r.label];
      const arr = Array.isArray(raw) ? raw.map((x) => String(x || "").trim()).filter(Boolean) : [];
      r.proctorStaffIds = arr.slice(0, monitors).filter((id) => poolAllIds.has(id));
    }
  } else if (useRandom) {
    assignProctorsRandom(rooms, pool);
  }

  if (!useRandom) {
    for (const r of rooms) {
      if (r.proctorStaffIds.length < monitors) {
        return res.status(400).json({
          ok: false,
          error: `When random assignment is off, assign ${monitors} proctor(s) in every room (use the per-room lists or "Assign proctors automatically").`,
        });
      }
    }
  }

  const prevRooms = state.examSession.rooms;
  const prevGrade = state.examSession.targetGrade;
  state.examSession.rooms = rooms;
  state.examSession.targetGrade = targetGrade;
  const val = publishProctorValidationFails();
  state.examSession.rooms = prevRooms;
  state.examSession.targetGrade = prevGrade;
  if (!val.ok && useRandom) {
    for (const r of rooms) r.proctorStaffIds = [];
  }
  const id = `sched-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
  const entry = {
    id,
    targetGrade,
    subject,
    modelId,
    examStartAt: String(body.examStartAt),
    examEndAt: String(body.examEndAt),
    lobbyOpensMinutesBefore: Number(body.lobbyOpensMinutesBefore) || 10,
    maxStudentsPerRoom: maxPer,
    monitorsPerRoom: monitors,
    rooms,
    published: false,
    cancelled: false,
    createdAt: new Date().toISOString(),
  };
  state.scheduledExams.push(entry);
  pushStudentScheduleNotification(targetGrade, subject, entry.examStartAt, body.contactLine);
  appendAudit("schedule_create", id, { actorRole: "admin", actorId: "admin" });
  broadcastState();
  try {
    sqliteStore.persistCoreImmediate(state);
  } catch (e) {
    logger.logError("schedule create persist", e);
  }
  res.json({ ok: true, exam: entry, state: publicSnapshot() });
});

app.post("/api/admin/schedule/cancel/:id", (req, res) => {
  const id = req.params.id;
  const ex = state.scheduledExams.find((x) => x.id === id);
  if (!ex) return res.status(404).json({ ok: false, error: "Not found." });
  ex.cancelled = true;
  appendAudit("schedule_cancel", id, { actorRole: "admin", actorId: "admin" });
  broadcastState();
  try {
    sqliteStore.persistCoreImmediate(state);
  } catch (e) {
    logger.logError("schedule cancel persist", e);
  }
  res.json({ ok: true, state: publicSnapshot() });
});

app.post("/api/admin/schedule/activate/:id", (req, res) => {
  const id = req.params.id;
  const ex = state.scheduledExams.find((x) => x.id === id && !x.cancelled);
  if (!ex) return res.status(404).json({ ok: false, error: "Not found or cancelled." });
  applyScheduledExamToRuntime(ex, { publish: req.body?.publish !== false });
  ex.published = state.examSession.published;
  appendAudit("schedule_activate", id, { actorRole: "admin", actorId: "admin" });
  broadcastState();
  try {
    sqliteStore.persistCoreImmediate(state);
  } catch (e) {
    logger.logError("schedule activate persist", e);
  }
  res.json({ ok: true, state: publicSnapshot() });
});

app.get("/api/student/:studentId/notifications", (req, res) => {
  const sid = req.params.studentId;
  const st = studentById(sid);
  if (!st) return res.status(404).json({ ok: false, error: "Unknown student." });
  const g = normGrade(st.grade);
  const items = state.studentNotifications.filter((n) => normGrade(n.targetGrade) === g).slice(-20).reverse();
  res.json({ ok: true, items });
});

app.get("/api/admin/template/students", (_req, res) => {
  const buf = studentRosterTemplateBuffer();
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", 'attachment; filename="students_roster_template.xlsx"');
  res.setHeader("Content-Length", String(buf.length));
  res.send(buf);
});

app.get("/api/admin/template/teachers", (_req, res) => {
  const buf = teacherRosterTemplateBuffer();
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", 'attachment; filename="teachers_roster_template.xlsx"');
  res.setHeader("Content-Length", String(buf.length));
  res.send(buf);
});

app.get("/api/admin/template/students.csv", (_req, res) => {
  const body = studentRosterTemplateCsv();
  const buf = Buffer.from(body, "utf8");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="students_roster_template.csv"');
  res.setHeader("Content-Length", String(buf.length));
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.send(buf);
});

app.get("/api/admin/template/teachers.csv", (_req, res) => {
  const body = teacherRosterTemplateCsv();
  const buf = Buffer.from(body, "utf8");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="teachers_roster_template.csv"');
  res.setHeader("Content-Length", String(buf.length));
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.send(buf);
});

function questionPaperTemplateBuffer() {
  const rows = [
    [
      "Subject",
      "Grade",
      "Question Type",
      "Question ID",
      "Question Text",
      "Points",
      "Choice A",
      "Choice B",
      "Choice C",
      "Choice D",
      "Correct",
    ],
    [
      "Science",
      "Grade 4",
      "mcq",
      "q1",
      "Sample multiple-choice stem",
      "2",
      "Option A",
      "Option B",
      "Option C",
      "",
      "B",
    ],
    ["Science", "Grade 4", "true_false", "q2", "Ice is frozen water.", "1", "", "", "", "", "True"],
    ["Science", "Grade 4", "fill", "q3", "Water boils at 100 °C at sea level (unit: ___).", "1", "", "", "", "", "°C|Celsius"],
    ["Science", "Grade 4", "essay", "q4", "Explain one experiment you would use to show photosynthesis.", "10", "", "", "", "", ""],
    ["", "", "", "", "", "", "", "", "", "", ""],
  ];
  return xlsxBufferFromRows("Questions", rows);
}

app.get("/api/admin/template/questions", (_req, res) => {
  const buf = questionPaperTemplateBuffer();
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", 'attachment; filename="question_paper_template.xlsx"');
  res.setHeader("Content-Length", String(buf.length));
  res.send(buf);
});

/**
 * Public ICE config for browsers (STUN + optional TURN from env).
 * Set EXAM_WEBRTC_TURN_URLS to a JSON array of RTCIceServer objects, e.g.
 * [{"urls":"turn:turn.example.com:3478","username":"u","credential":"p"}]
 * or use EXAM_TURN_URL + EXAM_TURN_USERNAME + EXAM_TURN_CREDENTIAL for a single server.
 */
app.get("/api/webrtc/ice", (_req, res) => {
  const iceServers = [
    { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
    { urls: "stun:global.stun.twilio.com:3478" },
  ];
  const raw = process.env.EXAM_WEBRTC_TURN_URLS;
  if (raw) {
    try {
      const parsed = JSON.parse(String(raw));
      if (Array.isArray(parsed)) {
        for (const entry of parsed) {
          if (entry && typeof entry === "object" && entry.urls) iceServers.push(entry);
        }
      }
    } catch {
      /* ignore invalid JSON */
    }
  }
  const u = process.env.EXAM_TURN_URL;
  if (u && String(u).trim()) {
    iceServers.push({
      urls: String(u).trim(),
      username: process.env.EXAM_TURN_USERNAME ? String(process.env.EXAM_TURN_USERNAME) : "",
      credential: process.env.EXAM_TURN_CREDENTIAL ? String(process.env.EXAM_TURN_CREDENTIAL) : "",
    });
  }
  res.json({ iceServers });
});

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    build: SERVER_BUILD_ID,
    service: "school-exam-demo",
    capabilities: "/api/platform/status",
    uploads: [
      "/api/admin/upload/students",
      "/api/admin/upload/teachers",
      "/api/admin/upload/question-model",
      "/api/teacher/upload/question-model",
    ],
    uploadedQuestionModels: state.uploadedQuestionModels.length,
    startedFromCwd: process.cwd(),
    serverScript: __filename,
  });
});

app.get("/api/state", (_req, res) => {
  res.json(publicSnapshot());
});

function platformStatusPayload() {
  return {
    ok: true,
    build: SERVER_BUILD_ID,
    service: "school-exam-demo",
    integrityPolicyVersion: INTEGRITY_POLICY.version,
    renderExternalUrl: process.env.RENDER_EXTERNAL_URL || null,
    shipped: PLATFORM_SHIPPED,
    roadmap: PLATFORM_ROADMAP,
    hostingNotes: {
      renderFree:
        "Free web services may sleep without traffic. Exam roster, session, answers, and access key are persisted to SQLite (WAL) under data/ on this instance when the filesystem is writable.",
      productionRecommendation:
        "Use a paid web service + managed PostgreSQL + object storage for papers; add SSO/LTI and a VPAT before formal procurement.",
    },
  };
}

app.get("/api/platform/status", (_req, res) => {
  res.json(platformStatusPayload());
});

app.get("/api/gate", (req, res) => {
  const role = String(req.query.role || "");
  const userId = String(req.query.userId || "");
  const g = gateFor(role, userId, req);
  res.json(g);
});

app.get("/api/exam/integrity-policy", (_req, res) => {
  res.json(INTEGRITY_POLICY);
});

app.get("/api/admin/audit-log", (req, res) => {
  const lim = Math.min(200, Math.max(1, parseInt(String(req.query.limit || "80"), 10) || 80));
  res.json({ ok: true, entries: state.auditLog.slice(-lim) });
});

app.get("/api/admin/item-analysis", (_req, res) => {
  res.json({
    ok: true,
    items: computeItemAnalysis(),
    examEndAt: state.examSession.examEndAt,
    selectedModelId: state.examSession.selectedModelId,
  });
});

app.post("/api/student/:studentId/acknowledge-honesty", (req, res) => {
  const sid = req.params.studentId;
  if (!studentById(sid)) return res.status(404).json({ ok: false, error: "Unknown student." });
  const g = gateFor("student", sid, req);
  if (!g.allowed) return res.status(403).json({ ok: false, error: g.reason || "not_allowed", gate: g });
  if (req.body?.accepted !== true) {
    return res.status(400).json({ ok: false, error: 'Send JSON body { "accepted": true } after reading the rules.' });
  }
  state.studentHonestyAck[sid] = new Date().toISOString();
  appendAudit("student_honesty_ack", `policy ${INTEGRITY_POLICY.version}`, { actorRole: "student", actorId: sid });
  broadcastState();
  res.json({ ok: true, policyVersion: INTEGRITY_POLICY.version });
});

app.post("/api/admin/upload/students", upload.single("file"), (req, res) => {
  if (!req.file?.buffer) return res.status(400).json({ ok: false, error: "Missing file field 'file'." });
  try {
    const list = parseStudentsSheet(req.file.buffer, req.file.originalname);
    if (!list.length) return res.status(400).json({ ok: false, error: "No valid student rows found. Check column headers." });
    state.students = list;
    state.examSession.rooms = [];
    resetStudentExamRuntimeFlags();
    syncExamTargetGradeFromStudents();
    appendAudit("upload_students", `Imported ${list.length} rows`, { actorRole: "admin", actorId: "admin" });
    broadcastState();
    res.json({ ok: true, imported: list.length, state: publicSnapshot() });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e.message || e) });
  }
});

app.post("/api/admin/upload/teachers", upload.single("file"), (req, res) => {
  if (!req.file?.buffer) return res.status(400).json({ ok: false, error: "Missing file field 'file'." });
  try {
    const list = parseTeachersSheet(req.file.buffer, req.file.originalname);
    if (!list.length) return res.status(400).json({ ok: false, error: "No valid teacher rows found. Check column headers." });
    state.teachers = list;
    appendAudit("upload_teachers", `Imported ${list.length} rows`, { actorRole: "admin", actorId: "admin" });
    broadcastState();
    res.json({ ok: true, imported: list.length, state: publicSnapshot() });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e.message || e) });
  }
});

function handleQuestionModelUpload(req, res) {
  if (!req.file?.buffer) return res.status(400).json({ ok: false, error: "Missing file field 'file'." });
  const staffId = String(req.body?.staffId || "").trim();
  const teacherRow = staffId ? teacherById(staffId) : null;
  if (staffId && !teacherRow) {
    return res.status(403).json({
      ok: false,
      error: "Staff ID not found in the teacher roster. Ask administration to upload the teachers file first, or clear staff id for an administration-only upload.",
    });
  }
  if (staffId && teacherRow && countTeacherUploadedModels(staffId) >= MAX_TEACHER_QUESTION_MODELS) {
    return res.status(400).json({
      ok: false,
      error: `Each teacher may upload at most ${MAX_TEACHER_QUESTION_MODELS} question models. Ask administration to remove an older uploaded model if you need a new file.`,
    });
  }
  try {
    const parsed = parseQuestionModelSheet(req.file.buffer, req.file.originalname);
    const questions = parsed.questions;
    if (!questions.length) {
      return res.status(400).json({
        ok: false,
        error:
          "No valid questions found. Use the template: MCQ needs Question Text + two or more choices; True/False needs Correct (T/F); Fill-in needs Correct answer; Essay needs Question Type = essay.",
      });
    }
    const labelRaw = (req.body && (req.body.modelLabel || req.body.label)) || req.file.originalname || "Uploaded paper";
    const label = String(labelRaw).trim().slice(0, 120);
    const autoSelect = String(req.body?.autoSelect || "true").toLowerCase() !== "false";
    const uploadedBy = staffId && teacherRow ? staffId : null;
    const id = registerUploadedQuestionModel(questions, label, {
      uploadedByStaffId: uploadedBy,
      autoSelect,
      subject: parsed.subject,
      modelGrade: parsed.modelGrade,
    });
    clearIssuedPapers();
    appendAudit(
      "upload_question_model",
      `${questions.length} questions · ${id}${uploadedBy ? ` · staff ${uploadedBy}` : ""}`,
      { actorRole: uploadedBy ? "proctor" : "admin", actorId: uploadedBy || "admin" }
    );
    broadcastState();
    res.json({ ok: true, modelId: id, questionCount: questions.length, state: publicSnapshot() });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e.message || e) });
  }
}

app.post("/api/admin/upload/question-model", upload.single("file"), handleQuestionModelUpload);
/** Alias kept for bookmarks; same handler as admin (optional multipart field staffId for teacher attribution). */
app.post("/api/teacher/upload/question-model", upload.single("file"), handleQuestionModelUpload);

app.get("/api/teacher/:staffId/my-question-models", (req, res) => {
  const staffId = req.params.staffId;
  if (!teacherById(staffId)) return res.status(404).json({ ok: false, error: "Unknown teacher." });
  const list = state.uploadedQuestionModels
    .filter((m) => m.uploadedByStaffId === staffId)
    .map((m) => ({
      id: m.id,
      label: m.label,
      questionCount: m.questions.length,
      subject: m.subject || "",
      modelGrade: m.modelGrade || "",
    }));
  res.json({ ok: true, models: list, slotsUsed: list.length, slotsMax: MAX_TEACHER_QUESTION_MODELS });
});

app.post("/api/teacher/:staffId/models/:modelId/essay-questions", (req, res) => {
  const staffId = req.params.staffId;
  const modelId = req.params.modelId;
  if (!teacherById(staffId)) return res.status(404).json({ ok: false, error: "Unknown teacher." });
  const model = state.uploadedQuestionModels.find((m) => m.id === modelId);
  if (!model || model.uploadedByStaffId !== staffId) {
    return res.status(403).json({ ok: false, error: "You can only add essays to your own uploaded question models." });
  }
  const text = String(req.body?.text || "").trim();
  if (!text || text.length > 8000) {
    return res.status(400).json({ ok: false, error: "Essay prompt is required (max 8000 characters)." });
  }
  let maxPoints = Math.floor(Number(req.body?.maxPoints) || 10);
  if (!Number.isFinite(maxPoints) || maxPoints < 1) maxPoints = 10;
  maxPoints = Math.min(100, maxPoints);
  const id = `essay-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  model.questions.push({
    id,
    text,
    type: "essay",
    maxPoints,
    authoredByStaffId: staffId,
    choices: [],
  });
  appendAudit("teacher_add_essay", `${id} → model ${modelId}`, { actorRole: "proctor", actorId: staffId });
  broadcastState();
  res.json({ ok: true, questionId: id, questionCount: model.questions.length, state: publicSnapshot() });
});

app.get("/api/teacher/:staffId/essay-inbox", (req, res) => {
  const staffId = req.params.staffId;
  if (!teacherById(staffId)) return res.status(404).json({ ok: false, error: "Unknown teacher." });
  const items = [];
  for (const [blindId, row] of Object.entries(state.essayWork?.byBlindId || {})) {
    if (!row || row.authorStaffId !== staffId) continue;
    const raw = String(row.text || "");
    items.push({
      blindId,
      questionId: row.questionId,
      fullText: raw,
      excerpt: raw.slice(0, 280).replace(/\s+/g, " ") + (raw.length > 280 ? "…" : ""),
      maxPoints: row.maxPoints,
      submittedAt: row.submittedAt,
      status: typeof row.score === "number" ? "graded" : "pending",
      score: typeof row.score === "number" ? row.score : undefined,
    });
  }
  items.sort((a, b) => String(b.submittedAt).localeCompare(String(a.submittedAt)));
  res.json({ ok: true, items });
});

app.post("/api/teacher/:staffId/essay-grade", (req, res) => {
  const staffId = req.params.staffId;
  if (!teacherById(staffId)) return res.status(404).json({ ok: false, error: "Unknown teacher." });
  const blindId = String(req.body?.blindId || "").trim();
  const score = Number(req.body?.score);
  const row = state.essayWork.byBlindId[blindId];
  if (!row) return res.status(404).json({ ok: false, error: "Unknown submission." });
  if (row.authorStaffId !== staffId) return res.status(403).json({ ok: false, error: "You did not author this essay prompt." });
  if (typeof row.score === "number") return res.status(400).json({ ok: false, error: "Already graded." });
  if (!Number.isFinite(score)) return res.status(400).json({ ok: false, error: "Numeric score required." });
  const cap = Math.max(0, Number(row.maxPoints) || 10);
  const sc = Math.min(cap, Math.max(0, score));
  row.score = sc;
  row.gradedAt = new Date().toISOString();
  appendAudit("essay_graded", `blind ${blindId} → ${sc}/${cap}`, { actorRole: "proctor", actorId: staffId });
  try {
    sqliteStore.persistCoreNow(state);
  } catch (e) {
    logger.logError("persist after essay grade", e);
  }
  broadcastState();
  res.json({ ok: true });
});

app.delete("/api/admin/question-models/:id", (req, res) => {
  const id = req.params.id;
  if (!String(id).startsWith("upload-")) {
    return res.status(400).json({ ok: false, error: "Only uploaded models can be deleted (ids start with upload-)." });
  }
  state.uploadedQuestionModels = state.uploadedQuestionModels.filter((m) => m.id !== id);
  if (state.examSession.selectedModelId === id) {
    state.examSession.selectedModelId = state.uploadedQuestionModels[0]?.id || teacherModels[0]?.id || null;
  }
  clearIssuedPapers();
  appendAudit("delete_question_model", id, { actorRole: "admin", actorId: "admin" });
  broadcastState();
  res.json({ ok: true, state: publicSnapshot() });
});

/** Demo roster: 70 students in Grade 4, 12 staff supervising Grade 4. DMES: {"variant":"dmes","dmesStudentCount":1-12} or ?count= . Trio: {"variant":"trio"}. */
app.post("/api/admin/seed-demo-roster", (req, res) => {
  const b = req.body || {};
  const qv = String(req.query?.variant || req.query?.mode || "").toLowerCase();
  const wantDmes =
    b.variant === "dmes" || b.mode === "dmes" || b.trial === "dmes" || qv === "dmes" || String(req.headers["x-seed-variant"] || "").toLowerCase() === "dmes";
  const wantTrio =
    b.variant === "trio" || b.mode === "trio" || qv === "trio" || String(req.headers["x-seed-variant"] || "").toLowerCase() === "trio";
  if (wantDmes) {
    const rawN = b.dmesStudentCount ?? b.studentCount ?? req.query?.count ?? req.query?.students;
    const scenario = runSeedDmesTrialScenario(rawN);
    appendAudit("seed_dmes_trial", `DMES trial std1..std${scenario.dmesStudentCount} + teacher-1..2`, { actorRole: "admin", actorId: "admin" });
    broadcastState();
    return res.json({ ok: true, scenario, state: publicSnapshot() });
  }
  if (wantTrio) {
    const scenario = runSeedTrioScenario();
    appendAudit("seed_trio_demo", "Three students + three teachers demo", { actorRole: "admin", actorId: "admin" });
    broadcastState();
    return res.json({ ok: true, scenario, state: publicSnapshot() });
  }
  state.examAccessKey = "";
  const students = [];
  for (let i = 1; i <= 70; i++) {
    const id = `S${String(i).padStart(4, "0")}`;
    students.push({
      studentId: id,
      fullName: `Student ${i}`,
      email: `${id.toLowerCase()}@school.demo`,
      stage: "Primary",
      grade: "Grade 4",
    });
  }
  const teachers = [];
  for (let i = 1; i <= 12; i++) {
    const id = `T${String(i).padStart(3, "0")}`;
    teachers.push({
      staffId: id,
      fullName: `Teacher ${i}`,
      email: `${id.toLowerCase()}@school.demo`,
      supervisedGrade: "Grade 4",
    });
  }
  state.students = students;
  state.teachers = teachers;
  state.examSession.targetGrade = "Grade 4";
  state.examSession.roomCount = 5;
  state.examSession.rooms = [];
  ensureRoomsBuilt();
  for (const room of state.examSession.rooms) room.proctorsRequired = 2;
  assignProctorsRandom(state.examSession.rooms, teachersForGrade(state.teachers, state.examSession.targetGrade));
  syncExamTargetGradeFromStudents();
  resetStudentExamRuntimeFlags();
  resetExamAdmissionState();
  appendAudit("seed_demo_roster", "Bulk Grade 4 demo roster", { actorRole: "admin", actorId: "admin" });
  broadcastState();
  res.json({ ok: true, state: publicSnapshot() });
});

app.post("/api/admin/exam/apply-layout", (req, res) => {
  const b = req.body || {};
  const ex = state.examSession;
  const tgIn = typeof b.targetGrade === "string" ? b.targetGrade.trim() : "";
  if (!tgIn) return res.status(400).json({ ok: false, error: "Select a grade from the list (it comes from the Grade column in your student Excel file)." });
  const dg = distinctGradesFromStudents();
  if (state.students.length > 0 && dg.length > 0 && !dg.some((g) => normGrade(g) === normGrade(tgIn))) {
    return res.status(400).json({ ok: false, error: "This grade is not present in the uploaded student roster. Re-upload the file or pick another grade from the list." });
  }
  ex.targetGrade = tgIn;
  if (typeof b.roomCount === "number" && b.roomCount >= 1) ex.roomCount = b.roomCount;
  if (typeof b.lobbyOpensMinutesBefore === "number" && b.lobbyOpensMinutesBefore >= 0) ex.lobbyOpensMinutesBefore = b.lobbyOpensMinutesBefore;
  const inGrade = state.students.filter((s) => normGrade(s.grade) === normGrade(ex.targetGrade)).map((s) => s.studentId);
  ex.rooms = splitStudentsIntoRooms(inGrade, ex.roomCount);
  for (const r of ex.rooms) {
    if (typeof b.defaultProctorsPerRoom === "number" && b.defaultProctorsPerRoom >= 0) r.proctorsRequired = b.defaultProctorsPerRoom;
    else if (r.proctorsRequired == null) r.proctorsRequired = 1;
  }
  clearIssuedPapers();
  resetExamAdmissionState();
  appendAudit("exam_apply_layout", `${ex.roomCount} rooms · grade ${ex.targetGrade}`, { actorRole: "admin", actorId: "admin" });
  broadcastState();
  res.json({ ok: true, state: publicSnapshot() });
});

app.post("/api/admin/exam/schedule", (req, res) => {
  const b = req.body || {};
  const ex = state.examSession;
  if (typeof b.examStartAt === "string") ex.examStartAt = new Date(b.examStartAt).toISOString();
  if (typeof b.examEndAt === "string") ex.examEndAt = new Date(b.examEndAt).toISOString();
  if (typeof b.selectedModelId === "string" && getModel(b.selectedModelId)) ex.selectedModelId = b.selectedModelId;
  if (typeof b.lobbyOpensMinutesBefore === "number" && b.lobbyOpensMinutesBefore >= 0) ex.lobbyOpensMinutesBefore = b.lobbyOpensMinutesBefore;
  if (b.paperDrawCount === null || b.paperDrawCount === "" || typeof b.paperDrawCount === "undefined") {
    ex.paperDrawCount = null;
  } else {
    const n = Number(b.paperDrawCount);
    ex.paperDrawCount = Number.isFinite(n) && n >= 1 ? Math.floor(n) : null;
  }
  if (new Date(ex.examEndAt) <= new Date(ex.examStartAt)) {
    return res.status(400).json({ ok: false, error: "Exam end time must be after start time." });
  }
  clearIssuedPapers();
  appendAudit("exam_schedule", `model ${ex.selectedModelId || "none"} · draw ${ex.paperDrawCount ?? "all"}`, { actorRole: "admin", actorId: "admin" });
  broadcastState();
  res.json({ ok: true, state: publicSnapshot() });
});

app.post("/api/admin/exam/rooms-meta", (req, res) => {
  const list = req.body?.rooms;
  if (!Array.isArray(list)) return res.status(400).json({ ok: false, error: "rooms[] required" });
  const ex = state.examSession;
  ensureRoomsBuilt();
  for (const patch of list) {
    const room = ex.rooms.find((r) => r.id === patch.id);
    if (!room) continue;
    if (typeof patch.proctorsRequired === "number" && patch.proctorsRequired >= 0) room.proctorsRequired = patch.proctorsRequired;
  }
  appendAudit("exam_rooms_meta", "Proctor counts updated", { actorRole: "admin", actorId: "admin" });
  broadcastState();
  res.json({ ok: true, state: publicSnapshot() });
});

app.post("/api/admin/exam/assign-proctors", (req, res) => {
  const mode = req.body?.mode || "manual";
  const ex = state.examSession;
  ensureRoomsBuilt();
  const pool = teachersForGrade(state.teachers, ex.targetGrade);
  if (mode === "random") {
    assignProctorsRandom(ex.rooms, pool);
    appendAudit("exam_assign_proctors", "mode random", { actorRole: "admin", actorId: "admin" });
    broadcastState();
    return res.json({ ok: true, state: publicSnapshot() });
  }
  const assignments = req.body?.assignments;
  if (!assignments || typeof assignments !== "object") return res.status(400).json({ ok: false, error: "assignments object roomId -> staffId[] required for manual mode" });
  for (const room of ex.rooms) {
    const ids = assignments[room.id];
    if (!Array.isArray(ids)) continue;
    room.proctorStaffIds = [...new Set(ids.map(String))].filter((id) => pool.some((t) => t.staffId === id));
  }
  appendAudit("exam_assign_proctors", "mode manual", { actorRole: "admin", actorId: "admin" });
  broadcastState();
  res.json({ ok: true, state: publicSnapshot() });
});

app.post("/api/admin/exam/publish", (req, res) => {
  const ex = state.examSession;
  ensureRoomsBuilt();
  if (!ex.selectedModelId || !getModel(ex.selectedModelId)) {
    return res.status(400).json({ ok: false, error: "Select a question model (uploaded paper or demo) first." });
  }
  if (!ex.rooms.length) return res.status(400).json({ ok: false, error: "No rooms. Upload students, pick grade from your file, set room count, then Apply room layout." });
  ensureProctorsMeetRequirements();
  const check = publishProctorValidationFails();
  if (!check.ok) return res.status(400).json({ ok: false, error: check.error, rooms: check.rooms });
  resetStudentExamRuntimeFlags();
  resetExamAdmissionState();
  ex.published = true;
  appendAudit("exam_publish", `grade ${ex.targetGrade} · model ${ex.selectedModelId}`, { actorRole: "admin", actorId: "admin" });
  broadcastState();
  res.json({ ok: true, state: publicSnapshot() });
});

app.post("/api/admin/exam/extend", (req, res) => {
  const mins = Number(req.body?.minutes);
  if (!Number.isFinite(mins) || mins <= 0 || mins > 240) {
    return res.status(400).json({ ok: false, error: "minutes must be a positive number up to 240." });
  }
  const ex = state.examSession;
  const end = new Date(ex.examEndAt).getTime();
  ex.examEndAt = new Date(end + mins * 60000).toISOString();
  appendAudit("exam_extend", `+${mins} minutes`, { actorRole: "admin", actorId: "admin" });
  broadcastState();
  res.json({ ok: true, state: publicSnapshot() });
});

app.post("/api/admin/open-lobby-now", (_req, res) => {
  const ex = state.examSession;
  const now = Date.now();
  const mins = Number(ex.lobbyOpensMinutesBefore) || 10;
  ex.examStartAt = new Date(now + mins * 60000).toISOString();
  if (new Date(ex.examEndAt).getTime() <= new Date(ex.examStartAt).getTime()) {
    ex.examEndAt = new Date(new Date(ex.examStartAt).getTime() + 60 * 60000).toISOString();
  }
  appendAudit("open_lobby_now", "Testing shortcut applied", { actorRole: "admin", actorId: "admin" });
  broadcastState();
  const sid = state.students[0]?.studentId || "demo";
  res.json({ ok: true, state: publicSnapshot(), gate: gateFor("student", sid, null) });
});

app.post("/api/admin/exam/access-key", (req, res) => {
  if (req.body == null || typeof req.body.key !== "string") {
    return res.status(400).json({ ok: false, error: 'Send JSON body { "key": "your-secret" } or { "key": "" } to clear.' });
  }
  state.examAccessKey = String(req.body.key).trim();
  appendAudit("exam_access_key_set", state.examAccessKey ? "Exam access key configured" : "Exam access key cleared", {
    actorRole: "admin",
    actorId: "admin",
  });
  broadcastState();
  res.json({ ok: true, configured: !!state.examAccessKey });
});

app.get("/api/admin/exam/access-key/status", (_req, res) => {
  res.json({ ok: true, configured: !!String(state.examAccessKey || "").trim() });
});

app.post("/api/admin/exam/seb-settings", (req, res) => {
  if (req.body == null || typeof req.body.requireForStudents !== "boolean") {
    return res.status(400).json({
      ok: false,
      error: 'Send JSON body { "requireForStudents": true|false, "allowedBrowserExamKeysText": "key1\\nkey2" } (text may be empty).',
    });
  }
  state.sebRequireForStudents = !!req.body.requireForStudents;
  const raw = typeof req.body.allowedBrowserExamKeysText === "string" ? req.body.allowedBrowserExamKeysText : "";
  state.sebAllowedBrowserExamKeys = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  appendAudit(
    "seb_settings",
    state.sebRequireForStudents
      ? `SEB required for students; ${state.sebAllowedBrowserExamKeys.length} Browser Exam Key line(s)`
      : "SEB not required for students",
    { actorRole: "admin", actorId: "admin" }
  );
  broadcastState();
  res.json({
    ok: true,
    requireForStudents: state.sebRequireForStudents,
    keyLineCount: state.sebAllowedBrowserExamKeys.length,
  });
});

app.get("/api/admin/exam/seb-settings/status", (_req, res) => {
  res.json({
    ok: true,
    requireForStudents: !!state.sebRequireForStudents,
    keyLineCount: (state.sebAllowedBrowserExamKeys || []).filter((k) => String(k).trim()).length,
  });
});

/** Full SEB text for Live control (demo has no separate admin auth). */
app.get("/api/admin/exam/seb-settings", (_req, res) => {
  res.json({
    ok: true,
    requireForStudents: !!state.sebRequireForStudents,
    keysText: (state.sebAllowedBrowserExamKeys || []).join("\n"),
  });
});

app.get("/api/student/:studentId/room", (req, res) => {
  const g = gateFor("student", req.params.studentId, req);
  if (!g.allowed) return res.status(403).json({ error: g.reason, gate: g });
  const r = roomForStudent(req.params.studentId);
  if (!r) return res.status(404).json({ error: "Student not placed in a room for this exam configuration." });
  res.json({ roomId: r.id, roomName: r.label, gate: g });
});

app.get("/api/proctor/:staffId/room", (req, res) => {
  const g = gateFor("proctor", req.params.staffId, req);
  if (!g.allowed) return res.status(403).json({ error: g.reason, gate: g });
  const r = roomForStaff(req.params.staffId);
  if (!r) return res.status(404).json({ error: "Staff member is not assigned to a room." });
  const ex = state.examSession;
  const model = ex.selectedModelId ? getModel(ex.selectedModelId) : null;
  const paperLabel = model?.label || "Exam";
  const examHeading = formatExamHeading(ex, paperLabel);
  res.json({ roomId: r.id, roomName: r.label, gate: g, examHeading });
});

app.post("/api/student/:studentId/request-entry", (req, res) => {
  const sid = req.params.studentId;
  if (!studentById(sid)) return res.status(404).json({ error: "Unknown student." });
  if (state.studentExamRevoked[sid]) {
    return res.status(403).json({
      error: "exam_revoked",
      message: "This exam attempt was ended. You cannot re-enter this exam session.",
    });
  }
  const g = gateFor("student", sid, req);
  if (!g.allowed) return res.status(403).json({ error: g.reason, gate: g });
  if (!state.examSession.published) return res.status(403).json({ error: "Exam is not published yet." });
  const room = roomForStudent(sid);
  if (!room) return res.status(404).json({ error: "Student not placed in a room." });
  const cur = state.studentEntryStatus[sid] || "none";
  if (cur === "admitted") return res.json({ ok: true, status: "admitted", roomId: room.id });
  state.studentEntryStatus[sid] = "pending";
  appendAudit("student_entry_request", `room ${room.id}`, { actorRole: "student", actorId: sid });
  broadcastState();
  res.json({ ok: true, status: "pending", roomId: room.id });
});

app.get("/api/student/:studentId/entry-status", (req, res) => {
  const sid = req.params.studentId;
  if (!studentById(sid)) return res.status(404).json({ error: "Unknown student." });
  const g = gateFor("student", sid, req);
  const room = roomForStudent(sid);
  if (!room) return res.status(404).json({ error: "No room for student." });
  const st = state.studentEntryStatus[sid] || "none";
  res.json({
    ok: true,
    gate: g,
    gateAllowed: g.allowed,
    roomId: room.id,
    admissionStatus: st,
    paperReleased: !!state.roomPaperReleased[room.id],
    examPublished: state.examSession.published,
    requiresExamAccessKey: !!String(state.examAccessKey || "").trim(),
    requiresSeb: !!state.sebRequireForStudents,
    examRevoked: !!state.studentExamRevoked[sid],
  });
});

app.get("/api/proctor/:staffId/room-waitlist", (req, res) => {
  const staffId = req.params.staffId;
  const g = gateFor("proctor", staffId, req);
  if (!g.allowed) return res.status(403).json({ error: g.reason, gate: g });
  const room = roomForStaff(staffId);
  if (!room) return res.status(404).json({ error: "Staff member is not assigned to a room." });
  const students = room.studentIds.map((sid) => ({
    studentId: sid,
    fullName: studentById(sid)?.fullName || sid,
    status: state.studentEntryStatus[sid] || "none",
  }));
  res.json({
    ok: true,
    roomId: room.id,
    roomLabel: room.label,
    paperReleased: !!state.roomPaperReleased[room.id],
    students,
  });
});

app.post("/api/proctor/:staffId/admit-student", (req, res) => {
  const staffId = req.params.staffId;
  const g = gateFor("proctor", staffId, req);
  if (!g.allowed) return res.status(403).json({ error: g.reason, gate: g });
  const room = roomForStaff(staffId);
  if (!room) return res.status(404).json({ error: "Staff member is not assigned to a room." });
  const studentId = String(req.body?.studentId || "").trim();
  if (!studentId || !room.studentIds.includes(studentId)) {
    return res.status(400).json({ error: "studentId must be a student in this room." });
  }
  state.studentEntryStatus[studentId] = "admitted";
  appendAudit("proctor_admit_student", `${studentId} in ${room.id}`, { actorRole: "proctor", actorId: staffId });
  broadcastState();
  res.json({ ok: true, studentId, status: "admitted" });
});

app.post("/api/proctor/:staffId/release-paper", (req, res) => {
  const staffId = req.params.staffId;
  const g = gateFor("proctor", staffId, req);
  if (!g.allowed) return res.status(403).json({ error: g.reason, gate: g });
  const room = roomForStaff(staffId);
  if (!room) return res.status(404).json({ error: "Staff member is not assigned to a room." });
  state.roomPaperReleased[room.id] = true;
  appendAudit("proctor_release_paper", room.id, { actorRole: "proctor", actorId: staffId });
  broadcastState();
  res.json({ ok: true, roomId: room.id, released: true });
});

app.get("/api/admin/exam-evidence-index", (_req, res) => {
  try {
    ensureEvidenceDir();
    const names = fs.readdirSync(EVIDENCE_DIR).filter((n) => n.endsWith(".jsonl"));
    const rows = names.map((name) => {
      const p = path.join(EVIDENCE_DIR, name);
      const st = fs.statSync(p);
      return { file: name, sizeBytes: st.size, mtime: st.mtime.toISOString() };
    });
    res.json({ ok: true, dir: "data/exam-evidence", rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

app.get("/api/admin/exam-evidence-file/:name", (req, res) => {
  const raw = String(req.params.name || "");
  const base = path.basename(raw);
  if (!base.endsWith(".jsonl") || base !== raw) {
    return res.status(400).json({ ok: false, error: "Invalid file name." });
  }
  const evidenceRoot = path.resolve(EVIDENCE_DIR);
  const full = path.resolve(EVIDENCE_DIR, base);
  if (path.dirname(full) !== evidenceRoot) {
    return res.status(400).json({ ok: false, error: "Invalid path." });
  }
  if (!fs.existsSync(full)) return res.status(404).json({ ok: false, error: "File not found." });
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${base}"`);
  fs.createReadStream(full).pipe(res);
});

app.get("/api/admin/results-report", (_req, res) => {
  const studentRows = state.students.map((s) => ({
    studentId: s.studentId,
    fullName: s.fullName,
    ...computeMcqScoreForStudent(s.studentId),
  }));
  let evidenceFiles = [];
  try {
    ensureEvidenceDir();
    evidenceFiles = fs
      .readdirSync(EVIDENCE_DIR)
      .filter((n) => n.endsWith(".jsonl"))
      .map((name) => {
        const p = path.join(EVIDENCE_DIR, name);
        const st = fs.statSync(p);
        return { file: name, sizeBytes: st.size, mtime: st.mtime.toISOString() };
      });
  } catch {
    evidenceFiles = [];
  }
  res.json({
    ok: true,
    examEndAt: state.examSession.examEndAt,
    selectedModelId: state.examSession.selectedModelId,
    evidenceDir: "data/exam-evidence",
    evidenceFiles,
    studentRows,
  });
});

app.get("/api/student/:studentId/paper", (req, res) => {
  const sid = req.params.studentId;
  const init = initStudentPaperIfNeeded(sid, req);
  if (init.err) return res.status(init.err).json(init.body);
  const order = state.studentPaperSets[sid];
  const ex = state.examSession;
  const model = ex.selectedModelId ? getModel(ex.selectedModelId) : null;
  const paperLabel = model?.label || "Exam";
  const examHeading = formatExamHeading(ex, paperLabel);
  res.json({
    delivery: "sequential",
    paperQuestionCount: order.length,
    examStartAt: ex.examStartAt,
    examEndAt: ex.examEndAt,
    examHeading,
    paperLabel,
    gate: init.g,
    feedbackHint: INTEGRITY_POLICY.feedbackAfterExam,
    hint: "Questions are delivered one at a time. Use GET …/exam-current and POST …/exam-submit from the student app.",
  });
});

app.get("/api/student/:studentId/exam-current", (req, res) => {
  const sid = req.params.studentId;
  const init = initStudentPaperIfNeeded(sid, req);
  if (init.err) return res.status(init.err).json(init.body);
  const order = state.studentPaperSets[sid];
  let idx = state.studentPaperCursor[sid];
  if (typeof idx !== "number" || idx < 0) idx = 0;
  const ex = state.examSession;
  if (idx >= order.length) {
    return res.json({
      completed: true,
      total: order.length,
      index: order.length,
      examStartAt: ex.examStartAt,
      examEndAt: ex.examEndAt,
      gate: init.g,
    });
  }
  const qid = order[idx];
  const question = buildShuffledQuestionForStudent(sid, qid);
  if (!question) return res.status(500).json({ error: "Question model inconsistency." });
  res.json({
    completed: false,
    index: idx,
    total: order.length,
    question,
    examStartAt: ex.examStartAt,
    examEndAt: ex.examEndAt,
    gate: init.g,
  });
});

app.post("/api/student/:studentId/exam-revoke", (req, res) => {
  const sid = req.params.studentId;
  if (!studentById(sid)) return res.status(404).json({ error: "Unknown student." });
  const g = gateFor("student", sid, req);
  if (!g.allowed) return res.status(403).json({ error: g.reason, gate: g });
  if (state.studentExamRevoked[sid]) {
    return res.json({ ok: true, already: true });
  }
  const order = state.studentPaperSets[sid];
  if (!order || !order.length) {
    return res.status(400).json({ error: "No exam paper is active for this student." });
  }
  state.studentExamRevoked[sid] = { at: new Date().toISOString(), reason: String(req.body?.reason || "leave_or_close") };
  state.studentPaperCursor[sid] = order.length;
  finalizeExamAttemptEvidence(sid);
  writeExamEvidenceLine(sid, { type: "exam_revoked", reason: state.studentExamRevoked[sid].reason });
  appendAudit("student_exam_revoked", `student ${sid}`, { actorRole: "student", actorId: sid });
  try {
    sqliteStore.persistCoreNow(state);
  } catch (e) {
    logger.logError("persist after exam-revoke", e);
  }
  broadcastState();
  res.json({ ok: true });
});

app.post("/api/student/:studentId/exam-submit", (req, res) => {
  const sid = req.params.studentId;
  const init = initStudentPaperIfNeeded(sid, req);
  if (init.err) return res.status(init.err).json(init.body);
  const g = gateFor("student", sid, req);
  if (!g.allowed) return res.status(403).json({ error: g.reason });
  const { questionId, choiceIndex, essayText, fillText } = req.body || {};
  if (!questionId) return res.status(400).json({ error: "Bad payload" });
  const order = state.studentPaperSets[sid];
  let idx = state.studentPaperCursor[sid];
  if (typeof idx !== "number" || idx < 0) idx = 0;
  if (idx >= order.length) return res.status(400).json({ error: "Exam already completed." });
  if (order[idx] !== questionId) return res.status(400).json({ error: "Submit does not match the current question step." });
  const model = state.examSession.selectedModelId ? getModel(state.examSession.selectedModelId) : null;
  const q = model?.questions.find((x) => x.id === questionId);
  if (!q) return res.status(400).json({ error: "Unknown question." });
  if (!state.answers[sid]) state.answers[sid] = {};
  if (isEssayQuestion(q)) {
    const txt = String(essayText ?? "").trim();
    if (!txt) return res.status(400).json({ error: "Essay answer required." });
    if (findEssaySubmissionForStudent(sid, questionId)) {
      return res.status(400).json({ error: "This essay was already submitted." });
    }
    const blindId = newEssayBlindId();
    const maxPts = Math.min(100, Math.max(1, Math.floor(Number(q.maxPoints) || 10)));
    state.essayWork.byBlindId[blindId] = {
      studentId: sid,
      questionId,
      modelId: String(state.examSession.selectedModelId || ""),
      text: txt.slice(0, 20000),
      submittedAt: new Date().toISOString(),
      maxPoints: maxPts,
      authorStaffId: q.authoredByStaffId || null,
    };
    state.answers[sid][questionId] = -1;
    writeExamEvidenceLine(sid, { type: "essay_submit", questionId, blindId, stepIndex: idx });
    appendAudit("essay_submit", `blind ${blindId} · q ${questionId}`, { actorRole: "student", actorId: sid });
  } else if (q.type === "fill") {
    const txt = String(fillText ?? "").trim();
    if (!txt) return res.status(400).json({ error: "Answer required." });
    state.answers[sid][questionId] = txt.slice(0, 8000);
    writeExamEvidenceLine(sid, { type: "fill_submit", questionId, stepIndex: idx });
  } else {
    if (typeof choiceIndex !== "number") return res.status(400).json({ error: "Bad payload" });
    state.answers[sid][questionId] = choiceIndex;
    writeExamEvidenceLine(sid, { type: "answer_submit", questionId, choiceIndex, stepIndex: idx });
  }
  idx += 1;
  state.studentPaperCursor[sid] = idx;
  const ex = state.examSession;
  if (idx >= order.length) {
    finalizeExamAttemptEvidence(sid);
    broadcastState();
    return res.json({ ok: true, completed: true, total: order.length, examEndAt: ex.examEndAt });
  }
  const nextQid = order[idx];
  const question = buildShuffledQuestionForStudent(sid, nextQid);
  if (!question) return res.status(500).json({ error: "Question model inconsistency." });
  broadcastState();
  res.json({
    ok: true,
    completed: false,
    index: idx,
    total: order.length,
    question,
    examEndAt: ex.examEndAt,
  });
});

app.get("/api/exam/room/:roomId/students", (req, res) => {
  const room = roomEntityById(req.params.roomId);
  if (!room) return res.status(404).json({ ok: false, error: "Unknown room." });
  const students = room.studentIds.map((sid) => {
    const st = studentById(sid);
    return { studentId: sid, fullName: st?.fullName || sid };
  });
  res.json({ ok: true, roomId: room.id, roomLabel: room.label, students });
});

app.get("/api/admin/room/:roomId/mcq-rows", (req, res) => {
  const room = roomEntityById(req.params.roomId);
  if (!room) return res.status(404).json({ ok: false, error: "Unknown room." });
  const rows = room.studentIds.map((sid) => {
    const st = studentById(sid);
    return { studentId: sid, fullName: st?.fullName || sid, ...computeMcqScoreForStudent(sid) };
  });
  res.json({
    ok: true,
    roomId: room.id,
    roomLabel: room.label,
    examEndAt: state.examSession.examEndAt,
    rows,
  });
});

app.post("/api/student/:studentId/answer", (req, res) => {
  const g = gateFor("student", req.params.studentId, req);
  if (!g.allowed) return res.status(403).json({ error: g.reason });
  const sid = req.params.studentId;
  const { questionId, choiceIndex } = req.body || {};
  if (!questionId || typeof choiceIndex !== "number") return res.status(400).json({ error: "Bad payload" });
  if (!state.answers[sid]) state.answers[sid] = {};
  state.answers[sid][questionId] = choiceIndex;
  res.json({ ok: true });
});

app.get("/api/admin/answers-summary", (_req, res) => {
  res.json(state.answers);
});

app.get("/api/admin/auto-grade-summary", (_req, res) => {
  const rows = state.students.map((s) => ({
    studentId: s.studentId,
    fullName: s.fullName,
    ...computeMcqScoreForStudent(s.studentId, { includeAdminEssay: true }),
  }));
  res.json({
    ok: true,
    examEndAt: state.examSession.examEndAt,
    selectedModelId: state.examSession.selectedModelId,
    rows,
  });
});

app.get("/api/admin/essay-results", (_req, res) => {
  const rows = [];
  for (const [blindId, row] of Object.entries(state.essayWork?.byBlindId || {})) {
    if (!row) continue;
    const st = studentById(row.studentId);
    rows.push({
      blindId,
      studentId: row.studentId,
      fullName: st?.fullName || row.studentId,
      questionId: row.questionId,
      maxPoints: row.maxPoints,
      submittedAt: row.submittedAt,
      score: row.score,
      gradedAt: row.gradedAt || null,
    });
  }
  rows.sort((a, b) => String(b.submittedAt).localeCompare(String(a.submittedAt)));
  res.json({ ok: true, rows });
});

app.get("/api/proctor/:staffId/auto-grade-room", (req, res) => {
  const staffId = req.params.staffId;
  const room = roomForStaff(staffId);
  if (!room) return res.status(404).json({ ok: false, error: "Staff member is not assigned to a room." });
  const rows = room.studentIds.map((sid) => {
    const st = studentById(sid);
    return { studentId: sid, fullName: st?.fullName || sid, ...computeMcqScoreForStudent(sid) };
  });
  res.json({
    ok: true,
    roomId: room.id,
    roomLabel: room.label,
    examEndAt: state.examSession.examEndAt,
    rows,
  });
});

/** Proctor-only: sequential progress (current step), no correctness — for live monitoring. */
app.get("/api/proctor/:staffId/room-exam-progress", (req, res) => {
  const staffId = req.params.staffId;
  const room = roomForStaff(staffId);
  if (!room) return res.status(404).json({ ok: false, error: "Staff member is not assigned to a room." });
  const rows = room.studentIds.map((sid) => {
    const st = studentById(sid);
    const fullName = st?.fullName || sid;
    if (state.studentExamRevoked[sid]) {
      const order = state.studentPaperSets[sid] || [];
      const total = order.length;
      return {
        studentId: sid,
        fullName,
        phase: "revoked",
        progressLabel: "Attempt ended — answers saved",
        currentQuestion: null,
        totalQuestions: total || null,
      };
    }
    const order = state.studentPaperSets[sid];
    const total = order?.length ?? 0;
    if (!total) {
      return {
        studentId: sid,
        fullName,
        phase: "not_started",
        progressLabel: "Not started on this server yet (paper loads after admit + release on the student device)",
        currentQuestion: null,
        totalQuestions: null,
      };
    }
    let idx = state.studentPaperCursor[sid];
    if (typeof idx !== "number" || idx < 0) idx = 0;
    if (idx >= total) {
      return {
        studentId: sid,
        fullName,
        phase: "completed",
        progressLabel: `Finished all ${total} questions`,
        currentQuestion: total,
        totalQuestions: total,
      };
    }
    return {
      studentId: sid,
      fullName,
      phase: "in_progress",
      progressLabel: `On question ${idx + 1} of ${total}`,
      currentQuestion: idx + 1,
      totalQuestions: total,
    };
  });
  res.json({
    ok: true,
    roomId: room.id,
    roomLabel: room.label,
    examEndAt: state.examSession.examEndAt,
    rows,
  });
});

app.get("/api/student/:studentId/mcq-score", (req, res) => {
  const sid = req.params.studentId;
  if (!studentById(sid)) return res.status(404).json({ ok: false, error: "Unknown student." });
  const g = gateFor("student", sid, req);
  if (!g.allowed) return res.status(403).json({ ok: false, error: g.reason, gate: g });
  const end = new Date(state.examSession.examEndAt).getTime();
  if (Date.now() < end) {
    return res.status(403).json({
      ok: false,
      error: "MCQ results unlock when the scheduled exam end time is reached.",
      examEndAt: state.examSession.examEndAt,
    });
  }
  res.json({
    ok: true,
    examEndAt: state.examSession.examEndAt,
    feedbackHint: INTEGRITY_POLICY.feedbackAfterExam,
    ...computeMcqScoreForStudent(sid),
  });
});

const socketMeta = new Map();

io.on("connection", (socket) => {
  socket.on("register", (payload, cb) => {
    const role = payload?.role;
    const userId = payload?.userId;
    const displayName = payload?.displayName || userId;
    if (!role || !userId) return cb?.({ ok: false, error: "role and userId required" });
    socketMeta.set(socket.id, { role, userId, displayName });
    socket.join(`user:${userId}`);
    if (role === "admin") socket.join("admins");
    cb?.({ ok: true });
  });

  socket.on("room:join", (payload, cb) => {
    const { roomId, userId, role } = payload || {};
    const meta = socketMeta.get(socket.id);
    if (!roomId || !userId) return cb?.({ ok: false });
    socket.join(`room:${roomId}`);
    if (role === "admin" || role === "proctor") socket.join(`staff:${roomId}`);
    io.to(`room:${roomId}`).emit("room:roster", { roomId, userId, role, displayName: meta?.displayName || userId, event: "join" });
    cb?.({ ok: true });
  });

  socket.on("room:leave", (payload) => {
    const { roomId, userId, role } = payload || {};
    if (!roomId) return;
    socket.leave(`room:${roomId}`);
    socket.leave(`staff:${roomId}`);
    const meta = socketMeta.get(socket.id);
    io.to(`room:${roomId}`).emit("room:roster", { roomId, userId, role, displayName: meta?.displayName || userId, event: "leave" });
  });

  socket.on("chat:private", (payload) => {
    const { fromUserId, toUserId, text, roomId } = payload || {};
    if (!fromUserId || !toUserId || !text) return;
    io.to(`user:${toUserId}`).emit("chat:private", { fromUserId, toUserId, text, roomId, at: new Date().toISOString() });
    io.to(`user:${fromUserId}`).emit("chat:private", { fromUserId, toUserId, text, roomId, at: new Date().toISOString() });
  });

  socket.on("integrity:signal", (payload) => {
    const { roomId, studentId, type, score, note } = payload || {};
    if (!roomId || !studentId || !type) return;
    const ev = {
      id: `ev-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      at: new Date().toISOString(),
      roomId,
      studentId,
      type,
      detail: note || String(score ?? ""),
    };
    state.integrityEvents.push(ev);
    if (state.integrityEvents.length > 500) state.integrityEvents.shift();
    try {
      sqliteStore.insertIntegrityRow(ev);
    } catch (e) {
      logger.logError("integrity:signal sqlite", e);
    }
    io.to(`staff:${roomId}`).emit("integrity:event", ev);
    broadcastState();
  });

  socket.on("exam:visibility", (payload) => {
    try {
      const meta = socketMeta.get(socket.id);
      const { roomId, studentId, hidden } = payload || {};
      if (!roomId || !studentId || meta?.role !== "student" || meta.userId !== studentId) return;
      if (!hidden) return;
      const ev = {
        id: `ev-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        at: new Date().toISOString(),
        roomId,
        studentId,
        type: "tab_switch",
        detail: "Potential cheating: student left exam tab or switched away from the exam window",
      };
      state.integrityEvents.push(ev);
      if (state.integrityEvents.length > 500) state.integrityEvents.shift();
      sqliteStore.insertIntegrityRow(ev);
      appendAudit("potential_cheating_tab", `student ${studentId} room ${roomId}`, { actorRole: "student", actorId: studentId });
      io.to(`staff:${roomId}`).emit("integrity:event", ev);
      broadcastState();
    } catch (e) {
      logger.logError("exam:visibility socket", e);
    }
  });

  socket.on("webrtc:relay", (payload) => {
    const meta = socketMeta.get(socket.id);
    const fromUserId = meta?.userId;
    const fromRole = meta?.role;
    const { toUserId, roomId, type, sdp, candidate } = payload || {};
    if (!fromUserId || !toUserId || !roomId) return;
    if (!canWebRtcRelay(fromUserId, fromRole, toUserId, roomId)) return;
    io.to(`user:${toUserId}`).emit("webrtc:relay", { fromUserId, roomId, type, sdp, candidate });
  });

  socket.on("webrtc:student_cam_ready", (payload) => {
    const meta = socketMeta.get(socket.id);
    const { roomId, studentId } = payload || {};
    if (!roomId || !studentId || meta?.role !== "student" || meta.userId !== studentId) return;
    const room = roomEntityById(roomId);
    if (!room || !room.studentIds.includes(studentId)) return;
    io.to(`staff:${roomId}`).emit("webrtc:push_student_ready", { roomId, studentId });
  });

  socket.on("incident:raise", (payload) => {
    const { roomId, staffId, message, note } = payload || {};
    if (!roomId || !staffId) return;
    ensureRoomsBuilt();
    const room = state.examSession.rooms.find((r) => r.id === roomId);
    if (!room || !room.proctorStaffIds.includes(staffId)) return;
    const inc = {
      id: `inc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      at: new Date().toISOString(),
      roomId,
      staffId,
      message: String(message || "Proctor requested administration support."),
      note: note ? String(note) : "",
    };
    state.incidents.push(inc);
    if (state.incidents.length > 200) state.incidents.shift();
    io.to("admins").emit("incident:new", inc);
    broadcastState();
  });

  socket.on("disconnect", () => {
    socketMeta.delete(socket.id);
  });
});

/** Any /api path that did not match a route: JSON only (no HTML error pages). */
app.use((req, res, next) => {
  if (!String(req.path || "").startsWith("/api")) return next();
  res.status(404).json({
    ok: false,
    error: "This API path is not available. Use Server URL in the app header if you opened the page from a different address, then refresh.",
  });
});

/** JSON errors for /api (multer and other middleware errors). */
app.use((err, req, res, _next) => {
  if (String(req.path || "").startsWith("/api")) {
    const status =
      err.code === "LIMIT_FILE_SIZE"
        ? 413
        : typeof err.status === "number" && err.status >= 400 && err.status < 600
          ? err.status
          : 500;
    const message = String(err.message || "Request could not be completed.");
    logger.logError(`API error ${req.method} ${req.path}`, err);
    return res.status(status).json({ ok: false, error: message });
  }
  logger.logError(`Non-API error ${req.path}`, err);
  // eslint-disable-next-line no-console
  console.error(err);
  res.status(500).type("text").send("Server error");
});

app.use(
  express.static(path.join(__dirname, "public"), {
    setHeaders(res, filePath) {
      /* Avoid stale HTML after deploys — browsers otherwise may keep an old "Load AIS…" shell. */
      if (String(filePath).toLowerCase().endsWith(".html")) {
        res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
      }
    },
  })
);

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    // eslint-disable-next-line no-console
    console.error(`\n[ERROR] Port ${PORT} is already in use.`);
    // eslint-disable-next-line no-console
    console.error("Another program may be answering http on this port (often an old Node process).");
    // eslint-disable-next-line no-console
    console.error("The browser can still show a page, but Upload will fail if that program is not this server.");
    // eslint-disable-next-line no-console
    console.error("Windows: netstat -ano | findstr :" + PORT);
    // eslint-disable-next-line no-console
    console.error("Then: taskkill /PID <number_from_last_column> /F");
    // eslint-disable-next-line no-console
    console.error("Or use another port: set PORT=3782 && npm start\n");
  }
  throw err;
});

server.listen(PORT, () => {
  const publicUrl = process.env.RENDER_EXTERNAL_URL;
  // eslint-disable-next-line no-console
  console.log(publicUrl ? `School exam demo — public URL: ${publicUrl}` : `School exam demo at http://localhost:${PORT}`);
  // eslint-disable-next-line no-console
  console.log("Server script:", __filename);
  // eslint-disable-next-line no-console
  console.log("Working directory:", process.cwd());
  // eslint-disable-next-line no-console
  console.log("Build:", SERVER_BUILD_ID);
  // eslint-disable-next-line no-console
  console.log("Capabilities JSON: GET /api/platform/status");
  // eslint-disable-next-line no-console
  console.log("Verify API: npm run doctor   (or open /api/health in the browser)");
  // eslint-disable-next-line no-console
  console.log("Upload API: POST .../upload/students and .../upload/teachers (form field name: file)");
});

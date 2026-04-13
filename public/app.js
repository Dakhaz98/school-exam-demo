/* global io */

const $ = (sel) => document.querySelector(sel);

let socket = null;
let session = null;
let stateCache = null;
let integrityTimer = null;
let lastFrameSig = null;
let audioCtx = null;
let integrityAnalyser = null;
let integrityAudioData = null;
let gatePoll = null;
let proctorRoomId = null;
/** @type {ReturnType<typeof setInterval> | null} */
let studentExamCountdown = null;

const WEBRTC_ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];

/** @type {null | ((msg: any) => void)} */
let webRtcStudentHandler = null;
/** @type {null | ((msg: any) => void)} */
let webRtcViewerHandler = null;
/** @type {null | (() => void)} */
let studentWebRtcStop = null;
/** @type {null | (() => void)} */
let viewerRtcTeardown = null;

/** @type {{ roomId: string, viewerUserId: string, role: string, container: HTMLElement } | null} */
let lastCameraViewCtx = null;

const LS_API_ORIGIN = "examDemoApiOrigin";

function resolveApiOrigin() {
  try {
    const v = localStorage.getItem(LS_API_ORIGIN);
    if (v && String(v).trim()) return String(v).trim().replace(/\/$/, "");
  } catch {
    /* ignore */
  }
  return window.location.origin;
}

function apiUrl(path) {
  if (String(path).startsWith("http")) return path;
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${resolveApiOrigin()}${p}`;
}

function normalizeUserApiRoot(raw) {
  let s = String(raw || "").trim();
  if (!s) return "";
  if (!/^https?:\/\//i.test(s)) s = `http://${s}`;
  try {
    return new URL(s).origin;
  } catch {
    return "";
  }
}

function syncConnectionFieldFromStorage() {
  const inp = $("#conn-api-url");
  if (!inp) return;
  try {
    inp.value = localStorage.getItem(LS_API_ORIGIN) || "";
  } catch {
    inp.value = "";
  }
}

function bindConnectionPanel() {
  syncConnectionFieldFromStorage();
  $("#conn-test-save")?.addEventListener("click", async () => {
    const msg = $("#conn-msg");
    const raw = $("#conn-api-url")?.value ?? "";
    const norm = normalizeUserApiRoot(raw);
    if (!norm) {
      try {
        localStorage.removeItem(LS_API_ORIGIN);
      } catch {
        /* ignore */
      }
      if (msg) msg.textContent = "Using this tab only. Refreshing…";
      location.reload();
      return;
    }
    if (msg) msg.textContent = "Checking…";
    try {
      const url = `${norm}/api/health?t=${Date.now()}`;
      const r = await fetch(url, { cache: "no-store" });
      const text = (await r.text()).replace(/^\uFEFF/, "").trim();
      let j = null;
      try {
        j = JSON.parse(text);
      } catch {
        j = null;
      }
      const ok = r.ok && j && j.ok === true && j.service === "school-exam-demo" && j.build;
      if (!ok) {
        if (msg) {
          msg.textContent = `That address did not return a valid school-exam-demo API (HTTP ${r.status}). Check the URL and try again.`;
        }
        return;
      }
      localStorage.setItem(LS_API_ORIGIN, norm);
      if (msg) msg.textContent = `Verified (build ${j.build}). Refreshing…`;
      setTimeout(() => location.reload(), 350);
    } catch (e) {
      if (msg) msg.textContent = e.message || String(e);
    }
  });
  $("#conn-reset")?.addEventListener("click", () => {
    try {
      localStorage.removeItem(LS_API_ORIGIN);
    } catch {
      /* ignore */
    }
    syncConnectionFieldFromStorage();
    const msg = $("#conn-msg");
    if (msg) msg.textContent = "Cleared. Refreshing…";
    location.reload();
  });
}

const SESSION_KEY = "examDemoSession";

function loadSession() {
  try {
    let j = sessionStorage.getItem(SESSION_KEY);
    if (!j) {
      const legacy = localStorage.getItem(SESSION_KEY);
      if (legacy) {
        sessionStorage.setItem(SESSION_KEY, legacy);
        localStorage.removeItem(SESSION_KEY);
        j = legacy;
      }
    }
    return j ? JSON.parse(j) : null;
  } catch {
    return null;
  }
}

function saveSession(s) {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
  session = s;
}

function clearSession() {
  try {
    sessionStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
  session = null;
}

function friendlyHttpError(status, bodyText) {
  const t = String(bodyText || "");
  if (t.includes("Cannot GET") || t.includes("Cannot POST") || t.includes("<!DOCTYPE") || t.includes("<html")) {
    return "Could not reach the School Exam Platform API. Open Server URL in the header, enter the app address, Test & save, then try again.";
  }
  if (t.length > 220) return t.slice(0, 220) + "...";
  return t || `Request failed (${status})`;
}

function throwFromErrorBody(r, bodyText) {
  const t = String(bodyText || "");
  try {
    const j = JSON.parse(t);
    if (j && typeof j.error === "string" && j.error) throw new Error(j.error);
    if (j && typeof j.message === "string" && j.message) throw new Error(j.message);
  } catch (e) {
    if (!(e instanceof SyntaxError)) throw e;
  }
  throw new Error(friendlyHttpError(r.status, t));
}

async function api(path, opts = {}) {
  const url = apiUrl(path);
  const { headers: hdr, ...rest } = opts;
  const r = await fetch(url, {
    ...rest,
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...(hdr || {}) },
  });
  if (!r.ok) {
    const t = await r.text();
    throwFromErrorBody(r, t);
  }
  return r.json();
}

async function apiDelete(path) {
  const url = apiUrl(path);
  const r = await fetch(url, { method: "DELETE", cache: "no-store" });
  if (!r.ok) {
    const t = await r.text();
    throwFromErrorBody(r, t);
  }
  return r.json();
}

async function apiForm(path, formData) {
  const url = apiUrl(path);
  const r = await fetch(url, { method: "POST", body: formData, cache: "no-store" });
  if (!r.ok) {
    const t = await r.text();
    throwFromErrorBody(r, t);
  }
  return r.json();
}

function uploadsShapeLooksCurrent(j) {
  if (!j || !Array.isArray(j.uploads)) return false;
  const paths = j.uploads.map((u) => String(u));
  return (
    paths.some((u) => u.includes("upload/teachers") || u.includes("upload-teachers")) &&
    paths.some((u) => u.includes("question-model"))
  );
}

async function probeBackendOnce() {
  const healthUrl = apiUrl(`/api/health?t=${Date.now()}`);
  try {
    const r = await fetch(healthUrl, { cache: "no-store" });
    const raw = await r.text();
    const text = raw.replace(/^\uFEFF/, "").trim();
    let j = null;
    try {
      j = JSON.parse(text);
    } catch {
      j = null;
    }
    const coreOk = r.ok && j && j.ok === true && j.service === "school-exam-demo" && !!j.build;
    const uploadsOk = uploadsShapeLooksCurrent(j);
    window.__examBackendOk = !!(coreOk && uploadsOk) || !!coreOk;
  } catch {
    window.__examBackendOk = false;
  }
}

function connectSocket() {
  if (socket?.connected) return;
  const root = resolveApiOrigin();
  const opts = { transports: ["websocket", "polling"] };
  socket = root === window.location.origin ? io(opts) : io(root, opts);
  socket.on("webrtc:relay", (msg) => {
    try {
      webRtcStudentHandler?.(msg);
    } catch (e) {
      console.warn(e);
    }
    try {
      webRtcViewerHandler?.(msg);
    } catch (e) {
      console.warn(e);
    }
  });
}

function relayIceCandidate(toUserId, roomId, pc) {
  pc.onicecandidate = (e) => {
    if (e.candidate && socket?.connected) {
      const cand = e.candidate.toJSON ? e.candidate.toJSON() : e.candidate;
      socket.emit("webrtc:relay", { toUserId, roomId, type: "candidate", candidate: cand });
    }
  };
}

/**
 * Student publishes camera/mic to each proctor or admin viewer that sends an offer.
 * @returns {() => void}
 */
function startStudentWebRtcPublisher(roomId, studentId, stream) {
  const peers = new Map();

  webRtcStudentHandler = async (msg) => {
    if (!msg || msg.roomId !== roomId) return;
    const viewerId = msg.fromUserId;
    if (!viewerId || viewerId === studentId) return;

    if (msg.type === "offer" && msg.sdp) {
      const old = peers.get(viewerId);
      if (old) {
        try {
          old.close();
        } catch {
          /* ignore */
        }
        peers.delete(viewerId);
      }
      const pc = new RTCPeerConnection({ iceServers: WEBRTC_ICE_SERVERS });
      peers.set(viewerId, pc);
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));
      relayIceCandidate(viewerId, roomId, pc);
      await pc.setRemoteDescription({ type: "offer", sdp: msg.sdp });
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit("webrtc:relay", { toUserId: viewerId, roomId, type: "answer", sdp: answer.sdp });
      return;
    }

    if (msg.type === "candidate" && msg.candidate) {
      const p = peers.get(viewerId);
      if (!p || !p.remoteDescription) return;
      try {
        await p.addIceCandidate(msg.candidate);
      } catch {
        /* ignore */
      }
    }
  };

  try {
    socket?.emit("webrtc:student_cam_ready", { roomId, studentId });
  } catch {
    /* ignore */
  }

  return () => {
    webRtcStudentHandler = null;
    for (const p of peers.values()) {
      try {
        p.close();
      } catch {
        /* ignore */
      }
    }
    peers.clear();
  };
}

function findVideoTile(container, studentId) {
  for (const el of container.querySelectorAll(".video-tile")) {
    if (el.dataset.student === studentId) return el;
  }
  return null;
}

/**
 * Proctor or admin: request one-way video/audio from each student in the room.
 */
async function startProctorViewCameras(roomId, viewerUserId, role, container) {
  viewerRtcTeardown?.();
  container.innerHTML = "";
  lastCameraViewCtx = { roomId, viewerUserId, role, container };

  const peers = new Map();

  const handler = async (msg) => {
    if (!msg || msg.roomId !== roomId) return;
    const studentId = msg.fromUserId;
    if (!studentId || studentId === viewerUserId) return;

    if (msg.type === "answer" && msg.sdp) {
      const pc = peers.get(studentId);
      if (!pc) return;
      await pc.setRemoteDescription({ type: "answer", sdp: msg.sdp });
      const tile = findVideoTile(container, studentId);
      const st = tile?.querySelector?.(".webrtc-status");
      if (st) st.textContent = "Live";
      return;
    }

    if (msg.type === "candidate" && msg.candidate) {
      const pc = peers.get(studentId);
      if (!pc || !pc.remoteDescription) return;
      try {
        await pc.addIceCandidate(msg.candidate);
      } catch {
        /* ignore */
      }
    }
  };

  webRtcViewerHandler = handler;

  const connectToStudent = async (studentId, fullName) => {
    let wrap = findVideoTile(container, studentId);
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.className = "video-tile";
      wrap.dataset.student = studentId;
      wrap.innerHTML = `<p class="video-tile-label">${escapeHtml(fullName)} <span class="hint">(${escapeHtml(studentId)})</span></p><video playsinline autoplay muted></video><p class="hint webrtc-status">Negotiating…</p><button type="button" class="secondary video-unmute-btn">Unmute this feed</button>`;
      container.appendChild(wrap);
      wrap.querySelector(".video-unmute-btn")?.addEventListener("click", () => {
        const v = wrap.querySelector("video");
        if (v) v.muted = !v.muted;
      });
    }
    const videoEl = wrap.querySelector("video");
    const statusEl = wrap.querySelector(".webrtc-status");
    const oldPc = peers.get(studentId);
    if (oldPc) {
      try {
        oldPc.close();
      } catch {
        /* ignore */
      }
      peers.delete(studentId);
    }
    const pc = new RTCPeerConnection({ iceServers: WEBRTC_ICE_SERVERS });
    peers.set(studentId, pc);
    pc.addTransceiver("video", { direction: "recvonly" });
    pc.addTransceiver("audio", { direction: "recvonly" });
    pc.ontrack = (ev) => {
      if (ev.streams[0] && videoEl) videoEl.srcObject = ev.streams[0];
    };
    relayIceCandidate(studentId, roomId, pc);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit("webrtc:relay", { toUserId: studentId, roomId, type: "offer", sdp: offer.sdp });
    if (statusEl) statusEl.textContent = "Waiting for student…";
  };

  const onStudentCamReady = async (p) => {
    if (!p || p.roomId !== roomId) return;
    try {
      const roster = await api(`/api/exam/room/${encodeURIComponent(roomId)}/students`);
      const row = (roster.students || []).find((x) => x.studentId === p.studentId);
      if (row) await connectToStudent(row.studentId, row.fullName);
    } catch {
      /* ignore */
    }
  };
  socket.on("webrtc:push_student_ready", onStudentCamReady);

  try {
    const roster = await api(`/api/exam/room/${encodeURIComponent(roomId)}/students`);
    for (const row of roster.students || []) {
      await connectToStudent(row.studentId, row.fullName);
    }
    if (!(roster.students || []).length) {
      container.innerHTML = '<p class="hint">No students in this room yet. When a student begins the exam, feeds appear automatically or use Refresh camera connections.</p>';
    }
  } catch (e) {
    container.innerHTML = `<p class="hint">Camera roster error: ${escapeHtml(e.message || String(e))}</p>`;
  }

  viewerRtcTeardown = () => {
    socket.off("webrtc:push_student_ready", onStudentCamReady);
    webRtcViewerHandler = null;
    for (const p of peers.values()) {
      try {
        p.close();
      } catch {
        /* ignore */
      }
    }
    peers.clear();
    container.querySelectorAll("video").forEach((v) => {
      v.srcObject = null;
    });
  };
}

function renderLogin() {
  $("#view-login").classList.remove("hidden");
  $("#view-app").classList.add("hidden");
  $("#btn-logout").classList.add("hidden");
  $("#hero-banner").classList.add("hidden");
  syncConnectionFieldFromStorage();
  const s = loadSession();
  if (s) {
    $("#role").value = s.role;
    $("#userId").value = s.userId;
    $("#displayName").value = s.displayName || "";
  }
  syncUserIdLabel();
}

function syncUserIdLabel() {
  const role = $("#role").value;
  const lab = $("#user-id-label");
  if (role === "student") lab.textContent = "Student ID";
  else if (role === "proctor") lab.textContent = "Staff ID";
  else lab.textContent = "User id (use admin)";
}

$("#role")?.addEventListener("change", syncUserIdLabel);

function setHeader(text) {
  $("#whoami").textContent = text;
}

function showTab(name) {
  document.querySelectorAll("[data-tab]").forEach((el) => {
    el.classList.toggle("hidden", el.getAttribute("data-tab") !== name);
  });
  document.querySelectorAll("[data-tabbtn]").forEach((btn) => {
    const on = btn.getAttribute("data-tabbtn") === name;
    btn.classList.toggle("secondary", !on);
    btn.setAttribute("aria-selected", on ? "true" : "false");
  });
  if (name === "admin" || name === "exam" || name === "live" || name === "proctor" || name === "student") {
    const main = $("#main-content");
    if (main) {
      try {
        main.focus({ preventScroll: true });
      } catch {
        main.focus();
      }
    }
  }
}

function dtLocalValue(iso) {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

async function refreshState() {
  stateCache = await api("/api/state");
  if (session?.role === "admin") {
    paintAdminRosters();
    paintQuestionModelsPanel();
    paintExamWizard();
    paintLiveTab();
    void paintPlatformCapabilities();
  }
}

async function refreshGateBanner() {
  const s = loadSession();
  if (!s || s.role === "admin") return;
  try {
    const g = await api(`/api/gate?role=${encodeURIComponent(s.role)}&userId=${encodeURIComponent(s.userId)}`);
    const hb = $("#hero-banner");
    const ht = $("#hero-text");
    hb.classList.remove("hidden");
    if (!g.allowed) {
      if (g.reason === "exam_ended") {
        ht.innerHTML = `<span class="pill bad">Closed</span> This exam window has ended.`;
      } else if (g.reason === "lobby_closed") {
        ht.innerHTML = `<span class="pill bad">Lobby closed</span> The link opens at <strong>${new Date(g.lobbyOpensAt).toLocaleString()}</strong> (local time). Exam runs until <strong>${new Date(g.examEndAt).toLocaleString()}</strong>.`;
      } else if (g.reason === "unknown_student" || g.reason === "unknown_staff") {
        ht.innerHTML = `<span class="pill bad">Unknown id</span> Your id is not in the uploaded roster. Ask administration to check the Excel file.`;
      } else if (g.reason === "wrong_grade") {
        ht.innerHTML = `<span class="pill bad">Wrong grade</span> This session is not configured for your grade.`;
      } else if (g.reason === "not_assigned") {
        ht.innerHTML = `<span class="pill bad">Not assigned</span> You are not assigned to a room for this exam yet.`;
      } else {
        ht.textContent = "You cannot enter yet.";
      }
    } else {
      ht.innerHTML = `<span class="pill ok">Lobby open</span> You may join your room. Exam ends at <strong>${new Date(g.examEndAt).toLocaleString()}</strong> (local time).`;
    }
  } catch {
    $("#hero-banner").classList.add("hidden");
  }
}

function paintAdminRosters() {
  $("#upload-students-result").textContent = stateCache
    ? `Students in platform: ${stateCache.studentsCount}`
    : "";
  $("#upload-teachers-result").textContent = stateCache
    ? `Teachers in platform: ${stateCache.teachersCount}`
    : "";
}

async function paintPlatformCapabilities() {
  const shipped = $("#platform-shipped-list");
  const roadmap = $("#platform-roadmap-list");
  const note = $("#platform-hosting-note");
  if (!shipped || !roadmap) return;
  try {
    const s = await api("/api/platform/status");
    shipped.innerHTML = "";
    (s.shipped || []).forEach((x) => {
      const li = document.createElement("li");
      li.textContent = x.label;
      shipped.appendChild(li);
    });
    roadmap.innerHTML = "";
    (s.roadmap || []).forEach((x) => {
      const li = document.createElement("li");
      li.textContent = x.label;
      roadmap.appendChild(li);
    });
    if (note && s.hostingNotes) {
      note.textContent = [s.hostingNotes.renderFree, s.hostingNotes.productionRecommendation].filter(Boolean).join(" ");
    }
  } catch (e) {
    shipped.innerHTML = "";
    const li = document.createElement("li");
    li.textContent = e.message || String(e);
    shipped.appendChild(li);
  }
}

function paintQuestionModelsPanel() {
  const box = $("#question-models-list");
  if (!box || !stateCache) return;
  const uploaded = (stateCache.teacherModels || []).filter((m) => m.source === "uploaded");
  if (!uploaded.length) {
    box.innerHTML = '<p class="hint">No uploaded papers yet. Use the template, fill rows, then Upload.</p>';
    return;
  }
  box.innerHTML = "";
  uploaded.forEach((m) => {
    const row = document.createElement("div");
    row.className = "row";
    row.style.alignItems = "center";
    row.style.marginBottom = "0.35rem";
    const by = m.uploadedByStaffId ? ` · Staff: ${escapeHtml(m.uploadedByStaffId)}` : "";
    row.innerHTML = `<span>${escapeHtml(m.label)} (${m.questionCount} items)${by}</span>`;
    const del = document.createElement("button");
    del.type = "button";
    del.className = "secondary";
    del.textContent = "Remove";
    del.addEventListener("click", async () => {
      if (!confirm("Remove this uploaded question paper from the platform?")) return;
      await apiDelete(`/api/admin/question-models/${encodeURIComponent(m.id)}`);
      await refreshState();
    });
    row.appendChild(del);
    box.appendChild(row);
  });
}

function paintExamWizard() {
  if (!stateCache) return;
  const ex = stateCache.examSession;
  const grades = stateCache.grades || [];
  const hintEl = $("#ex-grade-hint");
  if (hintEl) hintEl.textContent = stateCache.gradesHint || "";

  const sel = $("#ex-grade");
  const cur = ex.targetGrade;
  sel.innerHTML = "";
  sel.disabled = false;
  if (!grades.length) {
    const o = document.createElement("option");
    o.value = "";
    o.textContent = "(Upload student Excel: values in Grade column will appear here)";
    o.disabled = true;
    sel.appendChild(o);
    sel.disabled = true;
  } else {
    grades.forEach((g) => {
      const o = document.createElement("option");
      o.value = g;
      o.textContent = g;
      sel.appendChild(o);
    });
    sel.value = grades.some((g) => g === cur) ? cur : grades[0];
  }
  const applyBtn = $("#ex-apply-layout");
  if (applyBtn) applyBtn.disabled = !grades.length;
  $("#ex-grade-count").value = String(ex.studentsInTargetGrade ?? 0);
  $("#ex-rooms").value = String(ex.roomCount || 1);
  $("#ex-lobby").value = String(ex.lobbyOpensMinutesBefore ?? 10);
  $("#ex-start").value = dtLocalValue(ex.examStartAt);
  $("#ex-end").value = dtLocalValue(ex.examEndAt);
  const ms = $("#ex-model");
  ms.innerHTML = "";
  (stateCache.teacherModels || []).forEach((m) => {
    const o = document.createElement("option");
    o.value = m.id;
    const tag = m.source === "uploaded" ? "[Uploaded] " : "[Demo] ";
    const by = m.uploadedByStaffId ? ` · ${m.uploadedByStaffId}` : "";
    o.textContent = `${tag}${m.label} (${m.questionCount} questions)${by}`;
    ms.appendChild(o);
  });
  if (ex.selectedModelId) ms.value = ex.selectedModelId;
  const drawInp = $("#ex-paper-draw");
  if (drawInp) drawInp.value = ex.paperDrawCount != null && ex.paperDrawCount >= 1 ? String(ex.paperDrawCount) : "";

  const wrap = $("#ex-rooms-manual");
  wrap.innerHTML = "";
  const pool = stateCache.teachersInGradePool || [];
  (ex.rooms || []).forEach((room) => {
    const card = document.createElement("div");
    card.className = "panel";
    card.style.marginBottom = "0";
    const selId = `msel-${room.id}`;
    const opts = pool
      .map(
        (t) =>
          `<option value="${escapeAttr(t.staffId)}" ${room.proctorStaffIds?.includes(t.staffId) ? "selected" : ""}>${escapeHtml(t.fullName)} (${escapeHtml(t.staffId)})</option>`
      )
      .join("");
    card.innerHTML = `
      <h3 style="margin-top:0">${escapeHtml(room.label)} <span class="hint">(${room.studentCount} students)</span></h3>
      <div class="row">
        <label>Proctors required for this room
          <input type="number" min="0" max="20" class="room-req" data-room="${escapeAttr(room.id)}" value="${Number(room.proctorsRequired) || 0}" />
        </label>
      </div>
      <label style="margin-top:0.5rem">Teachers for this grade (names shown). Hold Ctrl (Windows) or Command (Mac) to select multiple.</label>
      <select multiple class="room-msel" id="${selId}" data-room="${escapeAttr(room.id)}" style="width:100%; margin-top:0.35rem; min-height: 140px">${opts}</select>
    `;
    wrap.appendChild(card);
  });
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/'/g, "&#39;");
}

function paintLiveTab() {
  const ex = stateCache.examSession;
  $("#live-timing-hint").textContent = `Lobby opens at ${new Date(stateCache.lobbyOpensAtISO).toLocaleString()} (local). Start ${new Date(ex.examStartAt).toLocaleString()}, end ${new Date(ex.examEndAt).toLocaleString()}.`;
  const tbody = $("#live-rooms-body");
  tbody.innerHTML = "";
  (ex.rooms || []).forEach((r) => {
    const tr = document.createElement("tr");
    const staff = (r.proctorStaffIds || []).join(", ");
    tr.innerHTML = `<td>${escapeHtml(r.label)}</td><td>${r.studentCount}</td><td>${r.proctorsRequired}</td><td>${escapeHtml(staff || "none")}</td>
      <td><button type="button" class="secondary observe" data-room="${escapeAttr(r.id)}">Open command center</button></td>`;
    tbody.appendChild(tr);
  });
  tbody.querySelectorAll(".observe").forEach((btn) => {
    btn.addEventListener("click", () => openObserve(btn.getAttribute("data-room")));
  });
  const inc = $("#live-incidents");
  inc.innerHTML = "";
  (stateCache.incidentsTail || []).forEach((ev) => {
    const div = document.createElement("div");
    div.textContent = `[${ev.at}] ${ev.roomId} staff ${ev.staffId}: ${ev.message}`;
    inc.appendChild(div);
  });
  const integ = $("#live-integrity");
  integ.innerHTML = "";
  (stateCache.integrityEventsTail || []).forEach((ev) => {
    const div = document.createElement("div");
    div.textContent = `[${ev.at}] ${ev.roomId} ${ev.studentId || ""} ${ev.type}: ${ev.detail}`;
    integ.appendChild(div);
  });

  const mcqHint = $("#live-mcq-grade-hint");
  const mcqBody = $("#live-mcq-grade-body");
  if (mcqHint && mcqBody) {
    mcqHint.textContent = "Loading…";
    mcqBody.innerHTML = "";
    void (async () => {
      try {
        const g = await api("/api/admin/auto-grade-summary");
        const endMs = new Date(g.examEndAt).getTime();
        mcqHint.textContent =
          Date.now() < endMs
            ? `Scheduled end ${new Date(g.examEndAt).toLocaleString()} (local). Percent uses only rows that include a Correct key in the question file.`
            : `Scheduled end has passed. Students can view their MCQ summary on the Student desk after the countdown reaches zero.`;
        mcqBody.innerHTML = "";
        for (const row of g.rows || []) {
          const tr = document.createElement("tr");
          const pct = row.percent == null ? "—" : `${row.percent}%`;
          const keyed = row.questionsWithKey ?? 0;
          const corr = row.correctCount ?? 0;
          tr.innerHTML = `<td>${escapeHtml(row.fullName)} <span class="hint">(${escapeHtml(row.studentId)})</span></td><td>${corr}</td><td>${keyed}</td><td>${pct}</td>`;
          mcqBody.appendChild(tr);
        }
      } catch (e) {
        mcqHint.textContent = e.message || String(e);
      }
    })();
  }

  const auditEl = $("#live-audit-log");
  if (auditEl && Array.isArray(stateCache.auditLogTail)) {
    auditEl.innerHTML = "";
    stateCache.auditLogTail.forEach((ev) => {
      const div = document.createElement("div");
      const who = ev.actorId ? `${ev.actorRole || "user"}:${ev.actorId}` : ev.actorRole || "system";
      div.textContent = `[${ev.at}] ${ev.action} — ${ev.detail || ""} (${who})`;
      auditEl.appendChild(div);
    });
  }

  const iaHint = $("#live-item-analysis-hint");
  const iaBody = $("#live-item-analysis-body");
  if (iaHint && iaBody) {
    iaHint.textContent = "Loading…";
    iaBody.innerHTML = "";
    void (async () => {
      try {
        const r = await api("/api/admin/item-analysis");
        iaHint.textContent =
          "Share correct among recorded attempts for students in the exam grade. Students must load a paper before they appear in attempts.";
        iaBody.innerHTML = "";
        for (const it of r.items || []) {
          const tr = document.createElement("tr");
          if (!it.keyed) {
            tr.innerHTML = `<td><code>${escapeHtml(it.questionId)}</code> <span class="hint">(no key)</span></td><td>—</td><td>—</td>`;
          } else {
            const pct = it.pCorrect == null ? "—" : `${it.pCorrect}%`;
            tr.innerHTML = `<td title="${escapeAttr(it.text)}"><code>${escapeHtml(it.questionId)}</code> ${escapeHtml(it.text.slice(0, 70))}${it.text.length > 70 ? "…" : ""}</td><td>${it.attempts}</td><td>${pct}</td>`;
          }
          iaBody.appendChild(tr);
        }
      } catch (e) {
        iaHint.textContent = e.message || String(e);
      }
    })();
  }
}

async function enterApp() {
  const role = $("#role").value;
  const userId = $("#userId").value.trim();
  const displayName = $("#displayName").value.trim() || userId;
  if (!userId) {
    alert("Please enter your id.");
    return;
  }
  saveSession({ role, userId, displayName });
  $("#view-login").classList.add("hidden");
  $("#view-app").classList.remove("hidden");
  $("#btn-logout").classList.remove("hidden");

  connectSocket();
  socket.emit("register", { role, userId, displayName }, () => {});

  $("#nav-admin").classList.toggle("hidden", role !== "admin");
  $("#nav-exam").classList.toggle("hidden", role !== "admin");
  $("#nav-live").classList.toggle("hidden", role !== "admin");
  $("#nav-proctor").classList.toggle("hidden", role !== "proctor");
  $("#nav-student").classList.toggle("hidden", role !== "student");

  setHeader(`${displayName} (${role})`);

  if (role === "admin") {
    showTab("admin");
    if (socket) {
      socket.off("incident:new");
      socket.on("incident:new", () => {
        refreshState();
      });
    }
  } else if (role === "proctor") {
    showTab("proctor");
  } else {
    showTab("student");
    socket.off("chat:private");
    socket.on("chat:private", (msg) => {
      const s = loadSession();
      if (msg.toUserId !== s.userId && msg.fromUserId !== s.userId) return;
      const log = $("#student-pm-log");
      if (!log) return;
      const line = document.createElement("div");
      line.textContent = `[private] ${msg.fromUserId}: ${msg.text}`;
      log.prepend(line);
    });
  }

  await refreshState();
  await refreshGateBanner();

  if (gatePoll) clearInterval(gatePoll);
  if (role !== "admin") gatePoll = setInterval(refreshGateBanner, 8000);

  socket.off("state:update");
  socket.on("state:update", () => {
    refreshState();
    if (role !== "admin") refreshGateBanner();
  });
}

function logout() {
  closeAdminRoomCommandCenter();
  if (studentExamCountdown) {
    clearInterval(studentExamCountdown);
    studentExamCountdown = null;
  }
  if (gatePoll) clearInterval(gatePoll);
  gatePoll = null;
  studentWebRtcStop?.();
  studentWebRtcStop = null;
  viewerRtcTeardown?.();
  viewerRtcTeardown = null;
  webRtcStudentHandler = null;
  webRtcViewerHandler = null;
  lastCameraViewCtx = null;
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  stopIntegrity();
  clearSession();
  renderLogin();
}

function bindAdminUploads() {
  $("#btn-upload-students").onclick = async () => {
    const inp = $("#file-students");
    if (!inp.files?.[0]) return alert("Choose an Excel file first.");
    const fd = new FormData();
    fd.append("file", inp.files[0]);
    try {
      const r = await apiForm("/api/admin/upload/students", fd);
      $("#upload-students-result").textContent = `Imported ${r.imported} students.`;
      await refreshState();
    } catch (e) {
      alert(e.message);
    }
  };
  $("#btn-upload-teachers").onclick = async () => {
    const inp = $("#file-teachers");
    if (!inp.files?.[0]) return alert("Choose an Excel file first.");
    const fd = new FormData();
    fd.append("file", inp.files[0]);
    try {
      const r = await apiForm("/api/admin/upload/teachers", fd);
      $("#upload-teachers-result").textContent = `Imported ${r.imported} teachers.`;
      await refreshState();
    } catch (e) {
      alert(e.message);
    }
  };
  $("#btn-seed-demo").onclick = async () => {
    await api("/api/admin/seed-demo-roster", { method: "POST" });
    await refreshState();
  };
  const seedAisBtn = $("#btn-seed-ais-trial");
  if (seedAisBtn) {
    seedAisBtn.onclick = async () => {
      const out = $("#seed-ais-result");
      try {
        const r = await api("/api/admin/seed-demo-roster?variant=ais", {
          method: "POST",
          body: JSON.stringify({ variant: "ais" }),
        });
        const sc =
          r.scenario && r.scenario.student?.userId
            ? r.scenario
            : r.state?.studentsCount === 1 &&
                r.state?.teachersCount === 1 &&
                String(r.state?.examSession?.targetGrade || "") === "Grade 10"
              ? {
                  student: { userId: "D50435", displayName: "Hala Mohammad Omar Shaban", role: "student" },
                  teacher: { userId: "AIS-ROJAN", displayName: "Rojan Adnan Hasan", role: "proctor" },
                  admin: { userId: "admin", displayName: "Administration", role: "admin" },
                  grade: "Grade 10",
                  note: "Lobby window is open for testing. Each browser tab has its own login (session is per tab).",
                }
              : null;
        if (out) {
          if (!sc) {
            out.innerHTML =
              "<strong>Warning:</strong> The server did not return the AIS trial summary. You may be on an old build: restart the app from the latest project folder, set Server URL if needed, then try again.";
          } else {
            out.innerHTML = [
              "<strong>Scenario loaded.</strong> Open three tabs to the same site URL. Each tab keeps its own role after login. Use quick fill on the welcome screen, or:",
              `<br/>Admin user id: <code>${escapeHtml(sc.admin?.userId || "admin")}</code>`,
              `<br/>Teacher (proctor) user id: <code>${escapeHtml(sc.teacher?.userId || "")}</code> — ${escapeHtml(sc.teacher?.displayName || "")}`,
              `<br/>Student user id: <code>${escapeHtml(sc.student?.userId || "")}</code> — ${escapeHtml(sc.student?.displayName || "")}`,
              `<br/>Grade: <code>${escapeHtml(sc.grade || "")}</code>. Lobby is open for testing.`,
              `<br/><span class="hint">${escapeHtml(sc.note || "")}</span>`,
            ].join("");
          }
        }
        await refreshState();
      } catch (e) {
        if (out) out.textContent = e.message || String(e);
        alert(e.message || String(e));
      }
    };
  }
  const seedTrioBtn = $("#btn-seed-trio");
  if (seedTrioBtn) {
    seedTrioBtn.onclick = async () => {
      const out = $("#seed-trio-result");
      try {
        const r = await api("/api/admin/seed-demo-roster?variant=trio", {
          method: "POST",
          body: JSON.stringify({ variant: "trio" }),
        });
        const sc = r.scenario;
        if (out) {
          if (!sc?.students?.length) {
            out.textContent = "Server did not return the trio scenario summary. Check build and try again.";
          } else {
            const ids = sc.students.map((x) => x.userId).join(", ");
            const tids = (sc.teachers || []).map((x) => x.userId).join(", ");
            out.innerHTML = `<strong>Trio loaded.</strong> Students: <code>${escapeHtml(ids)}</code><br/>Teachers: <code>${escapeHtml(tids)}</code><br/><span class="hint">${escapeHtml(sc.note || "")}</span>`;
          }
        }
        await refreshState();
      } catch (e) {
        const el = $("#seed-trio-result");
        if (el) el.textContent = e.message || String(e);
        alert(e.message || String(e));
      }
    };
  }
  $("#btn-upload-questions").onclick = async () => {
    const inp = $("#file-questions");
    if (!inp.files?.[0]) return alert("Choose a question Excel file first.");
    const fd = new FormData();
    fd.append("file", inp.files[0]);
    const label = ($("#q-model-label") && $("#q-model-label").value.trim()) || "";
    if (label) fd.append("modelLabel", label);
    try {
      const r = await apiForm("/api/admin/upload/question-model", fd);
      $("#upload-questions-result").textContent = `Imported ${r.questionCount} questions. Model id: ${r.modelId}`;
      await refreshState();
    } catch (e) {
      alert(e.message);
    }
  };
}

function bindExamWizard() {
  $("#ex-apply-layout").onclick = async () => {
    const gsel = $("#ex-grade");
    if (gsel?.disabled || !$("#ex-grade").value) {
      alert("Upload the student roster first. Grades in the list must come from your Excel Grade column.");
      return;
    }
    await api("/api/admin/exam/apply-layout", {
      method: "POST",
      body: JSON.stringify({
        targetGrade: $("#ex-grade").value,
        roomCount: Number($("#ex-rooms").value),
        lobbyOpensMinutesBefore: Number($("#ex-lobby").value),
        defaultProctorsPerRoom: 1,
      }),
    });
    await refreshState();
  };
  $("#ex-save-core").onclick = async () => {
    const rawDraw = ($("#ex-paper-draw") && $("#ex-paper-draw").value.trim()) || "";
    const paperDrawCount = rawDraw === "" ? null : Number(rawDraw);
    await api("/api/admin/exam/schedule", {
      method: "POST",
      body: JSON.stringify({
        examStartAt: new Date($("#ex-start").value).toISOString(),
        examEndAt: new Date($("#ex-end").value).toISOString(),
        selectedModelId: $("#ex-model").value,
        lobbyOpensMinutesBefore: Number($("#ex-lobby").value),
        paperDrawCount: Number.isFinite(paperDrawCount) && paperDrawCount >= 1 ? paperDrawCount : null,
      }),
    });
    $("#ex-publish-msg").textContent = "Schedule saved.";
    await refreshState();
  };
  $("#ex-save-rooms").onclick = async () => {
    const rooms = [];
    document.querySelectorAll(".room-req").forEach((inp) => {
      rooms.push({ id: inp.getAttribute("data-room"), proctorsRequired: Number(inp.value) });
    });
    await api("/api/admin/exam/rooms-meta", { method: "POST", body: JSON.stringify({ rooms }) });
    await refreshState();
  };
  $("#ex-assign-random").onclick = async () => {
    await api("/api/admin/exam/assign-proctors", { method: "POST", body: JSON.stringify({ mode: "random" }) });
    await refreshState();
  };
  $("#ex-assign-manual").onclick = async () => {
    const assignments = {};
    document.querySelectorAll(".room-msel").forEach((sel) => {
      const rid = sel.getAttribute("data-room");
      const picked = [...sel.selectedOptions].map((o) => o.value);
      assignments[rid] = picked;
    });
    await api("/api/admin/exam/assign-proctors", { method: "POST", body: JSON.stringify({ mode: "manual", assignments }) });
    await refreshState();
  };
  $("#ex-publish").onclick = async () => {
    try {
      await api("/api/admin/exam/publish", { method: "POST" });
      $("#ex-publish-msg").textContent = "Published.";
      await refreshState();
    } catch (e) {
      $("#ex-publish-msg").textContent = e.message;
    }
  };
}

function bindLiveTab() {
  $("#btn-extend").onclick = async () => {
    const minutes = Number($("#live-extend").value);
    await api("/api/admin/exam/extend", { method: "POST", body: JSON.stringify({ minutes }) });
    await refreshState();
  };
  $("#btn-open-lobby").onclick = async () => {
    await api("/api/admin/open-lobby-now", { method: "POST" });
    await refreshState();
    await refreshGateBanner();
  };
}

const LS_ADMIN_ROOM_LAUNCH = "examDemoAdminRoomLaunch";

/** @type {null | (() => void)} */
let adminRoomSocketCleanup = null;

async function refreshAdminRoomMcq(roomId) {
  const hint = $("#admin-room-mcq-hint");
  const body = $("#admin-room-mcq-body");
  if (!hint || !body) return;
  hint.textContent = "Loading…";
  body.innerHTML = "";
  try {
    const g = await api(`/api/admin/room/${encodeURIComponent(roomId)}/mcq-rows`);
    hint.textContent = `Room: ${g.roomLabel} (${g.roomId}).`;
    for (const row of g.rows || []) {
      const tr = document.createElement("tr");
      const pct = row.percent == null ? "—" : `${row.percent}%`;
      const keyed = row.questionsWithKey ?? 0;
      const corr = row.correctCount ?? 0;
      tr.innerHTML = `<td>${escapeHtml(row.fullName)} <span class="hint">(${escapeHtml(row.studentId)})</span></td><td>${corr}</td><td>${keyed}</td><td>${pct}</td>`;
      body.appendChild(tr);
    }
  } catch (e) {
    hint.textContent = e.message || String(e);
  }
}

function closeAdminRoomCommandCenter() {
  const overlay = $("#admin-room-overlay");
  if (!overlay || overlay.classList.contains("hidden")) return;
  adminRoomSocketCleanup?.();
  adminRoomSocketCleanup = null;
  viewerRtcTeardown?.();
  viewerRtcTeardown = null;
  webRtcViewerHandler = null;
  lastCameraViewCtx = null;
  const roomId = overlay.dataset.roomId;
  const s = loadSession();
  if (roomId && s?.userId) {
    socket?.emit("room:leave", { roomId, userId: s.userId, role: "admin" });
  }
  const wall = $("#admin-room-video-wall");
  if (wall) wall.innerHTML = "";
  const log = $("#admin-room-log");
  if (log) log.innerHTML = "";
  overlay.classList.add("hidden");
  overlay.setAttribute("aria-hidden", "true");
  delete overlay.dataset.roomId;
  showTab("live");
}

function openAdminRoomCommandCenter(roomId) {
  adminRoomSocketCleanup?.();
  adminRoomSocketCleanup = null;
  closeAdminRoomCommandCenter();
  const overlay = $("#admin-room-overlay");
  if (!overlay) return;
  const s = loadSession();
  if (!s || s.role !== "admin") {
    alert("Log in as Administration to use the room command center.");
    return;
  }
  overlay.dataset.roomId = roomId;
  overlay.classList.remove("hidden");
  overlay.setAttribute("aria-hidden", "false");

  const titleEl = $("#admin-room-title");
  if (titleEl) titleEl.textContent = `Room command center — ${roomId}`;

  const log = $("#admin-room-log");
  if (log) log.innerHTML = "";
  const wall = $("#admin-room-video-wall");
  if (wall) wall.innerHTML = "";

  socket.emit("room:join", { roomId, userId: s.userId, role: "admin" }, () => {});
  if (wall) void startProctorViewCameras(roomId, s.userId, "admin", wall);

  $("#btn-admin-room-refresh-cam").onclick = () => {
    const w = $("#admin-room-video-wall");
    if (w) void startProctorViewCameras(roomId, s.userId, "admin", w);
  };
  void refreshAdminRoomMcq(roomId);
  $("#btn-admin-room-mcq-refresh").onclick = () => void refreshAdminRoomMcq(roomId);

  $("#btn-admin-room-pm-send").onclick = () => {
    const to = $("#admin-room-pm-to").value.trim();
    const text = $("#admin-room-pm-text").value.trim();
    if (!to || !text) return;
    socket.emit("chat:private", { fromUserId: s.userId, toUserId: to, text, roomId });
    $("#admin-room-pm-text").value = "";
    if (log) {
      const line = document.createElement("div");
      line.textContent = `[private] you → ${to}: ${text}`;
      log.prepend(line);
    }
  };

  const onRoster = (p) => {
    if (p.roomId !== roomId || !log) return;
    const line = document.createElement("div");
    line.textContent = `[roster] ${p.event}: ${p.displayName} (${p.role})`;
    log.prepend(line);
  };
  const onInt = (ev) => {
    if (ev.roomId !== roomId || !log) return;
    const line = document.createElement("div");
    line.textContent = `[integrity] ${ev.studentId || ""} ${ev.type}: ${ev.detail}`;
    log.prepend(line);
  };
  socket.on("room:roster", onRoster);
  socket.on("integrity:event", onInt);

  adminRoomSocketCleanup = () => {
    socket.off("room:roster", onRoster);
    socket.off("integrity:event", onInt);
  };

  $("#btn-admin-room-back").onclick = () => closeAdminRoomCommandCenter();
}

function openObserve(roomId) {
  const s = loadSession();
  if (!s || s.role !== "admin") {
    alert("Log in as Administration first, then open Live control.");
    return;
  }
  try {
    localStorage.setItem(
      LS_ADMIN_ROOM_LAUNCH,
      JSON.stringify({
        role: s.role,
        userId: s.userId,
        displayName: s.displayName || s.userId,
        exp: Date.now() + 180000,
      })
    );
  } catch (e) {
    console.warn(e);
    openAdminRoomCommandCenter(roomId);
    return;
  }
  const u = new URL(window.location.href);
  u.searchParams.set("admin_room", roomId);
  const win = window.open(u.toString(), "_blank", "noopener,noreferrer");
  if (!win) openAdminRoomCommandCenter(roomId);
}

async function maybeBootstrapAdminRoomTab() {
  const params = new URLSearchParams(window.location.search);
  const room = params.get("admin_room");
  if (!room) return false;
  let raw;
  try {
    raw = localStorage.getItem(LS_ADMIN_ROOM_LAUNCH);
  } catch {
    return false;
  }
  if (!raw) {
    try {
      history.replaceState({}, "", window.location.pathname);
    } catch {
      /* ignore */
    }
    return false;
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    localStorage.removeItem(LS_ADMIN_ROOM_LAUNCH);
    history.replaceState({}, "", window.location.pathname);
    return false;
  }
  if (Date.now() > data.exp || data.role !== "admin") {
    localStorage.removeItem(LS_ADMIN_ROOM_LAUNCH);
    history.replaceState({}, "", window.location.pathname);
    return false;
  }
  localStorage.removeItem(LS_ADMIN_ROOM_LAUNCH);
  try {
    history.replaceState({}, "", window.location.pathname);
  } catch {
    /* ignore */
  }
  $("#role").value = "admin";
  $("#userId").value = data.userId;
  $("#displayName").value = data.displayName || "Administration";
  syncUserIdLabel();
  await enterApp();
  openAdminRoomCommandCenter(room);
  return true;
}

async function refreshProctorMcqScores() {
  const s = loadSession();
  if (!s || s.role !== "proctor") return;
  const hint = $("#proctor-mcq-grade-hint");
  const body = $("#proctor-mcq-grade-body");
  if (!hint || !body) return;
  hint.textContent = "Loading…";
  body.innerHTML = "";
  try {
    const g = await api(`/api/proctor/${encodeURIComponent(s.userId)}/auto-grade-room`);
    hint.textContent = `Room: ${g.roomLabel} (${g.roomId}).`;
    for (const row of g.rows || []) {
      const tr = document.createElement("tr");
      const pct = row.percent == null ? "—" : `${row.percent}%`;
      const keyed = row.questionsWithKey ?? 0;
      const corr = row.correctCount ?? 0;
      tr.innerHTML = `<td>${escapeHtml(row.fullName)} <span class="hint">(${escapeHtml(row.studentId)})</span></td><td>${corr}</td><td>${keyed}</td><td>${pct}</td>`;
      body.appendChild(tr);
    }
  } catch (e) {
    hint.textContent = e.message || String(e);
  }
}

function bindProctor() {
  $("#btn-proctor-mcq-refresh")?.addEventListener("click", () => void refreshProctorMcqScores());

  $("#btn-proctor-refresh-cam")?.addEventListener("click", () => {
    const c = lastCameraViewCtx;
    if (c?.container) void startProctorViewCameras(c.roomId, c.viewerUserId, c.role, c.container);
  });

  $("#btn-proctor-join").onclick = async () => {
    const s = loadSession();
    viewerRtcTeardown?.();
    viewerRtcTeardown = null;
    webRtcViewerHandler = null;
    let gate;
    try {
      gate = await api(`/api/gate?role=proctor&userId=${encodeURIComponent(s.userId)}`);
    } catch {
      $("#proctor-gate-line").textContent = "Could not read access rules.";
      $("#proctor-cam-section")?.classList.add("hidden");
      return;
    }
    if (!gate.allowed) {
      $("#proctor-gate-line").textContent = "You cannot join yet. See the banner above.";
      $("#proctor-help-wrap").classList.add("hidden");
      $("#proctor-cam-section")?.classList.add("hidden");
      return;
    }
    let place;
    try {
      place = await api(`/api/proctor/${encodeURIComponent(s.userId)}/room`);
    } catch (e) {
      $("#proctor-gate-line").textContent = e.message;
      $("#proctor-cam-section")?.classList.add("hidden");
      return;
    }
    proctorRoomId = place.roomId;
    socket.emit("room:join", { roomId: place.roomId, userId: s.userId, role: "proctor" }, () => {});
    $("#proctor-status").textContent = `Joined ${place.roomName} (${place.roomId})`;
    $("#proctor-gate-line").textContent = "You are in the live window. Students can also enter now.";
    $("#proctor-help-wrap").classList.remove("hidden");
    const camSection = $("#proctor-cam-section");
    const camWall = $("#proctor-video-wall");
    if (camSection) camSection.classList.remove("hidden");
    if (camWall) void startProctorViewCameras(place.roomId, s.userId, "proctor", camWall);

    const log = $("#proctor-chat-log");
    log.innerHTML = "";
    socket.off("chat:private");
    socket.off("integrity:event");
    socket.on("chat:private", (msg) => {
      const line = document.createElement("div");
      line.textContent = `[private] ${msg.fromUserId} to ${msg.toUserId}: ${msg.text}`;
      log.prepend(line);
    });
    socket.on("integrity:event", (ev) => {
      if (ev.roomId !== place.roomId) return;
      const line = document.createElement("div");
      line.textContent = `[flag] ${ev.studentId || ""}: ${ev.type}`;
      log.prepend(line);
    });

    $("#btn-send-private").onclick = () => {
      const to = $("#pm-to").value.trim();
      const text = $("#pm-text").value.trim();
      if (!to || !text) return;
      socket.emit("chat:private", { fromUserId: s.userId, toUserId: to, text, roomId: place.roomId });
      $("#pm-text").value = "";
    };

    $("#btn-proctor-help").onclick = () => {
      socket.emit("incident:raise", {
        roomId: place.roomId,
        staffId: s.userId,
        message: "Proctor requested administration support in the exam room.",
        note: "Any issue type (technical or other). Please respond.",
      });
    };

    void refreshProctorMcqScores();
  };

  const tqInp = $("#file-teacher-questions");
  const tqBtn = $("#btn-teacher-upload-questions");
  if (tqBtn && tqInp) {
    tqBtn.onclick = async () => {
      const s = loadSession();
      if (!s || s.role !== "proctor") {
        alert("Log in as Teacher / proctor first, then open this tab again.");
        return;
      }
      if (!tqInp.files?.[0]) return alert("Choose a question Excel file first.");
      const fd = new FormData();
      fd.append("file", tqInp.files[0]);
      fd.append("staffId", s.userId);
      const labEl = $("#teacher-q-model-label");
      const label = (labEl && labEl.value.trim()) || "";
      if (label) fd.append("modelLabel", label);
      try {
        const r = await apiForm("/api/admin/upload/question-model", fd);
        const msg = $("#teacher-upload-questions-result");
        if (msg) msg.textContent = `Uploaded ${r.questionCount} questions. Model id: ${r.modelId}. Administration should confirm the selected model in Create exam if needed.`;
        tqInp.value = "";
      } catch (e) {
        alert(e.message);
      }
    };
  }
}

function stopIntegrity() {
  if (integrityTimer) clearInterval(integrityTimer);
  integrityTimer = null;
  lastFrameSig = null;
  if (audioCtx) {
    try {
      audioCtx.close();
    } catch {}
    audioCtx = null;
  }
  integrityAnalyser = null;
  integrityAudioData = null;
}

function startIntegrity(roomId, studentId, videoEl) {
  stopIntegrity();
  const canvas = document.createElement("canvas");
  const c = canvas.getContext("2d", { willReadFrequently: true });
  const w = 48;
  const h = 36;
  canvas.width = w;
  canvas.height = h;
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const src = audioCtx.createMediaStreamSource(videoEl.srcObject);
    integrityAnalyser = audioCtx.createAnalyser();
    integrityAnalyser.fftSize = 512;
    src.connect(integrityAnalyser);
    integrityAudioData = new Uint8Array(integrityAnalyser.frequencyBinCount);
  } catch {
    integrityAnalyser = null;
    integrityAudioData = null;
  }
  integrityTimer = setInterval(() => {
    if (!videoEl.videoWidth) return;
    c.drawImage(videoEl, 0, 0, w, h);
    const img = c.getImageData(0, 0, w, h).data;
    let sum = 0;
    for (let i = 0; i < img.length; i += 4) sum += img[i] + img[i + 1] + img[i + 2];
    const sig = (sum / (w * h)).toFixed(1);
    if (lastFrameSig != null) {
      const delta = Math.abs(Number(sig) - Number(lastFrameSig));
      if (delta > 8) {
        socket?.emit("integrity:signal", {
          roomId,
          studentId,
          type: "motion_heuristic",
          score: delta,
          note: "Large frame change (demo)",
        });
      }
    }
    lastFrameSig = sig;
    if (integrityAnalyser && integrityAudioData) {
      integrityAnalyser.getByteTimeDomainData(integrityAudioData);
      let s2 = 0;
      for (let i = 0; i < integrityAudioData.length; i++) {
        const v = (integrityAudioData[i] - 128) / 128;
        s2 += v * v;
      }
      const rms = Math.sqrt(s2 / integrityAudioData.length);
      if (rms > 0.22) {
        socket?.emit("integrity:signal", {
          roomId,
          studentId,
          type: "audio_activity",
          score: rms,
          note: "Higher mic level (demo)",
        });
      }
    }
  }, 2000);
}

async function loadStudentIntegrityPolicy() {
  const loading = $("#student-policy-loading");
  const body = $("#student-policy-body");
  const titleEl = $("#student-policy-title");
  if (!loading || !body) return;
  loading.classList.remove("hidden");
  loading.textContent = "Loading policy…";
  body.classList.add("hidden");
  body.innerHTML = "";
  try {
    const p = await api("/api/exam/integrity-policy");
    if (titleEl && p.title) titleEl.textContent = p.title;
    loading.classList.add("hidden");
    body.classList.remove("hidden");
    const intro = document.createElement("p");
    intro.className = "hint";
    intro.textContent = p.intro || "";
    const ul = document.createElement("ul");
    ul.style.margin = "0.5rem 0 0";
    ul.style.paddingLeft = "1.25rem";
    (p.bullets || []).forEach((b) => {
      const li = document.createElement("li");
      li.textContent = b;
      ul.appendChild(li);
    });
    body.appendChild(intro);
    body.appendChild(ul);
    const fb = document.createElement("p");
    fb.className = "hint";
    fb.style.marginTop = "0.65rem";
    fb.textContent = p.feedbackAfterExam || "";
    body.appendChild(fb);
  } catch (e) {
    loading.textContent = e.message || String(e);
  }
}

function bindStudent() {
  $("#btn-consent").onclick = async () => {
    const v = $("#student-video");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      v.srcObject = stream;
      $("#consent-modal").classList.add("hidden");
      $("#student-after-consent").classList.remove("hidden");
      const hc = $("#honesty-check");
      const btn = $("#btn-enter-exam");
      if (hc) hc.checked = false;
      if (btn) btn.disabled = true;
      void loadStudentIntegrityPolicy();
    } catch (e) {
      alert("Camera and microphone are required. " + (e?.message || ""));
    }
  };

  $("#honesty-check")?.addEventListener("change", () => {
    const btn = $("#btn-enter-exam");
    const hc = $("#honesty-check");
    if (btn && hc) btn.disabled = !hc.checked;
  });

  $("#btn-enter-exam").onclick = async () => {
    const s = loadSession();
    const sid = s.userId;
    const hc = $("#honesty-check");
    if (!hc?.checked) {
      alert("Please tick the box to confirm you have read the rules.");
      return;
    }
    try {
      await api(`/api/student/${encodeURIComponent(sid)}/acknowledge-honesty`, {
        method: "POST",
        body: JSON.stringify({ accepted: true }),
      });
    } catch (e) {
      alert(e.message || String(e));
      return;
    }
    let gate;
    try {
      gate = await api(`/api/gate?role=student&userId=${encodeURIComponent(sid)}`);
    } catch {
      $("#student-gate-line").textContent = "Could not verify access.";
      return;
    }
    if (!gate.allowed) {
      $("#student-gate-line").textContent = "The exam link is not open for students yet. See the banner at the top.";
      return;
    }
    let place;
    try {
      place = await api(`/api/student/${encodeURIComponent(sid)}/room`);
    } catch (e) {
      $("#student-gate-line").textContent = e.message;
      return;
    }
    $("#student-room-label").textContent = `${place.roomName} (${place.roomId})`;
    $("#student-gate-line").textContent = "You may take the paper now.";
    socket.emit("room:join", { roomId: place.roomId, userId: sid, role: "student" }, () => {});

    const v = $("#student-video");
    startIntegrity(place.roomId, sid, v);
    try {
      if (audioCtx?.state === "suspended") await audioCtx.resume();
    } catch {}

    studentWebRtcStop?.();
    studentWebRtcStop = null;
    if (v.srcObject) {
      studentWebRtcStop = startStudentWebRtcPublisher(place.roomId, sid, v.srcObject);
    }

    let paperMeta;
    try {
      paperMeta = await api(`/api/student/${encodeURIComponent(sid)}/paper`);
    } catch (e) {
      alert(e.message);
      return;
    }

    let currentStep;
    try {
      currentStep = await api(`/api/student/${encodeURIComponent(sid)}/exam-current`);
    } catch (e) {
      alert(e.message);
      return;
    }

    if (studentExamCountdown) {
      clearInterval(studentExamCountdown);
      studentExamCountdown = null;
    }
    const mcqResultEl = $("#student-mcq-result");
    if (mcqResultEl) {
      mcqResultEl.classList.add("hidden");
      mcqResultEl.innerHTML = "";
    }

    const area = $("#exam-area");
    area.innerHTML = "";
    const endMs = new Date(paperMeta.examEndAt).getTime();
    const timer = document.createElement("p");
    timer.className = "hint";
    area.appendChild(timer);
    let mcqSummaryRequested = false;
    const fetchStudentMcqSummary = async () => {
      if (mcqSummaryRequested) return;
      mcqSummaryRequested = true;
      const el = $("#student-mcq-result");
      if (!el) return;
      try {
        const r = await api(`/api/student/${encodeURIComponent(sid)}/mcq-score`);
        el.classList.remove("hidden");
        if (!r.questionsWithKey) {
          el.innerHTML =
            '<p class="hint"><strong>MCQ result:</strong> The current paper has no keyed items for automatic scoring in this demo.</p>';
        } else {
          el.innerHTML = `<p class="hint"><strong>Your MCQ result (automatic):</strong> ${r.correctCount} correct out of ${r.questionsWithKey} keyed questions (${r.percent}%).</p>`;
        }
        if (r.feedbackHint) {
          const p2 = document.createElement("p");
          p2.className = "hint";
          p2.style.marginTop = "0.5rem";
          p2.textContent = r.feedbackHint;
          el.appendChild(p2);
        }
      } catch (e) {
        el.classList.remove("hidden");
        el.innerHTML = `<p class="hint">${escapeHtml(e.message || String(e))}</p>`;
      }
    };
    const tick = () => {
      const now = Date.now();
      const left = Math.max(0, endMs - now);
      const m = Math.floor(left / 60000);
      const sec = Math.floor((left % 60000) / 1000);
      timer.textContent = `Time left until scheduled end: ${m}m ${sec}s`;
      if (left <= 0) {
        stopIntegrity();
        studentWebRtcStop?.();
        studentWebRtcStop = null;
        if (studentExamCountdown) {
          clearInterval(studentExamCountdown);
          studentExamCountdown = null;
        }
        void fetchStudentMcqSummary();
      }
    };
    tick();
    studentExamCountdown = setInterval(tick, 1000);

    $("#btn-student-pm").onclick = () => {
      const to = $("#student-pm-to").value.trim();
      const text = $("#student-pm-body").value.trim();
      if (!to || !text) return;
      socket.emit("chat:private", { fromUserId: sid, toUserId: to, text, roomId: place.roomId });
      $("#student-pm-body").value = "";
    };

    const renderQuestionStep = (step) => {
      while (area.children.length > 1) {
        area.removeChild(area.lastChild);
      }
      if (step.completed) {
        const done = document.createElement("p");
        done.className = "hint";
        done.innerHTML = step.leftRoom
          ? "<strong>Exam complete.</strong> You submitted every question, left the exam room, and your camera and microphone are stopped. The timer above still runs until the scheduled end; then your MCQ summary may unlock below (if the paper has a key)."
          : "<strong>Exam complete.</strong> You have finished this attempt and submitted every question. When the countdown reaches zero, your automatic MCQ summary may unlock below (if the paper has a key).";
        area.appendChild(done);
        return;
      }
      const isLast = step.total > 0 && step.index === step.total - 1;
      const prog = document.createElement("p");
      prog.className = "hint";
      prog.innerHTML = isLast
        ? `Final question (${step.index + 1} of ${step.total}). Choose one answer, then press <strong>Finish exam</strong> to end your attempt.`
        : `Question ${step.index + 1} of ${step.total}. Choose one answer, then press <strong>Submit answer</strong> for the next question.`;
      area.appendChild(prog);
      const q = step.question;
      const box = document.createElement("div");
      box.className = "question panel";
      const p = document.createElement("p");
      p.textContent = q.text;
      box.appendChild(p);
      let selected = null;
      const submitBtn = document.createElement("button");
      submitBtn.type = "button";
      submitBtn.textContent = isLast ? "Finish exam" : "Submit answer";
      submitBtn.setAttribute("aria-label", isLast ? "Finish exam and submit your final answer" : "Submit answer and go to next question");
      submitBtn.disabled = true;
      q.choices.forEach((ch, ci) => {
        const lab = document.createElement("label");
        const inp = document.createElement("input");
        inp.type = "radio";
        inp.name = "seq-mcq-current";
        inp.addEventListener("change", () => {
          selected = ci;
          submitBtn.disabled = false;
        });
        lab.appendChild(inp);
        lab.appendChild(document.createTextNode(ch));
        box.appendChild(lab);
      });
      const submitRow = document.createElement("div");
      submitRow.className = "row";
      submitRow.style.marginTop = "0.75rem";
      submitBtn.onclick = async () => {
        if (selected == null) return;
        if (isLast) {
          const ok = window.confirm(
            "Are you sure you want to finish the exam? Your answers will be submitted, your camera and microphone will stop, and you will leave the exam room."
          );
          if (!ok) return;
        }
        submitBtn.disabled = true;
        try {
          const next = await api(`/api/student/${encodeURIComponent(sid)}/exam-submit`, {
            method: "POST",
            body: JSON.stringify({ questionId: q.id, choiceIndex: selected }),
          });
          if (next.completed) {
            stopIntegrity();
            studentWebRtcStop?.();
            studentWebRtcStop = null;
            try {
              const stream = v.srcObject;
              if (stream?.getTracks) stream.getTracks().forEach((tr) => tr.stop());
              v.srcObject = null;
            } catch {
              /* ignore */
            }
            socket?.emit("room:leave", { roomId: place.roomId, userId: sid, role: "student" });
            renderQuestionStep({ completed: true, total: next.total, leftRoom: true });
          } else {
            renderQuestionStep({ ...next, completed: false });
          }
        } catch (e) {
          alert(e.message || String(e));
          submitBtn.disabled = false;
        }
      };
      submitRow.appendChild(submitBtn);
      box.appendChild(submitRow);
      area.appendChild(box);
    };

    renderQuestionStep(currentStep);
  };
}

document.addEventListener("DOMContentLoaded", async () => {
  bindConnectionPanel();
  probeBackendOnce();
  setInterval(() => probeBackendOnce(), 60000);

  $("#btn-fill-admin")?.addEventListener("click", () => {
    $("#role").value = "admin";
    $("#userId").value = "admin";
    $("#displayName").value = "Administration";
    syncUserIdLabel();
  });
  $("#btn-fill-student-trial")?.addEventListener("click", () => {
    $("#role").value = "student";
    $("#userId").value = "D50435";
    $("#displayName").value = "Hala Mohammad Omar Shaban";
    syncUserIdLabel();
  });
  $("#btn-fill-teacher-trial")?.addEventListener("click", () => {
    $("#role").value = "proctor";
    $("#userId").value = "AIS-ROJAN";
    $("#displayName").value = "Rojan Adnan Hasan";
    syncUserIdLabel();
  });

  $("#btn-login").addEventListener("click", enterApp);
  $("#btn-logout").addEventListener("click", logout);
  document.querySelectorAll("[data-tabbtn]").forEach((btn) => {
    btn.addEventListener("click", () => showTab(btn.getAttribute("data-tabbtn")));
  });
  bindAdminUploads();
  bindExamWizard();
  bindLiveTab();
  bindProctor();
  bindStudent();
  const booted = await maybeBootstrapAdminRoomTab();
  if (!booted) renderLogin();
});

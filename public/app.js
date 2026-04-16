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
/** @type {ReturnType<typeof setInterval> | null} */
let proctorWaitlistTimer = null;
/** @type {ReturnType<typeof setInterval> | null} */
let studentEntryPollTimer = null;
/** @type {null | (() => void)} */
let studentTabVisibilityCleanup = null;
/** @type {null | (() => void)} */
let studentExamLeaveGuardCleanup = null;
/** @type {ReturnType<typeof setInterval> | null} */
let studentRevokePollTimer = null;

/** Exam UI is inside #view-app but #main-content is the parent — both need a class for full-width CSS. */
function setStudentExamFullBleed(active) {
  $("#view-app")?.classList.toggle("student-exam-layout-active", !!active);
  $("#main-content")?.classList.toggle("student-exam-main-bleed", !!active);
}

/** Proctor desk: same pattern as student — do not rely on :has() for main width (browser / cache issues). */
function setProctorDeskFullBleed(active) {
  $("#view-app")?.classList.toggle("proctor-desk-layout-active", !!active);
  $("#main-content")?.classList.toggle("proctor-desk-main-bleed", !!active);
  $("#proctor-header-context")?.classList.toggle("hidden", !active);
  document.querySelector(".app-header")?.classList.toggle("app-header--proctor", !!active);
}

function restoreStudentVideoHome() {
  const pip = $("#student-exam-pip-slot");
  const home = $("#student-video-home");
  const wrap = pip?.querySelector(".video-wrap") || home?.querySelector(".video-wrap");
  if (home && wrap) home.appendChild(wrap);
  const hint = $("#student-camera-hint");
  if (hint) hint.classList.remove("hidden");
}

function moveStudentVideoToPip() {
  const pip = $("#student-exam-pip-slot");
  const home = $("#student-video-home");
  const wrap = home?.querySelector(".video-wrap");
  if (pip && wrap) pip.appendChild(wrap);
  const hint = $("#student-camera-hint");
  if (hint) hint.classList.add("hidden");
}

async function finalizeStudentExamRevokedUi(studentId, place) {
  if (studentExamCountdown) {
    clearInterval(studentExamCountdown);
    studentExamCountdown = null;
  }
  stopIntegrity();
  try {
    socket?.emit("room:leave", { roomId: place.roomId, userId: studentId, role: "student" });
  } catch {
    /* ignore */
  }
  studentTabVisibilityCleanup?.();
  studentWebRtcStop?.();
  studentWebRtcStop = null;
  const v = $("#student-video");
  try {
    const stream = v?.srcObject;
    if (stream?.getTracks) stream.getTracks().forEach((tr) => tr.stop());
    if (v) v.srcObject = null;
  } catch {
    /* ignore */
  }
  restoreStudentVideoHome();
  $("#student-exam-lock-modal")?.classList.add("hidden");
  $("#student-exam-workspace")?.classList.add("hidden");
  $("#student-wait-lounge")?.classList.add("hidden");
  $("#student-preexam-block")?.classList.remove("hidden");
  $("#student-exam-ended-overlay")?.classList.remove("hidden");
  setStudentExamFullBleed(false);
  $("#student-desk-chrome")?.classList.remove("hidden");
  const tb = $("#student-exam-timer-bar");
  if (tb) tb.innerHTML = "";
}

function attachStudentExamLeaveProtection(studentId, place) {
  studentExamLeaveGuardCleanup?.();
  if (studentRevokePollTimer) {
    clearInterval(studentRevokePollTimer);
    studentRevokePollTimer = null;
  }
  let active = true;
  const beforeUnload = (e) => {
    e.preventDefault();
    e.returnValue = "";
  };
  const pageHide = (ev) => {
    if (!active || ev.persisted) return;
    try {
      void fetch(apiUrl(`/api/student/${encodeURIComponent(studentId)}/exam-revoke`), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...studentExamKeyHeaders() },
        body: JSON.stringify({ reason: "leave_or_close" }),
        keepalive: true,
      });
    } catch {
      /* ignore */
    }
  };
  window.addEventListener("beforeunload", beforeUnload);
  window.addEventListener("pagehide", pageHide);

  const stopPoll = () => {
    if (studentRevokePollTimer) {
      clearInterval(studentRevokePollTimer);
      studentRevokePollTimer = null;
    }
  };

  studentRevokePollTimer = setInterval(async () => {
    try {
      const st = await api(`/api/student/${encodeURIComponent(studentId)}/entry-status`);
      if (st.examRevoked) {
        stopPoll();
        active = false;
        window.removeEventListener("beforeunload", beforeUnload);
        window.removeEventListener("pagehide", pageHide);
        studentExamLeaveGuardCleanup = null;
        await finalizeStudentExamRevokedUi(studentId, place);
      }
    } catch {
      /* ignore */
    }
  }, 3500);

  studentExamLeaveGuardCleanup = () => {
    active = false;
    stopPoll();
    window.removeEventListener("beforeunload", beforeUnload);
    window.removeEventListener("pagehide", pageHide);
    studentExamLeaveGuardCleanup = null;
  };
}

function showStudentExamLockGateModal() {
  const modal = $("#student-exam-lock-modal");
  const btn = $("#btn-student-exam-lock-continue");
  if (!modal || !btn) return Promise.resolve();
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
  return new Promise((resolve) => {
    const onContinue = () => {
      modal.classList.add("hidden");
      modal.setAttribute("aria-hidden", "true");
      btn.removeEventListener("click", onContinue);
      resolve();
    };
    btn.addEventListener("click", onContinue);
  });
}

function setupStudentTabVisibilityWatch(roomId, studentId) {
  studentTabVisibilityCleanup?.();
  const onVis = () => {
    if (document.visibilityState === "hidden") {
      try {
        socket?.emit("exam:visibility", { roomId, studentId, hidden: true });
      } catch {
        /* ignore */
      }
    }
  };
  document.addEventListener("visibilitychange", onVis);
  studentTabVisibilityCleanup = () => {
    document.removeEventListener("visibilitychange", onVis);
    studentTabVisibilityCleanup = null;
  };
}

function clearProctorWaitlistPoll() {
  if (proctorWaitlistTimer) {
    clearInterval(proctorWaitlistTimer);
    proctorWaitlistTimer = null;
  }
}

function clearStudentEntryPollTimer() {
  if (studentEntryPollTimer) {
    clearInterval(studentEntryPollTimer);
    studentEntryPollTimer = null;
  }
}

let webRtcIceServers = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
  { urls: "stun:global.stun.twilio.com:3478" },
];

/** @type {Promise<void> | null} */
let webRtcIceHydratePromise = null;

function getWebRtcIceServers() {
  return webRtcIceServers;
}

async function hydrateWebRtcIceServers() {
  if (webRtcIceHydratePromise) return webRtcIceHydratePromise;
  webRtcIceHydratePromise = (async () => {
    try {
      const r = await fetch(apiUrl("/api/webrtc/ice"), { cache: "no-store" });
      if (!r.ok) return;
      const j = await r.json();
      if (j && Array.isArray(j.iceServers) && j.iceServers.length) {
        webRtcIceServers = j.iceServers;
      }
    } catch {
      /* keep defaults */
    }
  })();
  return webRtcIceHydratePromise;
}

/** @type {null | ((msg: any) => void)} */
let webRtcStudentHandler = null;
/** @type {null | ((msg: any) => void)} */
let webRtcViewerHandler = null;
/** @type {null | (() => void)} */
let studentWebRtcStop = null;
/** @type {null | (() => void)} */
let viewerRtcTeardown = null;

/** Proctor microphone (shared) for push-to-talk toward students. */
let proctorMicMediaStream = null;

async function ensureProctorMicMediaStream() {
  const t = proctorMicMediaStream?.getAudioTracks?.()[0];
  if (t && t.readyState === "live") return proctorMicMediaStream;
  proctorMicMediaStream = await navigator.mediaDevices.getUserMedia({
    audio: voiceAudioConstraints(),
    video: false,
  });
  return proctorMicMediaStream;
}

function stopProctorMicMediaStream() {
  if (!proctorMicMediaStream) return;
  try {
    proctorMicMediaStream.getTracks().forEach((tr) => tr.stop());
  } catch {
    /* ignore */
  }
  proctorMicMediaStream = null;
}

/**
 * Student pre-exam camera/mic — try relaxed constraints so one failing device
 * (often mic) does not block the whole stream.
 * @returns {Promise<MediaStream>}
 */
async function acquireStudentExamMedia() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("This browser does not support camera access (getUserMedia).");
  }
  const va = voiceAudioConstraints();
  const attempts = [
    { video: true, audio: va },
    { video: { facingMode: "user" }, audio: va },
    { video: true, audio: false },
    { video: { facingMode: "user" }, audio: false },
  ];
  let lastErr = null;
  for (const constraints of attempts) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      if (!constraints.audio) {
        try {
          const audioOnly = await navigator.mediaDevices.getUserMedia({ audio: voiceAudioConstraints(), video: false });
          audioOnly.getAudioTracks().forEach((t) => stream.addTrack(t));
        } catch {
          /* optional mic when video-only succeeded */
        }
      }
      return stream;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error("Could not access camera or microphone.");
}

function requestPlayStudentProctorVoice(au) {
  const p = au.play();
  if (!p || typeof p.then !== "function") return;
  p.catch(() => {
    if (au.dataset.proctorVoiceUnlock === "1") return;
    au.dataset.proctorVoiceUnlock = "1";
    const unlock = () => {
      void au.play().catch(() => {});
    };
    document.body.addEventListener("click", unlock, { once: true, capture: true });
    document.body.addEventListener("touchstart", unlock, { once: true, capture: true });
  });
}

/** @type {null | (() => void)} */
let proctorCamViewportResizeHandler = null;
/** @type {ReturnType<typeof setTimeout> | null} */
let proctorCamViewportResizeTimer = null;

/** @type {{ roomId: string, viewerUserId: string, role: string, container: HTMLElement } | null} */
let lastCameraViewCtx = null;

const LS_API_ORIGIN = "examDemoApiOrigin";
const LS_EXAM_ACCESS_KEY = "examDemoAccessKey";
/** Same value the server sets for DMES trial (`runSeedDmesTrialScenario`). */
const DMES_TRIAL_EXAM_ACCESS_KEY = "12345";

function liveAccessKeyStatusHint() {
  if (!stateCache || typeof stateCache.requiresExamAccessKey !== "boolean") return "";
  if (stateCache.requiresExamAccessKey) {
    return "Enabled on the server — students must enter the same key on the login screen.";
  }
  return "Not enabled right now — exam access key is optional.";
}

function paintLiveAccessKeyMsg() {
  const akMsg = $("#live-access-key-msg");
  if (!akMsg) return;
  akMsg.textContent = liveAccessKeyStatusHint();
}

function studentExamKeyHeaders() {
  try {
    const s = loadSession();
    if (!s || s.role !== "student") return {};
    const k = localStorage.getItem(LS_EXAM_ACCESS_KEY);
    if (!k || !String(k).trim()) return {};
    return { "X-Exam-Access-Key": String(k).trim() };
  } catch {
    return {};
  }
}

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
    if (j && typeof j.error === "string" && j.error) {
      if (j.message && typeof j.message === "string") throw new Error(`${j.message} (${j.error})`);
      throw new Error(j.error);
    }
    if (j && typeof j.message === "string" && j.message) throw new Error(j.message);
  } catch (e) {
    if (!(e instanceof SyntaxError)) throw e;
  }
  throw new Error(friendlyHttpError(r.status, t));
}

async function api(path, opts = {}) {
  const url = apiUrl(path);
  const { headers: hdr, ...rest } = opts;
  let r;
  try {
    r = await fetch(url, {
      ...rest,
      cache: "no-store",
      headers: { "Content-Type": "application/json", ...studentExamKeyHeaders(), ...(hdr || {}) },
    });
  } catch (e) {
    const msg =
      e instanceof TypeError
        ? "Network error: could not reach the server. Check connection and Server URL, then try again."
        : e?.message || String(e);
    // eslint-disable-next-line no-console
    console.warn("[api]", path, e);
    throw new Error(msg);
  }
  if (!r.ok) {
    const t = await r.text();
    throwFromErrorBody(r, t);
  }
  return r.json();
}

async function apiDelete(path) {
  const url = apiUrl(path);
  let r;
  try {
    r = await fetch(url, { method: "DELETE", cache: "no-store", headers: { ...studentExamKeyHeaders() } });
  } catch (e) {
    throw new Error(e instanceof TypeError ? "Network error (delete)." : e?.message || String(e));
  }
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

/** Voice-oriented mic capture (mono + processing + higher sample rate when supported). */
function voiceAudioConstraints() {
  return {
    channelCount: { ideal: 1 },
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    sampleRate: { ideal: 48000 },
  };
}

/**
 * Raise Opus voice bitrate on audio senders after negotiation (reduces “muddy” / thin sound on good links).
 * @param {RTCPeerConnection} pc
 */
function tuneAudioRtpSenders(pc) {
  if (!pc) return;
  for (const sender of pc.getSenders()) {
    if (sender.track?.kind !== "audio") continue;
    try {
      const p = sender.getParameters();
      const enc = p.encodings && p.encodings.length ? p.encodings.map((e) => ({ ...e })) : [{}];
      enc[0] = { ...enc[0], maxBitrate: 96000 };
      void sender.setParameters({ ...p, encodings: enc }).catch(() => {});
    } catch {
      /* ignore */
    }
  }
}

/**
 * Student publishes camera/mic to each proctor or admin viewer that sends an offer.
 * @returns {() => void}
 */
function wireStudentProctorVoicePlayback(pc) {
  pc.ontrack = (ev) => {
    if (ev.track.kind !== "audio") return;
    try {
      ev.track.enabled = true;
    } catch {
      /* ignore */
    }
    let au = document.getElementById("student-proctor-voice-audio");
    if (!au) {
      au = document.createElement("audio");
      au.id = "student-proctor-voice-audio";
      au.autoplay = true;
      au.setAttribute("playsinline", "");
      document.body.appendChild(au);
    }
    try {
      au.volume = 1;
    } catch {
      /* ignore */
    }
    try {
      au.srcObject = ev.streams[0];
      requestPlayStudentProctorVoice(au);
    } catch {
      /* ignore */
    }
  };
}

function startStudentWebRtcPublisher(roomId, studentId, stream) {
  const peers = new Map();

  webRtcStudentHandler = async (msg) => {
    if (!msg || msg.roomId !== roomId) return;
    const viewerId = msg.fromUserId;
    if (!viewerId || viewerId === studentId) return;

    if (msg.type === "offer" && msg.sdp) {
      const existing = peers.get(viewerId);
      if (existing && existing.signalingState === "stable" && existing.localDescription && existing.remoteDescription) {
        try {
          await existing.setRemoteDescription({ type: "offer", sdp: msg.sdp });
          const answer = await existing.createAnswer();
          await existing.setLocalDescription(answer);
          tuneAudioRtpSenders(existing);
          socket.emit("webrtc:relay", { toUserId: viewerId, roomId, type: "answer", sdp: answer.sdp });
        } catch (e) {
          console.warn("student webrtc renegotiation failed", e);
        }
        return;
      }
      if (existing) {
        try {
          existing.close();
        } catch {
          /* ignore */
        }
        peers.delete(viewerId);
      }
      const pc = new RTCPeerConnection({ iceServers: getWebRtcIceServers() });
      peers.set(viewerId, pc);
      wireStudentProctorVoicePlayback(pc);
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));
      relayIceCandidate(viewerId, roomId, pc);
      await pc.setRemoteDescription({ type: "offer", sdp: msg.sdp });
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      tuneAudioRtpSenders(pc);
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
    const au = document.getElementById("student-proctor-voice-audio");
    if (au) {
      try {
        au.srcObject = null;
        au.remove();
      } catch {
        /* ignore */
      }
    }
  };
}

function findVideoTile(container, studentId) {
  for (const el of container.querySelectorAll(".video-tile")) {
    if (el.dataset.student === studentId) return el;
  }
  return null;
}

/**
 * Grid columns from the **actual** number of camera tiles (10, 11, 12, …), not the admin policy cap.
 * Uses documentElement.clientWidth (not window.innerWidth / matchMedia) so a vertical scrollbar
 * does not flip breakpoints and re-layout the grid in a tight loop.
 */
function proctorCameraGridColumnsForCount(tileCount) {
  const n = Math.max(0, Math.floor(Number(tileCount)) || 0);
  const w =
    typeof document !== "undefined" && document.documentElement
      ? document.documentElement.clientWidth
      : typeof window !== "undefined"
        ? window.innerWidth
        : 1024;
  if (w <= 380) return 1;
  if (w <= 560) return 2;
  if (w <= 900) {
    if (n <= 0) return 3;
    if (n <= 6) return Math.min(3, Math.max(1, n));
    return 3;
  }
  if (n <= 0) return 4;
  if (n <= 6) return Math.max(1, n);
  if (n <= 12) return 6;
  return 6;
}

function clampProctorTilesVisible(value) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return 12;
  return Math.min(12, Math.max(9, n));
}

function updateProctorCamCapacityHint(rosterCount) {
  const el = $("#proctor-cam-capacity-hint");
  if (!el) return;
  const n = Math.max(0, Math.floor(Number(rosterCount)) || 0);
  if (n === 0) {
    el.textContent =
      "No students on this room’s roster yet. One camera tile is created per student when the roster loads.";
    return;
  }
  el.innerHTML = `This room’s roster: <strong>${n}</strong> student(s) → <strong>${n}</strong> camera tiles. The grid (columns / rows / compact tiles) follows this count automatically — not a fixed twelve. Wide windows: usually no inner scroll when two rows or fewer fit; narrow or very short windows may scroll.`;
}

function detachProctorCamViewportWatch() {
  if (proctorCamViewportResizeTimer != null) {
    clearTimeout(proctorCamViewportResizeTimer);
    proctorCamViewportResizeTimer = null;
  }
  if (proctorCamViewportResizeHandler) {
    window.removeEventListener("resize", proctorCamViewportResizeHandler);
    proctorCamViewportResizeHandler = null;
  }
  const c = lastCameraViewCtx?.container;
  const scrollEl = c?.parentElement;
  if (scrollEl?.classList?.contains?.("proctor-cam-wall-scroll")) {
    scrollEl.style.maxHeight = "";
    scrollEl.style.overflowY = "";
  }
}

/** Camera grid layout (columns + compact mode). Scroll/clamp is CSS-only on .proctor-cam-wall-scroll. */
function syncProctorCamScrollViewport() {
  const c = lastCameraViewCtx?.container;
  if (!c) return;

  const n = c.querySelectorAll(".video-tile").length;
  const cols = proctorCameraGridColumnsForCount(n);
  const rows = n > 0 ? Math.max(1, Math.ceil(n / cols)) : 1;
  c.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
  c.classList.toggle("proctor-video-wall--compact", n >= 7 || rows >= 2);
}

const INTEGRITY_HOT_MS = 45000;

function applyIntegrityHighlightToCameraTile(wallEl, studentId) {
  if (!wallEl || !studentId) return;
  const tile = findVideoTile(wallEl, studentId);
  if (!tile) return;
  if (tile._integrityHotTimer) {
    clearTimeout(tile._integrityHotTimer);
    tile._integrityHotTimer = null;
  }
  tile.classList.add("proctor-tile-integrity-hot");
  tile._integrityHotTimer = setTimeout(() => {
    tile.classList.remove("proctor-tile-integrity-hot");
    tile._integrityHotTimer = null;
  }, INTEGRITY_HOT_MS);
  tile.classList.remove("video-tile-alert");
  void tile.offsetWidth;
  tile.classList.add("video-tile-alert");
  setTimeout(() => tile.classList.remove("video-tile-alert"), 5200);
}

/**
 * Proctor or admin: request one-way video/audio from each student in the room.
 */
async function startProctorViewCameras(roomId, viewerUserId, role, container) {
  viewerRtcTeardown?.();
  await hydrateWebRtcIceServers();
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
      tuneAudioRtpSenders(pc);
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

  const onRoomRoster = (ev) => {
    if (!ev || ev.roomId !== roomId) return;
    if (ev.event !== "leave" || ev.role !== "student") return;
    const sid = ev.userId;
    const oldPc = peers.get(sid);
    if (oldPc) {
      try {
        oldPc.close();
      } catch {
        /* ignore */
      }
      peers.delete(sid);
    }
    const tile = findVideoTile(container, sid);
    if (tile) {
      const v = tile.querySelector("video");
      if (v) v.srcObject = null;
      const st = tile.querySelector(".webrtc-status");
      if (st) st.textContent = "Student left exam / camera off";
    }
  };
  socket.on("room:roster", onRoomRoster);

  const connectToStudent = async (studentId, fullName) => {
    let wrap = findVideoTile(container, studentId);
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.className = "video-tile";
      wrap.dataset.student = studentId;
      wrap.innerHTML = `<div class="video-tile-video-wrap"><video playsinline autoplay muted></video></div><p class="hint webrtc-status">Negotiating…</p><p class="video-tile-label">${escapeHtml(fullName)} <span class="hint">(${escapeHtml(studentId)})</span></p><div class="proctor-tile-actions"><button type="button" class="secondary video-unmute-btn">Unmute / listen</button><button type="button" class="secondary proctor-tile-ptt" title="Hold to talk (microphone) — student hears you while pressed">Talk to student (hold)</button></div>`;
      container.appendChild(wrap);
      wrap.querySelector(".video-unmute-btn")?.addEventListener("click", () => {
        const v = wrap.querySelector("video");
        if (!v) return;
        v.muted = !v.muted;
        if (!v.muted) {
          try {
            v.volume = 1;
          } catch {
            /* ignore */
          }
        }
      });
      const pttBtn = wrap.querySelector(".proctor-tile-ptt");
      if (pttBtn && !pttBtn.dataset.pttBound) {
        pttBtn.dataset.pttBound = "1";
        const stopPtt = async () => {
          if (!pttBtn.classList.contains("proctor-ptt-active")) return;
          const tx = wrap._proctorAudioTx;
          if (!tx?.sender) return;
          try {
            await tx.sender.replaceTrack(null);
          } catch (e) {
            console.warn(e);
          }
          pttBtn.classList.remove("proctor-ptt-active");
        };
        const startPtt = async () => {
          if (pttBtn.classList.contains("proctor-ptt-active")) return;
          const pc = peers.get(studentId);
          const tx = wrap._proctorAudioTx;
          if (!pc || !tx?.sender) return;
          const iceOk = ["connected", "completed"].includes(pc.iceConnectionState);
          const connOk = ["connected", "completed"].includes(pc.connectionState);
          if (!iceOk && !connOk) return;
          try {
            const mic = await ensureProctorMicMediaStream();
            const track = mic.getAudioTracks()[0];
            if (!track) return;
            await tx.sender.replaceTrack(track);
            tuneAudioRtpSenders(pc);
          } catch (e) {
            alert(e?.message || String(e));
            return;
          }
          pttBtn.classList.add("proctor-ptt-active");
        };
        pttBtn.addEventListener("mousedown", (e) => {
          e.preventDefault();
          void startPtt();
        });
        pttBtn.addEventListener("touchstart", (e) => {
          e.preventDefault();
          void startPtt();
        });
        pttBtn.addEventListener("mouseup", () => void stopPtt());
        pttBtn.addEventListener("mouseleave", () => void stopPtt());
        pttBtn.addEventListener("touchend", () => void stopPtt());
        pttBtn.addEventListener("touchcancel", () => void stopPtt());
      }
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
    const pc = new RTCPeerConnection({ iceServers: getWebRtcIceServers() });
    peers.set(studentId, pc);
    pc.addTransceiver("video", { direction: "recvonly" });
    /** sendrecv so the student’s SDP includes a receive path for proctor → student audio (PTT). recvonly breaks that direction in Unified Plan. */
    const audioTx = pc.addTransceiver("audio", { direction: "sendrecv" });
    wrap._proctorAudioTx = audioTx;
    pc.ontrack = (ev) => {
      if (ev.streams[0] && videoEl) {
        videoEl.srcObject = ev.streams[0];
        try {
          videoEl.volume = 1;
        } catch {
          /* ignore */
        }
      }
      const tr = ev.track;
      if (tr && typeof tr.addEventListener === "function") {
        tr.addEventListener("ended", () => {
          if (videoEl) videoEl.srcObject = null;
          if (statusEl) statusEl.textContent = "Camera stopped (student finished or left)";
        });
      }
    };
    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      if (s === "failed" || s === "closed") {
        if (videoEl) videoEl.srcObject = null;
        if (statusEl) statusEl.textContent = "Connection closed";
      }
    };
    relayIceCandidate(studentId, roomId, pc);
    const offer = await pc.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: true,
    });
    await pc.setLocalDescription(offer);
    socket.emit("webrtc:relay", { toUserId: studentId, roomId, type: "offer", sdp: offer.sdp });
    if (statusEl) statusEl.textContent = "Waiting for student…";
  };

  const onStudentCamReady = async (p) => {
    if (!p || p.roomId !== roomId) return;
    try {
      const roster = await api(`/api/exam/room/${encodeURIComponent(roomId)}/students`);
      const row = (roster.students || []).find((x) => x.studentId === p.studentId);
      if (row) {
        await connectToStudent(row.studentId, row.fullName);
        updateProctorCamCapacityHint(container.querySelectorAll(".video-tile").length);
        requestAnimationFrame(() => syncProctorCamScrollViewport());
      }
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
    updateProctorCamCapacityHint((roster.students || []).length);
    if (!(roster.students || []).length) {
      container.innerHTML = '<p class="hint">No students in this room yet. When a student begins the exam, feeds appear automatically or use Refresh camera connections.</p>';
    }
  } catch (e) {
    container.innerHTML = `<p class="hint">Camera roster error: ${escapeHtml(e.message || String(e))}</p>`;
  }

  detachProctorCamViewportWatch();
  proctorCamViewportResizeHandler = () => {
    if (proctorCamViewportResizeTimer != null) clearTimeout(proctorCamViewportResizeTimer);
    proctorCamViewportResizeTimer = setTimeout(() => {
      proctorCamViewportResizeTimer = null;
      syncProctorCamScrollViewport();
    }, 140);
  };
  window.addEventListener("resize", proctorCamViewportResizeHandler);
  requestAnimationFrame(() => {
    requestAnimationFrame(() => syncProctorCamScrollViewport());
  });

  viewerRtcTeardown = () => {
    detachProctorCamViewportWatch();
    socket.off("room:roster", onRoomRoster);
    socket.off("webrtc:push_student_ready", onStudentCamReady);
    webRtcViewerHandler = null;
    stopProctorMicMediaStream();
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
  const ekInp = $("#exam-access-key");
  if (ekInp) {
    try {
      ekInp.value = localStorage.getItem(LS_EXAM_ACCESS_KEY) || "";
    } catch {
      ekInp.value = "";
    }
  }
  syncUserIdLabel();
  updateExamKeyRowVisibility();
}

function syncUserIdLabel() {
  const role = $("#role").value;
  const lab = $("#user-id-label");
  if (role === "student") lab.textContent = "Student ID";
  else if (role === "proctor") lab.textContent = "Staff ID";
  else lab.textContent = "User id (use admin)";
}

function updateExamKeyRowVisibility() {
  const role = $("#role")?.value;
  const wrap = $("#exam-key-label-wrap");
  if (wrap) wrap.classList.toggle("hidden", role !== "student");
}

$("#role")?.addEventListener("change", () => {
  syncUserIdLabel();
  updateExamKeyRowVisibility();
});

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
  setProctorDeskFullBleed(name === "proctor");
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
  if (session?.role === "proctor") {
    void paintProctorTeacherPanel();
  }
}

async function refreshGateBanner() {
  const s = loadSession();
  if (!s || s.role === "admin") return;
  /* Proctor desk: no top lobby strip — status lives in the desk sidebar */
  if (s.role === "proctor") {
    $("#hero-banner")?.classList.add("hidden");
    return;
  }
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
      } else if (
        g.reason === "seb_required" ||
        g.reason === "seb_not_configured" ||
        g.reason === "seb_browser_exam_key_mismatch" ||
        g.reason === "seb_url_unknown"
      ) {
        ht.innerHTML = `<span class="pill bad">Safe Exam Browser</span> ${escapeHtml(g.message || "This session must be opened in Safe Exam Browser with keys configured by administration.")}`;
      } else if (g.reason === "exam_access_key_required") {
        ht.innerHTML = `<span class="pill bad">Exam key</span> ${escapeHtml(g.message || "Enter the exam access key on the login screen.")}`;
      } else {
        ht.textContent = g.message || "You cannot enter yet.";
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

/** Last loaded rows from /api/admin/results-report (for CSV download). */
let liveReportRowsCache = null;

function csvEscapeCell(val) {
  const t = String(val ?? "");
  if (/[",\r\n]/.test(t)) return `"${t.replace(/"/g, '""')}"`;
  return t;
}

function buildResultsSummaryCsv(rows) {
  const header = ["Student ID", "Full name", "Correct (keyed)", "Keyed questions", "Answered (keyed)", "Percent", "Model id", "Model label"];
  const lines = [header.join(",")];
  for (const row of rows || []) {
    lines.push(
      [
        csvEscapeCell(row.studentId),
        csvEscapeCell(row.fullName),
        csvEscapeCell(row.correctCount ?? ""),
        csvEscapeCell(row.questionsWithKey ?? ""),
        csvEscapeCell(row.answeredWithKey ?? ""),
        csvEscapeCell(row.percent == null ? "" : row.percent),
        csvEscapeCell(row.modelId ?? ""),
        csvEscapeCell(row.modelLabel ?? ""),
      ].join(",")
    );
  }
  return lines.join("\r\n");
}

function triggerDownloadText(filename, text, mime) {
  const blob = new Blob([`\uFEFF${text}`], { type: mime || "text/csv;charset=utf-8" });
  const u = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = u;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(u);
}

/** @returns {Promise<boolean>} */
function openStudentFinishExamModal() {
  const backdrop = $("#student-finish-modal");
  const cancelBtn = $("#btn-student-finish-cancel");
  const confirmBtn = $("#btn-student-finish-confirm");
  if (!backdrop || !cancelBtn || !confirmBtn) return Promise.resolve(false);
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => {
      if (settled) return;
      settled = true;
      backdrop.classList.add("hidden");
      backdrop.setAttribute("aria-hidden", "true");
      cancelBtn.removeEventListener("click", onCancel);
      confirmBtn.removeEventListener("click", onConfirm);
      backdrop.removeEventListener("click", onBackdrop);
      document.removeEventListener("keydown", onKey);
      resolve(v);
    };
    const onCancel = () => done(false);
    const onConfirm = () => done(true);
    const onBackdrop = (e) => {
      if (e.target === backdrop) onCancel();
    };
    const onKey = (e) => {
      if (e.key === "Escape") onCancel();
    };
    cancelBtn.addEventListener("click", onCancel);
    confirmBtn.addEventListener("click", onConfirm);
    backdrop.addEventListener("click", onBackdrop);
    document.addEventListener("keydown", onKey);
    backdrop.classList.remove("hidden");
    backdrop.setAttribute("aria-hidden", "false");
    try {
      confirmBtn.focus();
    } catch {
      /* ignore */
    }
  });
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/'/g, "&#39;");
}

function paintLiveTab() {
  const ex = stateCache.examSession;
  $("#live-timing-hint").textContent = `Lobby opens at ${new Date(stateCache.lobbyOpensAtISO).toLocaleString()} (local). Start ${new Date(ex.examStartAt).toLocaleString()}, end ${new Date(ex.examEndAt).toLocaleString()}.`;
  paintLiveAccessKeyMsg();
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
            ? `Scheduled end ${new Date(g.examEndAt).toLocaleString()} (local). Percent uses only MCQ rows that include a Correct key. Essay columns sum teacher-graded written answers (administration only on this screen).`
            : `Scheduled end has passed. Students can view their MCQ summary on the Student desk after the countdown reaches zero. Essay totals remain visible here for administration.`;
        mcqBody.innerHTML = "";
        for (const row of g.rows || []) {
          const tr = document.createElement("tr");
          const pct = row.percent == null ? "—" : `${row.percent}%`;
          const keyed = row.questionsWithKey ?? 0;
          const corr = row.correctCount ?? 0;
          const em = row.essayGradedMax > 0 ? `${row.essayGradedPoints ?? 0} / ${row.essayGradedMax}` : "—";
          const pend = row.essayPending != null && row.essayPending > 0 ? String(row.essayPending) : "0";
          tr.innerHTML = `<td>${escapeHtml(row.fullName)} <span class="hint">(${escapeHtml(row.studentId)})</span></td><td>${corr}</td><td>${keyed}</td><td>${pct}</td><td>${escapeHtml(em)}</td><td>${escapeHtml(pend)}</td>`;
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
          if (it.kind === "essay") {
            tr.innerHTML = `<td><code>${escapeHtml(it.questionId)}</code> <span class="hint">(essay — manual grading)</span></td><td>—</td><td>—</td>`;
          } else if (!it.keyed) {
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

  const sebMsg = $("#live-seb-msg");
  const sebCb = $("#live-seb-require");
  const sebTa = $("#live-seb-keys");
  if (sebMsg && stateCache) {
    const n = Number(stateCache.sebBrowserExamKeyLineCount) || 0;
    sebMsg.textContent = stateCache.sebRequireForStudents
      ? `Safe Exam Browser is required for students. ${n} Browser Exam Key line(s) on server.`
      : `Safe Exam Browser is not required. ${n} Browser Exam Key line(s) stored (inactive until enabled).`;
  }
  if (sebCb && sebTa) {
    void (async () => {
      try {
        const s = await api("/api/admin/exam/seb-settings");
        sebCb.checked = !!s.requireForStudents;
        sebTa.value = s.keysText || "";
      } catch {
        /* not an admin session or network */
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
  if (role === "student") {
    const ek = ($("#exam-access-key") && $("#exam-access-key").value.trim()) || "";
    try {
      if (ek) localStorage.setItem(LS_EXAM_ACCESS_KEY, ek);
      else localStorage.removeItem(LS_EXAM_ACCESS_KEY);
    } catch {
      /* ignore */
    }
  }
  saveSession({ role, userId, displayName });
  $("#view-login").classList.add("hidden");
  $("#view-app").classList.remove("hidden");
  $("#btn-logout").classList.remove("hidden");

  connectSocket();
  await hydrateWebRtcIceServers();
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
    void (async () => {
      try {
        const st = await api(`/api/student/${encodeURIComponent(userId)}/entry-status`);
        if (st.examRevoked) {
          $("#student-after-consent")?.classList.remove("hidden");
          $("#student-exam-ended-overlay")?.classList.remove("hidden");
          setStudentExamFullBleed(false);
          $("#student-desk-chrome")?.classList.remove("hidden");
        }
      } catch {
        /* ignore */
      }
    })();
  }

  await refreshState();
  await refreshGateBanner();

  if (gatePoll) clearInterval(gatePoll);
  if (role !== "admin") gatePoll = setInterval(refreshGateBanner, 8000);

  socket.off("state:update");
  socket.on("state:update", () => {
    refreshState();
    if (role !== "admin") refreshGateBanner();
    if (role === "proctor") void refreshProctorRoomProgress();
  });
}

function logout() {
  closeAdminRoomCommandCenter();
  studentExamLeaveGuardCleanup?.();
  studentTabVisibilityCleanup?.();
  proctorRoomId = null;
  $("#btn-proctor-join")?.classList.remove("hidden");
  $("#proctor-room-heading")?.classList.add("hidden");
  $("#proctor-sidebar-inner")?.classList.add("hidden");
  $("#proctor-admit-panel")?.classList.add("hidden");
  $("#proctor-cam-section")?.classList.add("hidden");
  setStudentExamFullBleed(false);
  setProctorDeskFullBleed(false);
  $("#student-desk-chrome")?.classList.remove("hidden");
  clearProctorWaitlistPoll();
  clearStudentEntryPollTimer();
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
  detachProctorCamViewportWatch();
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
    updateExamKeyRowVisibility();
  };
  const seedDmesBtn = $("#btn-seed-dmes-trial");
  if (seedDmesBtn) {
    seedDmesBtn.onclick = async () => {
      const out = $("#seed-dmes-result");
      try {
        const countInp = $("#dmes-student-count");
        const rawN = countInp ? Number(countInp.value) : 12;
        const dmesStudentCount = Math.min(12, Math.max(1, Math.floor(Number.isFinite(rawN) ? rawN : 12)));
        const r = await api(`/api/admin/seed-demo-roster?variant=dmes&count=${encodeURIComponent(String(dmesStudentCount))}`, {
          method: "POST",
          body: JSON.stringify({ variant: "dmes", dmesStudentCount }),
        });
        const cnt = r.state?.studentsCount;
        const fallbackDmesStudents =
          typeof cnt === "number" && cnt >= 1 && cnt <= 12
            ? Array.from({ length: cnt }, (_, i) => ({
                userId: `std${i + 1}`,
                displayName: `std${i + 1}`,
                role: "student",
              }))
            : null;
        const sc =
          r.scenario && Array.isArray(r.scenario.students) && r.scenario.students.length
            ? r.scenario
            : fallbackDmesStudents &&
                cnt === fallbackDmesStudents.length &&
                r.state?.teachersCount === 2 &&
                String(r.state?.examSession?.targetGrade || "") === "Grade 10"
              ? {
                  students: fallbackDmesStudents,
                  teachers: [
                    { userId: "teacher-1", displayName: "teacher-1", role: "proctor" },
                    { userId: "teacher-2", displayName: "teacher-2", role: "proctor" },
                  ],
                  student: { userId: "std1", displayName: "std1", role: "student" },
                  teacher: { userId: "teacher-1", displayName: "teacher-1", role: "proctor" },
                  admin: { userId: "admin", displayName: "Administration", role: "admin" },
                  grade: "Grade 10",
                  trialExamAccessKey: "12345",
                  note: "Students: std1 … std" + cnt + ". Exam access key 12345 for each student login.",
                }
              : null;
        if (out) {
          if (!sc) {
            out.innerHTML =
              "<strong>Warning:</strong> The server did not return the DMES trial summary. You may be on an old build: restart the app from the latest project folder, set Server URL if needed, then try again.";
          } else {
            const studLines = (sc.students || [sc.student].filter(Boolean))
              .map((x) => `<code>${escapeHtml(x.userId)}</code> — ${escapeHtml(x.displayName || "")}`)
              .join("<br/>");
            const teachLines = (sc.teachers || [sc.teacher].filter(Boolean))
              .map((x) => `<code>${escapeHtml(x.userId)}</code> — ${escapeHtml(x.displayName || "")}`)
              .join("<br/>");
            const keyLine =
              sc.trialExamAccessKey != null
                ? `<br/>Exam access key (all students): <code>${escapeHtml(String(sc.trialExamAccessKey))}</code> — enter on the welcome screen.`
                : "";
            out.innerHTML = [
              "<strong>Scenario loaded.</strong> Teachers: use Quick fill on the welcome screen. Students: type <code>std#</code> manually and the exam access key above.",
              `<br/>Admin: <code>${escapeHtml(sc.admin?.userId || "admin")}</code>`,
              `<br/>Teachers (proctors):<br/>${teachLines}`,
              `<br/>Students:<br/>${studLines}`,
              `<br/>Grade: <code>${escapeHtml(sc.grade || "")}</code>.`,
              keyLine,
              `<br/><span class="hint">${escapeHtml(sc.note || "")}</span>`,
            ].join("");
          }
        }
        await refreshState();
        updateExamKeyRowVisibility();
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
        updateExamKeyRowVisibility();
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
  $("#btn-live-access-key-save")?.addEventListener("click", async () => {
    const inp = $("#live-exam-access-key");
    const msg = $("#live-access-key-msg");
    const raw = (inp && inp.value) || "";
    try {
      await api("/api/admin/exam/access-key", { method: "POST", body: JSON.stringify({ key: raw }) });
      if (inp && !raw) inp.value = "";
      await refreshState();
    } catch (e) {
      if (msg) msg.textContent = e.message || String(e);
    }
  });
  $("#btn-live-seb-save")?.addEventListener("click", async () => {
    const sebMsg = $("#live-seb-msg");
    const requireForStudents = !!$("#live-seb-require")?.checked;
    const keysText = ($("#live-seb-keys") && $("#live-seb-keys").value) || "";
    try {
      await api("/api/admin/exam/seb-settings", {
        method: "POST",
        body: JSON.stringify({ requireForStudents, allowedBrowserExamKeysText: keysText }),
      });
      await refreshState();
    } catch (e) {
      if (sebMsg) sebMsg.textContent = e.message || String(e);
    }
  });
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
  $("#btn-live-results-report")?.addEventListener("click", async () => {
    const meta = $("#live-results-meta");
    const wrap = $("#live-results-table-wrap");
    const pre = $("#live-results-pre");
    const links = $("#live-evidence-links");
    const csvBtn = $("#btn-live-results-csv");
    liveReportRowsCache = null;
    if (csvBtn) csvBtn.disabled = true;
    if (meta) meta.textContent = "Loading…";
    if (wrap) wrap.innerHTML = "";
    if (pre) pre.textContent = "";
    if (links) links.innerHTML = "";
    try {
      const r = await api("/api/admin/results-report");
      const rows = r.studentRows || [];
      liveReportRowsCache = rows;
      if (csvBtn) csvBtn.disabled = rows.length === 0;
      if (meta) {
        meta.textContent = `Scheduled exam end: ${r.examEndAt || "—"} · Question model: ${r.selectedModelId || "—"} · Machine evidence files: ${(r.evidenceFiles || []).length}`;
      }
      if (wrap) {
        if (!rows.length) {
          wrap.innerHTML = '<p class="hint">No students in the roster.</p>';
        } else {
          const tbl = document.createElement("table");
          tbl.className = "results-score-table";
          tbl.innerHTML =
            "<thead><tr><th>Student</th><th>Student ID</th><th>Correct</th><th>Keyed Qs</th><th>Answered</th><th>Percent</th></tr></thead><tbody></tbody>";
          const tbody = tbl.querySelector("tbody");
          for (const row of rows) {
            const tr = document.createElement("tr");
            const pct = row.percent == null ? "—" : `${row.percent}%`;
            tr.innerHTML = `<td>${escapeHtml(row.fullName || "")}</td><td><code>${escapeHtml(row.studentId || "")}</code></td><td>${escapeHtml(
              String(row.correctCount ?? "—")
            )}</td><td>${escapeHtml(String(row.questionsWithKey ?? "—"))}</td><td>${escapeHtml(String(row.answeredWithKey ?? "—"))}</td><td>${escapeHtml(
              pct
            )}</td>`;
            tbody.appendChild(tr);
          }
          wrap.innerHTML = "";
          wrap.appendChild(tbl);
        }
      }
      if (pre) {
        pre.textContent = JSON.stringify(rows, null, 2);
      }
      if (links) {
        for (const f of r.evidenceFiles || []) {
          const a = document.createElement("a");
          a.href = apiUrl(`/api/admin/exam-evidence-file/${encodeURIComponent(f.file)}`);
          a.download = f.file;
          a.textContent = `${f.file} (${f.sizeBytes} bytes)`;
          a.className = "template-dl";
          links.appendChild(a);
        }
        if (!(r.evidenceFiles || []).length) {
          const p = document.createElement("p");
          p.className = "hint";
          p.textContent = "No JSONL evidence files yet (submissions on this server create them).";
          links.appendChild(p);
        }
      }
    } catch (e) {
      liveReportRowsCache = null;
      if (csvBtn) csvBtn.disabled = true;
      if (meta) meta.textContent = e.message || String(e);
      if (pre) pre.textContent = "";
    }
  });
  $("#btn-live-results-csv")?.addEventListener("click", () => {
    if (!liveReportRowsCache || !liveReportRowsCache.length) return;
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    triggerDownloadText(`exam-results-summary-${stamp}.csv`, buildResultsSummaryCsv(liveReportRowsCache));
  });
}

const LS_ADMIN_ROOM_LAUNCH = "examDemoAdminRoomLaunch";
const LS_PROCTOR_DESK_LAUNCH = "examDemoProctorDeskLaunch";

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
    const w = $("#admin-room-video-wall");
    if (
      w &&
      ev.studentId &&
      (ev.type === "audio_activity" || ev.type === "motion_heuristic" || ev.type === "tab_switch")
    ) {
      applyIntegrityHighlightToCameraTile(w, ev.studentId);
    }
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
  const win = window.open(u.toString(), "_blank");
  if (win) {
    try {
      win.opener = null;
    } catch {
      /* ignore */
    }
  } else {
    openAdminRoomCommandCenter(roomId);
  }
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

function openProctorDeskInNewWindow() {
  const s = loadSession();
  if (!s || s.role !== "proctor") return false;
  try {
    localStorage.setItem(
      LS_PROCTOR_DESK_LAUNCH,
      JSON.stringify({
        role: "proctor",
        userId: s.userId,
        displayName: s.displayName || s.userId,
        exp: Date.now() + 180000,
      })
    );
  } catch {
    return false;
  }
  const u = new URL(window.location.href);
  u.searchParams.set("proctor_desk", "1");
  const win = window.open(u.toString(), "_blank");
  if (!win) return false;
  try {
    win.opener = null;
  } catch {
    /* ignore */
  }
  return true;
}

async function maybeBootstrapProctorDeskTab() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("proctor_desk") !== "1") return false;
  let raw;
  try {
    raw = localStorage.getItem(LS_PROCTOR_DESK_LAUNCH);
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
    localStorage.removeItem(LS_PROCTOR_DESK_LAUNCH);
    history.replaceState({}, "", window.location.pathname);
    return false;
  }
  if (Date.now() > data.exp || data.role !== "proctor") {
    localStorage.removeItem(LS_PROCTOR_DESK_LAUNCH);
    history.replaceState({}, "", window.location.pathname);
    return false;
  }
  localStorage.removeItem(LS_PROCTOR_DESK_LAUNCH);
  try {
    history.replaceState({}, "", window.location.pathname);
  } catch {
    /* ignore */
  }
  $("#role").value = "proctor";
  $("#userId").value = data.userId;
  $("#displayName").value = data.displayName || data.userId;
  syncUserIdLabel();
  await enterApp();
  await joinProctorDeskFromSession();
  return true;
}

async function refreshProctorWaitlist(staffId) {
  const hint = $("#proctor-waitlist-hint");
  const tbody = $("#proctor-waitlist-body");
  const relBtn = $("#btn-proctor-release-paper");
  if (!hint || !tbody) return;
  try {
    const d = await api(`/api/proctor/${encodeURIComponent(staffId)}/room-waitlist`);
    if (d.paperReleased) {
      hint.textContent = "The question paper is released. Students in this room can load questions.";
      if (relBtn) relBtn.disabled = true;
    } else {
      hint.textContent =
        "Confirm each student is present, tap Admit for that student, then click Release question paper. Admit alone is not enough — questions stay hidden until you release the paper for the whole room.";
      if (relBtn) relBtn.disabled = false;
    }
    tbody.innerHTML = "";
    for (const row of d.students || []) {
      const tr = document.createElement("tr");
      const st = String(row.status || "none");
      const admitted = st === "admitted";
      const nameTd = document.createElement("td");
      nameTd.innerHTML = `${escapeHtml(row.fullName)} <span class="hint">(${escapeHtml(row.studentId)})</span>`;
      const statTd = document.createElement("td");
      statTd.textContent = st;
      const actTd = document.createElement("td");
      if (!admitted) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "secondary";
        b.textContent = "Admit";
        b.addEventListener("click", async () => {
          try {
            await api(`/api/proctor/${encodeURIComponent(staffId)}/admit-student`, {
              method: "POST",
              body: JSON.stringify({ studentId: row.studentId }),
            });
            await refreshProctorWaitlist(staffId);
          } catch (e) {
            alert(e.message || String(e));
          }
        });
        actTd.appendChild(b);
      } else {
        actTd.textContent = "—";
      }
      tr.appendChild(nameTd);
      tr.appendChild(statTd);
      tr.appendChild(actTd);
      tbody.appendChild(tr);
    }
  } catch (e) {
    hint.textContent = e.message || String(e);
    tbody.innerHTML = "";
  }
}

async function refreshProctorRoomProgress() {
  const s = loadSession();
  if (!s || s.role !== "proctor") return;
  const hint = $("#proctor-progress-hint");
  const body = $("#proctor-progress-body");
  if (!hint || !body) return;
  hint.textContent = "Loading…";
  body.innerHTML = "";
  try {
    const g = await api(`/api/proctor/${encodeURIComponent(s.userId)}/room-exam-progress`);
    hint.textContent = `Room: ${g.roomLabel} (${g.roomId}).`;
    for (const row of g.rows || []) {
      const tr = document.createElement("tr");
      const label = escapeHtml(row.progressLabel || "—");
      tr.innerHTML = `<td>${escapeHtml(row.fullName)} <span class="hint">(${escapeHtml(row.studentId)})</span></td><td>${label}</td>`;
      body.appendChild(tr);
    }
  } catch (e) {
    hint.textContent = e.message || String(e);
  }
}

async function joinProctorDeskFromSession() {
  const s = loadSession();
  if (!s || s.role !== "proctor") {
    alert("Log in as Teacher / proctor first.");
    return;
  }
  $("#proctor-room-heading")?.classList.add("hidden");
  clearProctorWaitlistPoll();
  $("#proctor-sidebar-inner")?.classList.add("hidden");
  $("#proctor-admit-panel")?.classList.add("hidden");
  viewerRtcTeardown?.();
  viewerRtcTeardown = null;
  webRtcViewerHandler = null;
  let gate;
  try {
    gate = await api(`/api/gate?role=proctor&userId=${encodeURIComponent(s.userId)}`);
  } catch {
    $("#proctor-gate-line").textContent = "Could not read access rules.";
    $("#proctor-cam-section")?.classList.add("hidden");
    $("#btn-proctor-join")?.classList.remove("hidden");
    return;
  }
  if (!gate.allowed) {
    $("#proctor-gate-line").textContent = "You cannot join yet. See the banner above.";
    $("#proctor-help-wrap")?.classList.add("hidden");
    $("#proctor-cam-section")?.classList.add("hidden");
    $("#btn-proctor-join")?.classList.remove("hidden");
    return;
  }
  let place;
  try {
    place = await api(`/api/proctor/${encodeURIComponent(s.userId)}/room`);
  } catch (e) {
    $("#proctor-gate-line").textContent = e.message;
    $("#proctor-cam-section")?.classList.add("hidden");
    $("#btn-proctor-join")?.classList.remove("hidden");
    return;
  }
  try {
    await refreshState();
  } catch {
    /* keep previous stateCache if snapshot fails */
  }
  proctorRoomId = place.roomId;
  const headEl = $("#proctor-room-heading");
  if (headEl) {
    headEl.textContent = place.examHeading || "";
    headEl.classList.toggle("hidden", !place.examHeading);
  }
  socket.emit("room:join", { roomId: place.roomId, userId: s.userId, role: "proctor" }, () => {});
  $("#proctor-status").textContent = `Joined ${place.roomName} (${place.roomId})`;
  $("#proctor-gate-line").textContent =
    "You are in the live window. Admit each student, then release the question paper so questions can appear.";
  $("#proctor-help-wrap")?.classList.remove("hidden");
  $("#proctor-sidebar-inner")?.classList.remove("hidden");
  $("#proctor-admit-panel")?.classList.remove("hidden");
  void refreshProctorWaitlist(s.userId);
  proctorWaitlistTimer = setInterval(() => void refreshProctorWaitlist(s.userId), 4000);
  const wlRef = $("#btn-proctor-waitlist-refresh");
  if (wlRef) wlRef.onclick = () => void refreshProctorWaitlist(s.userId);
  $("#btn-proctor-release-paper").onclick = async () => {
    try {
      await api(`/api/proctor/${encodeURIComponent(s.userId)}/release-paper`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      await refreshProctorWaitlist(s.userId);
    } catch (e) {
      alert(e.message || String(e));
    }
  };
  const camSection = $("#proctor-cam-section");
  const camWall = $("#proctor-video-wall");
  if (camSection) camSection.classList.remove("hidden");
  if (camWall) void startProctorViewCameras(place.roomId, s.userId, "proctor", camWall);

  const log = $("#proctor-chat-log");
  if (log) log.innerHTML = "";
  socket.off("chat:private");
  socket.off("integrity:event");
  socket.on("chat:private", (msg) => {
    if (!log) return;
    const line = document.createElement("div");
    line.textContent = `[private] ${msg.fromUserId} to ${msg.toUserId}: ${msg.text}`;
    log.prepend(line);
  });
  socket.on("integrity:event", (ev) => {
    if (ev.roomId !== place.roomId) return;
    if (ev.studentId && (ev.type === "audio_activity" || ev.type === "motion_heuristic" || ev.type === "tab_switch")) {
      applyIntegrityHighlightToCameraTile(camWall, ev.studentId);
    }
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

  $("#btn-proctor-join")?.classList.add("hidden");
  void refreshProctorRoomProgress();
}

async function renderTeacherEssayInbox() {
  const s = loadSession();
  const box = $("#teacher-essay-inbox");
  if (!s || s.role !== "proctor" || !box) return;
  try {
    const d = await api(`/api/teacher/${encodeURIComponent(s.userId)}/essay-inbox`);
    box.innerHTML = "";
    const items = d.items || [];
    if (!items.length) {
      box.textContent = "No essay submissions yet.";
      return;
    }
    for (const it of items) {
      const wrap = document.createElement("div");
      wrap.style.marginBottom = "0.75rem";
      const head = document.createElement("div");
      head.innerHTML = `<strong>${escapeHtml(it.blindId)}</strong> · <code>${escapeHtml(it.questionId)}</code> · max <strong>${escapeHtml(
        String(it.maxPoints)
      )}</strong> · ${escapeHtml(it.submittedAt)} · <em>${escapeHtml(it.status)}</em>`;
      wrap.appendChild(head);
      const body = document.createElement("div");
      body.className = "hint";
      body.style.whiteSpace = "pre-wrap";
      body.style.marginTop = "0.25rem";
      body.textContent = it.fullText || it.excerpt || "";
      wrap.appendChild(body);
      if (it.status === "pending") {
        const row = document.createElement("div");
        row.className = "row";
        row.style.marginTop = "0.35rem";
        row.style.gap = "0.5rem";
        row.style.alignItems = "center";
        const inp = document.createElement("input");
        inp.type = "number";
        inp.min = "0";
        inp.max = String(it.maxPoints || 10);
        inp.step = "any";
        inp.style.width = "5.5rem";
        inp.placeholder = "Score";
        const go = document.createElement("button");
        go.type = "button";
        go.textContent = "Save score";
        go.addEventListener("click", async () => {
          const score = Number(inp.value);
          if (!Number.isFinite(score)) {
            alert("Enter a numeric score.");
            return;
          }
          try {
            await api(`/api/teacher/${encodeURIComponent(s.userId)}/essay-grade`, {
              method: "POST",
              body: JSON.stringify({ blindId: it.blindId, score }),
            });
            await renderTeacherEssayInbox();
            await refreshState();
          } catch (err) {
            alert(err.message || String(err));
          }
        });
        row.appendChild(inp);
        row.appendChild(go);
        wrap.appendChild(row);
      } else {
        const p = document.createElement("p");
        p.className = "hint";
        p.style.marginTop = "0.25rem";
        p.textContent = `Graded score: ${it.score}`;
        wrap.appendChild(p);
      }
      box.appendChild(wrap);
    }
  } catch (e) {
    box.textContent = e.message || String(e);
  }
}

async function paintProctorTeacherPanel() {
  const s = loadSession();
  if (!s || s.role !== "proctor") return;
  const hint = $("#proctor-teacher-upload-hint");
  const sel = $("#teacher-essay-model-select");
  if (!hint || !sel) return;
  try {
    const m = await api(`/api/teacher/${encodeURIComponent(s.userId)}/my-question-models`);
    hint.textContent = `You may upload up to ${m.slotsMax} Excel/CSV question models tied to your staff id (${s.userId}). Slots used: ${m.slotsUsed} / ${m.slotsMax}. Administration still chooses the live exam model in Create exam.`;
    const prev = sel.value;
    sel.innerHTML = "";
    const none = document.createElement("option");
    none.value = "";
    none.textContent = (m.models || []).length ? "Choose a model…" : "Upload a model first";
    sel.appendChild(none);
    (m.models || []).forEach((x) => {
      const o = document.createElement("option");
      o.value = x.id;
      o.textContent = `${x.label} (${x.questionCount} questions)`;
      sel.appendChild(o);
    });
    if (prev && [...sel.options].some((o) => o.value === prev)) sel.value = prev;
  } catch (e) {
    hint.textContent = e.message || String(e);
  }
  await renderTeacherEssayInbox();
}

function bindProctor() {
  $("#btn-proctor-progress-refresh")?.addEventListener("click", () => void refreshProctorRoomProgress());

  $("#btn-teacher-upload-q")?.addEventListener("click", async () => {
    const s = loadSession();
    if (!s || s.role !== "proctor") return;
    const inp = $("#teacher-q-file");
    if (!inp?.files?.[0]) {
      alert("Choose a question Excel or CSV file first.");
      return;
    }
    const fd = new FormData();
    fd.append("file", inp.files[0]);
    fd.append("staffId", s.userId);
    const lab = ($("#teacher-q-label") && $("#teacher-q-label").value.trim()) || "";
    if (lab) fd.append("modelLabel", lab);
    try {
      await apiForm("/api/teacher/upload/question-model", fd);
      inp.value = "";
      await refreshState();
      alert("Question model uploaded.");
    } catch (e) {
      alert(e.message || String(e));
    }
  });

  $("#btn-teacher-essay-add")?.addEventListener("click", async () => {
    const s = loadSession();
    if (!s || s.role !== "proctor") return;
    const modelId = $("#teacher-essay-model-select")?.value || "";
    const text = ($("#teacher-essay-prompt") && $("#teacher-essay-prompt").value.trim()) || "";
    const maxPoints = Number($("#teacher-essay-max")?.value) || 10;
    if (!modelId) {
      alert("Choose one of your uploaded models.");
      return;
    }
    if (!text) {
      alert("Enter the essay prompt.");
      return;
    }
    try {
      await api(`/api/teacher/${encodeURIComponent(s.userId)}/models/${encodeURIComponent(modelId)}/essay-questions`, {
        method: "POST",
        body: JSON.stringify({ text, maxPoints }),
      });
      $("#teacher-essay-prompt").value = "";
      await refreshState();
      alert("Essay question added to that model.");
    } catch (e) {
      alert(e.message || String(e));
    }
  });

  $("#btn-teacher-essay-refresh")?.addEventListener("click", () => void renderTeacherEssayInbox());

  $("#btn-proctor-refresh-cam")?.addEventListener("click", () => {
    const c = lastCameraViewCtx;
    if (c?.container) void startProctorViewCameras(c.roomId, c.viewerUserId, c.role, c.container);
  });

  $("#btn-proctor-join").onclick = async () => {
    if (openProctorDeskInNewWindow()) return;
    await joinProctorDeskFromSession();
  };

  $("#btn-proctor-broadcast-mic")?.addEventListener("click", () => {
    alert(
      "Broadcasting your microphone to all students at once is not implemented in this trial build. Use per-student “Unmute / listen”, private messages, or administration support."
    );
  });
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
    if (!window.isSecureContext) {
      alert(
        "Camera and microphone need a secure page (HTTPS). Open the exam site with https:// or use localhost for development."
      );
      return;
    }
    try {
      const stream = await acquireStudentExamMedia();
      v.srcObject = stream;
      $("#consent-modal").classList.add("hidden");
      $("#student-after-consent").classList.remove("hidden");
      const hc = $("#honesty-check");
      const btn = $("#btn-enter-exam");
      if (hc) hc.checked = false;
      if (btn) btn.disabled = true;
      void loadStudentIntegrityPolicy();
    } catch (e) {
      const msg = e?.message || String(e);
      alert(
        "Could not open camera/microphone. Allow permissions in the browser, use HTTPS, and close other apps using the camera. Details: " +
          msg
      );
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
    $("#student-exam-ended-overlay")?.classList.add("hidden");
    clearStudentEntryPollTimer();
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

    const loungeStatus = $("#student-lounge-status");
    const preExam = $("#student-preexam-block");
    const lounge = $("#student-wait-lounge");
    const workspace = $("#student-exam-workspace");
    const gateTop = $("#student-gate-line");
    if (gateTop) gateTop.textContent = "";
    preExam?.classList.add("hidden");
    lounge?.classList.remove("hidden");
    workspace?.classList.add("hidden");
    if (loungeStatus) {
      loungeStatus.innerHTML =
        "<strong>Status:</strong> Please wait — you are being transferred to the exam room and connected to your proctor.";
    }

    let place;
    try {
      place = await api(`/api/student/${encodeURIComponent(sid)}/room`);
    } catch (e) {
      lounge?.classList.add("hidden");
      preExam?.classList.remove("hidden");
      if (gateTop) gateTop.textContent = e.message;
      return;
    }
    if (loungeStatus) {
      loungeStatus.innerHTML = `${escapeHtml(place.roomName)} (${escapeHtml(place.roomId)}) — <strong>connected</strong>. Sending your entry request to the proctor…`;
    }
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

    try {
      await api(`/api/student/${encodeURIComponent(sid)}/request-entry`, { method: "POST", body: JSON.stringify({}) });
    } catch (e) {
      alert(e.message || String(e));
      lounge?.classList.add("hidden");
      preExam?.classList.remove("hidden");
      return;
    }
    if (loungeStatus) {
      loungeStatus.innerHTML +=
        '<br/><span class="hint">Entry request sent. Wait for <strong>Admit</strong>, then the teacher must click <strong>Release question paper</strong> (both steps are required).</span>';
    }
    try {
      await new Promise((resolve, reject) => {
        let done = false;
        const onServerState = () => {
          void entryPollTick();
        };
        const finish = (fn, arg) => {
          if (done) return;
          done = true;
          clearStudentEntryPollTimer();
          socket?.off?.("state:update", onServerState);
          fn(arg);
        };
        const entryPollTick = async () => {
          try {
            const st = await api(`/api/student/${encodeURIComponent(sid)}/entry-status`);
            if (st.examRevoked) {
              finish(reject, new Error("Your exam attempt was ended (for example you left the browser). Your answers were saved."));
              return;
            }
            if (!st.examPublished) {
              if (loungeStatus) {
                loungeStatus.innerHTML = "The exam is not published yet. Ask administration to publish.";
              }
              return;
            }
            if (!st.gateAllowed) {
              finish(reject, new Error(String(st.gate?.reason || "You are not allowed into the exam session right now.")));
              return;
            }
            if (st.admissionStatus !== "admitted") {
              if (loungeStatus) {
                loungeStatus.innerHTML =
                  st.admissionStatus === "pending"
                    ? "<strong>Waiting for proctor to admit you.</strong> Your request is in the teacher’s list."
                    : "<strong>Not admitted yet.</strong> The proctor must tap <strong>Admit</strong> for your student id on the teacher desk.";
              }
              return;
            }
            if (!st.paperReleased) {
              if (loungeStatus) {
                loungeStatus.innerHTML =
                  "<strong>You are admitted.</strong> The question paper is still locked. The proctor must click <strong>Release question paper for this room</strong> (without this, questions will not appear).";
              }
              return;
            }
            finish(resolve, undefined);
          } catch (e) {
            finish(reject, e instanceof Error ? e : new Error(String(e)));
          }
        };
        socket?.on?.("state:update", onServerState);
        void entryPollTick();
        studentEntryPollTimer = setInterval(() => void entryPollTick(), 1000);
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.toLowerCase().includes("revoked")) {
        clearStudentEntryPollTimer();
        lounge?.classList.add("hidden");
        await finalizeStudentExamRevokedUi(sid, place);
        return;
      }
      alert(msg);
      clearStudentEntryPollTimer();
      lounge?.classList.add("hidden");
      preExam?.classList.remove("hidden");
      return;
    }
    lounge?.classList.add("hidden");
    workspace?.classList.remove("hidden");
    setStudentExamFullBleed(true);
    $("#student-desk-chrome")?.classList.add("hidden");
    moveStudentVideoToPip();
    $("#student-room-label").textContent = `${place.roomName} (${place.roomId}) — exam in progress`;
    await showStudentExamLockGateModal();
    attachStudentExamLeaveProtection(sid, place);
    setupStudentTabVisibilityWatch(place.roomId, sid);

    let paperMeta;
    try {
      paperMeta = await api(`/api/student/${encodeURIComponent(sid)}/paper`);
    } catch (e) {
      const msg = e.message || String(e);
      if (msg.toLowerCase().includes("revoked")) {
        studentExamLeaveGuardCleanup?.();
        await finalizeStudentExamRevokedUi(sid, place);
        return;
      }
      alert(msg);
      studentExamLeaveGuardCleanup?.();
      restoreStudentVideoHome();
      return;
    }

    const headingEl = $("#student-exam-heading");
    if (headingEl) headingEl.textContent = paperMeta.examHeading || "Exam";

    let currentStep;
    try {
      currentStep = await api(`/api/student/${encodeURIComponent(sid)}/exam-current`);
    } catch (e) {
      const msg = e.message || String(e);
      if (msg.toLowerCase().includes("revoked")) {
        studentExamLeaveGuardCleanup?.();
        await finalizeStudentExamRevokedUi(sid, place);
        return;
      }
      alert(msg);
      studentExamLeaveGuardCleanup?.();
      restoreStudentVideoHome();
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
    const timerBar = $("#student-exam-timer-bar");
    if (timerBar) timerBar.innerHTML = "";
    const endMs = new Date(paperMeta.examEndAt).getTime();
    const timer = document.createElement("p");
    timer.className = "student-exam-wire-timer-text";
    if (timerBar) timerBar.appendChild(timer);
    else {
      timer.className = "hint";
      area.appendChild(timer);
    }
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
      while (area.firstChild) {
        area.removeChild(area.firstChild);
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
      const q = step.question;
      const isEssay = q && (q.type === "essay" || !Array.isArray(q.choices) || q.choices.length < 2);
      const prog = document.createElement("p");
      prog.className = "student-exam-wire-instruction";
      if (isEssay) {
        prog.innerHTML = isLast
          ? `Final question (${step.index + 1} of ${step.total}) — <strong>written answer</strong>. Type your response, then press <strong>Finish exam</strong>.`
          : `Question ${step.index + 1} of ${step.total} — <strong>written answer</strong>. Press <strong>Submit answer</strong> when ready for the next question.`;
      } else {
        prog.innerHTML = isLast
          ? `Final question (${step.index + 1} of ${step.total}). Choose one answer, then press <strong>Finish exam</strong> to end your attempt.`
          : `Question ${step.index + 1} of ${step.total}. Choose one answer, then press <strong>Submit answer</strong> for the next question.`;
      }
      area.appendChild(prog);
      const box = document.createElement("div");
      box.className = "question panel student-exam-q-card";
      const p = document.createElement("p");
      p.className = "mcq-qtext";
      p.textContent = q.text;
      box.appendChild(p);
      let selected = null;
      /** @type {HTMLTextAreaElement | null} */
      let essayTa = null;
      const submitBtn = document.createElement("button");
      submitBtn.type = "button";
      submitBtn.textContent = isLast ? "Finish exam" : "Submit answer";
      submitBtn.setAttribute("aria-label", isLast ? "Finish exam and submit your final answer" : "Submit answer and go to next question");
      submitBtn.disabled = true;
      if (isEssay) {
        essayTa = document.createElement("textarea");
        essayTa.rows = 7;
        essayTa.className = "student-essay-answer";
        essayTa.style.width = "100%";
        essayTa.setAttribute("aria-label", "Your written answer");
        essayTa.addEventListener("input", () => {
          submitBtn.disabled = !essayTa.value.trim();
        });
        const cap = document.createElement("p");
        cap.className = "hint";
        cap.textContent = `Maximum length about 20 000 characters. Points: up to ${Number(q.maxPoints) || 10} (teacher grades anonymously).`;
        box.appendChild(cap);
        box.appendChild(essayTa);
      } else {
        q.choices.forEach((ch, ci) => {
          const row = document.createElement("label");
          row.className = "student-exam-choice-row";
          const txt = document.createElement("span");
          txt.className = "student-exam-choice-text";
          /* LTR WCAG pattern: control first, then label text (G162). Number prefixes the option text. */
          txt.textContent = `${ci + 1}. ${ch}`;
          const inp = document.createElement("input");
          inp.type = "radio";
          inp.name = "seq-mcq-current";
          inp.addEventListener("change", () => {
            selected = ci;
            submitBtn.disabled = false;
          });
          row.appendChild(inp);
          row.appendChild(txt);
          box.appendChild(row);
        });
      }
      const submitRow = document.createElement("div");
      submitRow.className = "student-exam-q-actions";
      submitBtn.onclick = async () => {
        if (isEssay) {
          if (!essayTa || !essayTa.value.trim()) return;
        } else if (selected == null) return;
        if (isLast) {
          const ok = await openStudentFinishExamModal();
          if (!ok) return;
        }
        submitBtn.disabled = true;
        try {
          const payload = isEssay
            ? { questionId: q.id, essayText: essayTa.value.trim() }
            : { questionId: q.id, choiceIndex: selected };
          const next = await api(`/api/student/${encodeURIComponent(sid)}/exam-submit`, {
            method: "POST",
            body: JSON.stringify(payload),
          });
          if (next.completed) {
            stopIntegrity();
            socket?.emit("room:leave", { roomId: place.roomId, userId: sid, role: "student" });
            studentExamLeaveGuardCleanup?.();
            studentTabVisibilityCleanup?.();
            studentWebRtcStop?.();
            studentWebRtcStop = null;
            try {
              const stream = v.srcObject;
              if (stream?.getTracks) stream.getTracks().forEach((tr) => tr.stop());
              v.srcObject = null;
            } catch {
              /* ignore */
            }
            restoreStudentVideoHome();
            renderQuestionStep({ completed: true, total: next.total, leftRoom: true });
          } else {
            renderQuestionStep({ ...next, completed: false });
          }
        } catch (e) {
          const msg = e.message || String(e);
          if (msg.toLowerCase().includes("revoked")) {
            studentExamLeaveGuardCleanup?.();
            await finalizeStudentExamRevokedUi(sid, place);
            return;
          }
          alert(msg);
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
    updateExamKeyRowVisibility();
  });
  const fillTeacher = (id) => {
    $("#role").value = "proctor";
    $("#userId").value = id;
    $("#displayName").value = id;
    syncUserIdLabel();
    updateExamKeyRowVisibility();
  };
  const fillDmesTrialStudent = (studentId) => {
    const sid = String(studentId || "std1").trim() || "std1";
    $("#role").value = "student";
    $("#userId").value = sid;
    $("#displayName").value = sid;
    const ek = $("#exam-access-key");
    if (ek) {
      ek.value = DMES_TRIAL_EXAM_ACCESS_KEY;
      try {
        localStorage.setItem(LS_EXAM_ACCESS_KEY, DMES_TRIAL_EXAM_ACCESS_KEY);
      } catch {
        /* ignore */
      }
    }
    syncUserIdLabel();
    updateExamKeyRowVisibility();
  };
  $("#btn-fill-teacher-1")?.addEventListener("click", () => fillTeacher("teacher-1"));
  $("#btn-fill-teacher-2")?.addEventListener("click", () => fillTeacher("teacher-2"));
  $("#btn-fill-student-std1")?.addEventListener("click", () => fillDmesTrialStudent("std1"));

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
  const proctorBoot = await maybeBootstrapProctorDeskTab();
  if (!proctorBoot) {
    const booted = await maybeBootstrapAdminRoomTab();
    if (!booted) renderLogin();
  }
});

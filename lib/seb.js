/**
 * Safe Exam Browser (SEB) — Browser Exam Key check compatible with common LMS logic
 * (e.g. Moodle quizaccess_seb): SHA256(fullRequestUrl + browserExamKey) === X-SafeExamBrowser-RequestHash (hex).
 * @see https://safeexambrowser.org/developer/seb-integration.html
 */
const crypto = require("crypto");

/**
 * Absolute URL as seen by the client (must match the address bar for the hash to match SEB).
 * @param {import('express').Request} req
 */
function fullRequestUrl(req) {
  if (!req || !req.headers) return "";
  const rawProto = (req.headers["x-forwarded-proto"] || req.protocol || "http").toString();
  const proto = rawProto.split(",")[0].trim().replace(/:$/, "") || "http";
  const host = (req.headers["x-forwarded-host"] || req.headers.host || "").toString().trim();
  let pathPart = req.originalUrl != null ? String(req.originalUrl) : req.url ? String(req.url) : "/";
  const hashIdx = pathPart.indexOf("#");
  if (hashIdx >= 0) pathPart = pathPart.slice(0, hashIdx);
  if (!host) return "";
  return `${proto}://${host}${pathPart}`;
}

function getSebRequestHash(req) {
  if (!req?.headers) return "";
  const h = req.headers["x-safeexambrowser-requesthash"] || req.headers["X-SafeExamBrowser-RequestHash"];
  return String(h || "").trim();
}

function requestHashMatchesAnyBrowserExamKey(fullUrl, receivedHash, browserExamKeys) {
  const rh = receivedHash.toLowerCase();
  if (!rh) return false;
  for (const bek of browserExamKeys) {
    const key = String(bek).trim();
    if (!key) continue;
    const expected = crypto.createHash("sha256").update(fullUrl + key, "utf8").digest("hex").toLowerCase();
    if (expected === rh) return true;
  }
  return false;
}

/**
 * @param {import('express').Request | null} req
 * @param {{ sebRequireForStudents?: boolean, sebAllowedBrowserExamKeys?: string[] }} state
 * @returns {{ ok: true } | { ok: false, reason: string, message: string }}
 */
function validateStudentSeb(req, state) {
  if (!state.sebRequireForStudents) return { ok: true };
  const keys = Array.isArray(state.sebAllowedBrowserExamKeys)
    ? state.sebAllowedBrowserExamKeys.map((k) => String(k).trim()).filter(Boolean)
    : [];
  if (!keys.length) {
    return {
      ok: false,
      reason: "seb_not_configured",
      message:
        "Safe Exam Browser is required for students, but no Browser Exam Keys are configured. Add keys from the SEB Config Tool (Exam pane) under Live control.",
    };
  }
  if (!req) {
    return {
      ok: false,
      reason: "seb_required",
      message: "Safe Exam Browser validation requires a real HTTP request (no server-side shortcut).",
    };
  }
  const url = fullRequestUrl(req);
  if (!url) {
    return {
      ok: false,
      reason: "seb_url_unknown",
      message:
        "Cannot build the request URL for SEB validation (missing Host). Behind a reverse proxy, set X-Forwarded-Host and X-Forwarded-Proto.",
    };
  }
  const received = getSebRequestHash(req);
  if (!received) {
    return {
      ok: false,
      reason: "seb_required",
      message:
        "Open this platform inside Safe Exam Browser using a .seb / start URL where “Send Browser Exam Key” is enabled. Regular browsers cannot send the required X-SafeExamBrowser-RequestHash header.",
    };
  }
  if (!requestHashMatchesAnyBrowserExamKey(url, received, keys)) {
    return {
      ok: false,
      reason: "seb_browser_exam_key_mismatch",
      message:
        "The SEB request hash did not match any configured Browser Exam Key. Use the exact site URL (scheme, host, port, path) in SEB’s start URL, and paste keys for each SEB platform/version you support (one key per line).",
    };
  }
  return { ok: true };
}

module.exports = {
  fullRequestUrl,
  getSebRequestHash,
  validateStudentSeb,
};

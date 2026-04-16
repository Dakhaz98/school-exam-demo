/**
 * Base URL of the Express + Socket "exam-realtime" deployment (e.g. Render web service).
 * Server-only — not exposed to the browser bundle.
 */
export function getExamRealtimeOrigin(): string | null {
  const raw = process.env.EXAM_REALTIME_URL?.trim();
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

export function buildConsoleStudentDeeplink(opts: {
  origin: string;
  studentId: string;
  displayName?: string | null;
  examRef?: string | null;
}): string {
  const base = opts.origin.replace(/\/$/, "");
  const u = new URL(`${base}/`);
  u.searchParams.set("prefill_from_console", "1");
  u.searchParams.set("prefill_role", "student");
  u.searchParams.set("prefill_student_id", opts.studentId.trim());
  if (opts.displayName?.trim()) u.searchParams.set("prefill_display", opts.displayName.trim());
  if (opts.examRef?.trim()) u.searchParams.set("exam_ref", opts.examRef.trim());
  return u.toString();
}

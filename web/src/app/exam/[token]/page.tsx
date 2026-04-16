import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getServerSession } from '@/lib/session';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { buildConsoleStudentDeeplink, getExamRealtimeOrigin } from '@/lib/exam-realtime';

type Props = { params: Promise<{ token: string }> };

export default async function StudentExamEntryPage({ params }: Props) {
  const { token } = await params;
  const { supabase, user, profile } = await getServerSession();

  if (!supabase) {
    return <p className="text-sm text-[var(--muted)] p-6">Supabase is not configured.</p>;
  }

  if (!user) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6">
        <p className="text-sm text-[var(--muted)]">Sign in to open this exam link.</p>
        <Link href={`/login?redirect=${encodeURIComponent(`/exam/${token}`)}`} className={cn(buttonVariants())}>
          Sign in
        </Link>
      </div>
    );
  }

  const { data: exam } = await supabase
    .from('exams')
    .select('id, title, subject, instructions, status, duration_minutes')
    .eq('id', token)
    .maybeSingle();

  if (!exam) {
    notFound();
  }

  const realtimeOrigin = getExamRealtimeOrigin();
  const isStudent = profile?.role === 'student';
  const rosterStudentId = profile?.student_id?.trim() || '';
  const canDeepLink = Boolean(realtimeOrigin && isStudent && rosterStudentId);

  const studentClientUrl =
    realtimeOrigin && rosterStudentId
      ? buildConsoleStudentDeeplink({
          origin: realtimeOrigin,
          studentId: rosterStudentId,
          displayName: profile?.full_name,
          examRef: token,
        })
      : null;

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 p-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">School Exam Demo</p>
        <h1 className="mt-2 text-2xl font-bold">{exam.title}</h1>
        <p className="text-sm text-[var(--muted)]">
          {exam.subject} · {exam.duration_minutes} minutes · {exam.status}
        </p>
      </div>
      {exam.instructions ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm">{exam.instructions}</div>
      ) : null}

      {!realtimeOrigin ? (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-950 dark:text-amber-100">
          <p className="font-medium">Exam client URL not configured</p>
          <p className="mt-1 text-[var(--muted)]">
            Set <code className="rounded bg-[var(--surface)] px-1 py-0.5 text-[var(--foreground)]">EXAM_REALTIME_URL</code> in{' '}
            <code className="rounded bg-[var(--surface)] px-1 py-0.5 text-[var(--foreground)]">web/.env.local</code> to your Render
            service (same value as the browser address for the Express app, e.g. <code className="break-all">https://school-exam-demo1.onrender.com</code>).
          </p>
        </div>
      ) : null}

      {realtimeOrigin && isStudent && !rosterStudentId ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm">
          Your account has no <strong>student_id</strong> in the school roster. Ask an admin to set it in Supabase (<code>users.student_id</code>)
          so it matches the Student ID column in the exam platform roster.
        </div>
      ) : null}

      {realtimeOrigin && profile && !isStudent ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm text-[var(--muted)]">
          Students should open their exam from the console while signed in as a <strong>student</strong>, or use the live exam client directly
          at{' '}
          <a className="text-[var(--foreground)] underline" href={realtimeOrigin} target="_blank" rel="noopener noreferrer">
            {realtimeOrigin}
          </a>
          .
        </div>
      ) : null}

      <div className="flex flex-wrap gap-3">
        {canDeepLink && studentClientUrl ? (
          <a
            href={studentClientUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(buttonVariants())}
          >
            Open proctored exam client
          </a>
        ) : (
          <button type="button" className={cn(buttonVariants())} disabled={!realtimeOrigin} title={!realtimeOrigin ? 'Configure EXAM_REALTIME_URL' : undefined}>
            Open proctored exam client
          </button>
        )}
        <Link href="/dashboard" className={cn(buttonVariants({ variant: 'outline' }))}>
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getServerSession } from '@/lib/session';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type Props = { params: Promise<{ token: string }> };

export default async function StudentExamEntryPage({ params }: Props) {
  const { token } = await params;
  const { supabase, user } = await getServerSession();

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
      <div className="flex flex-wrap gap-3">
        <button type="button" className={cn(buttonVariants())} disabled title="Start flow: session row + LiveKit room">
          Start exam (stub)
        </button>
        <Link href="/dashboard" className={cn(buttonVariants({ variant: 'outline' }))}>
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}

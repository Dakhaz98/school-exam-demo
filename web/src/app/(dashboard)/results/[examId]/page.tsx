import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getServerSession } from '@/lib/session';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type Props = { params: Promise<{ examId: string }> };

export default async function ResultsExamPage({ params }: Props) {
  const { examId } = await params;
  const { supabase } = await getServerSession();

  if (!supabase) {
    return <p className="text-sm text-[var(--muted)]">Supabase is not configured.</p>;
  }

  const { data: exam } = await supabase.from('exams').select('id, title').eq('id', examId).maybeSingle();
  if (!exam) {
    notFound();
  }

  const { data: sessions } = await supabase
    .from('exam_sessions')
    .select('id, student_id, status, total_score, submitted_at, started_at')
    .eq('exam_id', examId)
    .order('started_at', { ascending: false });

  const studentIds = [...new Set((sessions ?? []).map((s) => s.student_id).filter(Boolean))] as string[];
  let names: Record<string, string> = {};
  if (studentIds.length) {
    const { data: users } = await supabase.from('users').select('id, full_name').in('id', studentIds);
    names = Object.fromEntries((users ?? []).map((u) => [u.id, u.full_name]));
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{exam.title}</h1>
          <p className="text-sm text-[var(--muted)]">Scores and submission times. PDF/XLSX export can be wired to buttons.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" className={cn(buttonVariants({ variant: 'outline' }))} disabled title="Hook up jspdf in a client action">
            Export PDF (stub)
          </button>
          <button type="button" className={cn(buttonVariants({ variant: 'outline' }))} disabled title="Hook up xlsx in a client action">
            Export XLSX (stub)
          </button>
          <Link href="/results" className={cn(buttonVariants({ variant: 'ghost' }))}>
            All results
          </Link>
        </div>
      </div>
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)]">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Student</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Score</TableHead>
              <TableHead>Submitted</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(sessions ?? []).length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-sm text-[var(--muted)]">
                  No sessions yet.
                </TableCell>
              </TableRow>
            ) : (
              (sessions ?? []).map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{names[s.student_id] ?? s.student_id}</TableCell>
                  <TableCell className="text-xs">{s.status}</TableCell>
                  <TableCell className="text-xs">{s.total_score ?? '—'}</TableCell>
                  <TableCell className="text-xs text-[var(--muted)]">
                    {s.submitted_at ? new Date(s.submitted_at).toLocaleString() : '—'}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

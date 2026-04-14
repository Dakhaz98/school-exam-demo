import Link from 'next/link';
import { getServerSession } from '@/lib/session';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { Exam } from '@/lib/types';

export default async function ResultsIndexPage() {
  const { supabase, profile } = await getServerSession();

  if (!supabase) {
    return <p className="text-sm text-[var(--muted)]">Supabase is not configured.</p>;
  }

  let exams: Pick<Exam, 'id' | 'title' | 'subject' | 'status'>[] = [];
  if (profile?.school_id) {
    const { data } = await supabase
      .from('exams')
      .select('id, title, subject, status')
      .eq('school_id', profile.school_id)
      .order('created_at', { ascending: false });
    exams = data ?? [];
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Results</h1>
        <p className="text-sm text-[var(--muted)]">Open an exam to export scores or review sessions.</p>
      </div>
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)]">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Exam</TableHead>
              <TableHead>Subject</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Open</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {exams.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-sm text-[var(--muted)]">
                  No exams yet.
                </TableCell>
              </TableRow>
            ) : (
              exams.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="font-medium">{e.title}</TableCell>
                  <TableCell className="text-xs text-[var(--muted)]">{e.subject}</TableCell>
                  <TableCell className="text-xs">{e.status}</TableCell>
                  <TableCell className="text-right">
                    <Link href={`/results/${e.id}`} className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}>
                      Results
                    </Link>
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

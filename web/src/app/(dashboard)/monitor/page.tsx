import Link from 'next/link';
import { getServerSession } from '@/lib/session';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { Exam } from '@/lib/types';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export default async function MonitorIndexPage() {
  const { supabase, profile } = await getServerSession();

  if (!supabase) {
    return <p className="text-sm text-[var(--muted)]">Supabase is not configured.</p>;
  }

  let exams: Pick<Exam, 'id' | 'title' | 'status' | 'subject'>[] = [];
  if (profile?.school_id) {
    const { data } = await supabase
      .from('exams')
      .select('id, title, status, subject')
      .eq('school_id', profile.school_id)
      .order('created_at', { ascending: false });
    exams = data ?? [];
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Live monitor</h1>
        <p className="text-sm text-[var(--muted)]">Pick an exam to open the proctoring view.</p>
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
                  No exams yet. Create one under Exams.
                </TableCell>
              </TableRow>
            ) : (
              exams.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="font-medium">{e.title}</TableCell>
                  <TableCell className="text-xs text-[var(--muted)]">{e.subject}</TableCell>
                  <TableCell className="text-xs">{e.status}</TableCell>
                  <TableCell className="text-right">
                    <Link href={`/monitor/${e.id}`} className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}>
                      Monitor
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

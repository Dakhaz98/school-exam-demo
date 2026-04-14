import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getServerSession } from '@/lib/session';
import { CameraGrid } from '@/components/monitor/CameraGrid';
import { StudentCard } from '@/components/monitor/StudentCard';
import { PrivateChat } from '@/components/monitor/PrivateChat';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type Props = { params: Promise<{ examId: string }> };

export default async function MonitorExamPage({ params }: Props) {
  const { examId } = await params;
  const { supabase } = await getServerSession();

  if (!supabase) {
    return <p className="text-sm text-[var(--muted)]">Supabase is not configured.</p>;
  }

  const { data: exam } = await supabase.from('exams').select('id, title, status').eq('id', examId).maybeSingle();
  if (!exam) {
    notFound();
  }

  const { data: sessions } = await supabase
    .from('exam_sessions')
    .select('id, student_id, status, warnings_count, camera_active')
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
          <p className="text-sm text-[var(--muted)]">
            Status: {exam.status} · Session tiles are placeholders until LiveKit is wired.
          </p>
        </div>
        <Link href="/monitor" className={cn(buttonVariants({ variant: 'outline' }))}>
          All exams
        </Link>
      </div>
      <CameraGrid />
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-3">
          <p className="text-sm font-semibold">Students</p>
          {(sessions ?? []).length === 0 ? (
            <p className="text-sm text-[var(--muted)]">No sessions for this exam yet.</p>
          ) : (
            <ul className="space-y-2">
              {(sessions ?? []).map((s) => (
                <StudentCard
                  key={s.id}
                  name={names[s.student_id] ?? s.student_id.slice(0, 8)}
                  status={s.status}
                  warnings={s.warnings_count}
                  cameraOn={s.camera_active}
                />
              ))}
            </ul>
          )}
        </div>
        <PrivateChat examId={examId} />
      </div>
    </div>
  );
}

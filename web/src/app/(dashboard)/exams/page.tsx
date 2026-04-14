import { getServerSession } from '@/lib/session';
import { ExamCard } from '@/components/exams/ExamCard';
import { CreateExamForm } from '@/components/exams/CreateExamForm';
import type { Exam } from '@/lib/types';

export default async function ExamsPage() {
  const { supabase, profile } = await getServerSession();

  if (!supabase) {
    return <p className="text-sm text-[var(--muted)]">Supabase is not configured.</p>;
  }

  let exams: Exam[] = [];
  if (profile?.school_id) {
    const { data } = await supabase
      .from('exams')
      .select('*')
      .eq('school_id', profile.school_id)
      .order('created_at', { ascending: false });
    exams = (data ?? []) as Exam[];
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Exams</h1>
        <p className="text-sm text-[var(--muted)]">Drafts, scheduling, and links to builders.</p>
      </div>
      {!profile?.school_id ? (
        <p className="text-sm text-[var(--muted)]">Assign a school to your user to manage exams.</p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <div className="grid gap-4 sm:grid-cols-2">
            {exams.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">No exams yet. Create one on the right.</p>
            ) : (
              exams.map((exam) => <ExamCard key={exam.id} exam={exam} />)
            )}
          </div>
          <CreateExamForm />
        </div>
      )}
    </div>
  );
}

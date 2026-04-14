import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getServerSession } from '@/lib/session';
import { ModelSelector } from '@/components/exams/ModelSelector';
import { AssignModelForm } from '@/components/exams/AssignModelForm';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ExamModel } from '@/lib/types';

type Props = { params: Promise<{ id: string }> };

export default async function ExamModelsPage({ params }: Props) {
  const { id } = await params;
  const { supabase, profile } = await getServerSession();

  if (!supabase) {
    return <p className="text-sm text-[var(--muted)]">Supabase is not configured.</p>;
  }

  const { data: exam, error } = await supabase.from('exams').select('id, title, model_id').eq('id', id).maybeSingle();
  if (error || !exam) {
    notFound();
  }

  let models: ExamModel[] = [];
  if (profile?.school_id) {
    const { data } = await supabase.from('exam_models').select('*').eq('school_id', profile.school_id).order('created_at', { ascending: false });
    models = (data ?? []) as ExamModel[];
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Exam models</h1>
          <p className="text-sm text-[var(--muted)]">{exam.title}</p>
        </div>
        <Link href={`/exams/${id}/builder`} className={cn(buttonVariants({ variant: 'outline' }))}>
          Builder
        </Link>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <p className="mb-3 text-sm font-semibold">Models in your school</p>
          <ModelSelector models={models} />
        </div>
        {profile?.school_id ? (
          <AssignModelForm examId={exam.id} currentModelId={exam.model_id} models={models} />
        ) : (
          <p className="text-sm text-[var(--muted)]">School required to assign models.</p>
        )}
      </div>
    </div>
  );
}

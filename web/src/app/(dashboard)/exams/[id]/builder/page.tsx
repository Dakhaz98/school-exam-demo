import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getServerSession } from '@/lib/session';
import { QuestionBuilder } from '@/components/exams/QuestionBuilder';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type Props = { params: Promise<{ id: string }> };

export default async function ExamBuilderPage({ params }: Props) {
  const { id } = await params;
  const { supabase } = await getServerSession();

  if (!supabase) {
    return <p className="text-sm text-[var(--muted)]">Supabase is not configured.</p>;
  }

  const { data: exam, error } = await supabase.from('exams').select('id, title, model_id').eq('id', id).maybeSingle();
  if (error || !exam) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Question builder</h1>
          <p className="text-sm text-[var(--muted)]">{exam.title}</p>
        </div>
        <Link href={`/exams/${id}/models`} className={cn(buttonVariants({ variant: 'outline' }))}>
          Models
        </Link>
      </div>
      {!exam.model_id ? (
        <p className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm text-[var(--muted)]">
          This exam has no model attached yet. Open{' '}
          <Link href={`/exams/${id}/models`} className="text-[var(--primary)] hover:underline">
            Models
          </Link>{' '}
          to create or assign an exam model, then return here.
        </p>
      ) : (
        <QuestionBuilder modelId={exam.model_id} />
      )}
    </div>
  );
}

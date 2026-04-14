'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/** Placeholder UI — wire to Supabase `questions` / `question_options` as needed. */
export function QuestionBuilder({ modelId }: { modelId: string }) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--muted)]">Model ID: {modelId}</p>
      <Input label="Question text" placeholder="Enter stem" />
      <Input label="Marks" type="number" defaultValue={5} />
      <Button type="button">Save question (stub)</Button>
    </div>
  );
}

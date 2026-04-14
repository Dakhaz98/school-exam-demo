'use client';

import { Badge } from '@/components/ui/badge';
import type { ExamModel } from '@/lib/types';

export function ModelSelector({ models }: { models: ExamModel[] }) {
  if (!models.length) {
    return <p className="text-sm text-[var(--muted)]">No exam models in Supabase yet.</p>;
  }
  return (
    <ul className="space-y-2">
      {models.map((m) => (
        <li key={m.id} className="flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
          <span className="text-sm font-medium">{m.name}</span>
          <Badge>{m.is_approved ? 'Approved' : 'Draft'}</Badge>
        </li>
      ))}
    </ul>
  );
}

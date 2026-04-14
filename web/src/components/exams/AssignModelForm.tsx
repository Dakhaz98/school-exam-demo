'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { ExamModel } from '@/lib/types';

export function AssignModelForm({
  examId,
  currentModelId,
  models,
}: {
  examId: string;
  currentModelId: string | null;
  models: ExamModel[];
}) {
  const router = useRouter();
  const [modelId, setModelId] = useState(currentModelId ?? '');
  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);

  async function assign(e: React.FormEvent) {
    e.preventDefault();
    if (!modelId) return;
    setLoading(true);
    setError(null);
    const res = await fetch(`/api/exams/${examId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model_id: modelId }),
    });
    setLoading(false);
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? `Request failed (${res.status})`);
      return;
    }
    router.refresh();
  }

  async function createModel(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError(null);
    const res = await fetch('/api/exam-models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, subject }),
    });
    setCreating(false);
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? `Request failed (${res.status})`);
      return;
    }
    const created = (await res.json()) as { id: string };
    setModelId(created.id);
    setName('');
    setSubject('');
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <form onSubmit={(e) => void assign(e)} className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <p className="text-sm font-semibold">Attach model to exam</p>
        {models.length === 0 ? (
          <p className="text-xs text-[var(--muted)]">No models yet. Create one below.</p>
        ) : (
          <label className="flex flex-col gap-1.5 text-xs font-medium text-[var(--muted)]">
            Model
            <select
              className="h-10 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--foreground)]"
              value={modelId}
              onChange={(e) => setModelId(e.target.value)}
            >
              <option value="">Select…</option>
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} · {m.subject}
                </option>
              ))}
            </select>
          </label>
        )}
        {error ? <p className="text-xs text-[var(--danger)]">{error}</p> : null}
        <Button type="submit" disabled={loading || !modelId}>
          {loading ? 'Saving…' : 'Save assignment'}
        </Button>
      </form>

      <form onSubmit={(e) => void createModel(e)} className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <p className="text-sm font-semibold">New exam model (A/B/C)</p>
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} required placeholder="Model A" />
        <Input label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} required />
        <Button type="submit" disabled={creating}>
          {creating ? 'Creating…' : 'Create model'}
        </Button>
      </form>
    </div>
  );
}

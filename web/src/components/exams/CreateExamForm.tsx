'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function CreateExamForm() {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [subject, setSubject] = useState('');
  const [duration, setDuration] = useState('60');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const res = await fetch('/api/exams', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        subject,
        duration_minutes: Number(duration) || 60,
      }),
    });
    setLoading(false);
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? `Request failed (${res.status})`);
      return;
    }
    setTitle('');
    setSubject('');
    setDuration('60');
    router.refresh();
  }

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <p className="text-sm font-semibold">Create exam</p>
      <Input label="Title" value={title} onChange={(e) => setTitle(e.target.value)} required />
      <Input label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} required />
      <Input label="Duration (minutes)" type="number" min={5} value={duration} onChange={(e) => setDuration(e.target.value)} />
      {error ? <p className="text-xs text-[var(--danger)]">{error}</p> : null}
      <Button type="submit" disabled={loading}>
        {loading ? 'Creating…' : 'Create draft'}
      </Button>
    </form>
  );
}

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function CreateRoomForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [capacity, setCapacity] = useState('30');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const res = await fetch('/api/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        subject: subject || null,
        capacity: Number(capacity) || 30,
      }),
    });
    setLoading(false);
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? `Request failed (${res.status})`);
      return;
    }
    setName('');
    setSubject('');
    setCapacity('30');
    router.refresh();
  }

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <p className="text-sm font-semibold">Add room</p>
      <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} required />
      <Input label="Subject (optional)" value={subject} onChange={(e) => setSubject(e.target.value)} />
      <Input label="Capacity" type="number" min={1} value={capacity} onChange={(e) => setCapacity(e.target.value)} />
      {error ? <p className="text-xs text-[var(--danger)]">{error}</p> : null}
      <Button type="submit" disabled={loading}>
        {loading ? 'Saving…' : 'Create room'}
      </Button>
    </form>
  );
}

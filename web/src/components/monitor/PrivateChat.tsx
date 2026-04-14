'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function PrivateChat({ examId }: { examId?: string }) {
  const [text, setText] = useState('');
  return (
    <div className="space-y-3">
      <p className="text-sm font-semibold">Private chat</p>
      <div className="h-40 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-2 text-xs text-[var(--muted)]">
        Exam: <code>{examId ?? '—'}</code>. Messages will load from <code>private_messages</code>.
      </div>
      <div className="flex gap-2">
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Message" />
        <Button type="button" variant="secondary">
          Send
        </Button>
      </div>
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';

export function Topbar({ title = 'Dashboard', subtitle }: { title?: string; subtitle?: string }) {
  const [now, setNow] = useState('');

  useEffect(() => {
    const tick = () => setNow(new Date().toLocaleTimeString());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <header
      className="fixed left-60 right-0 top-0 z-30 flex h-14 items-center justify-between border-b border-[var(--border)] px-6"
      style={{ background: 'var(--surface)' }}
    >
      <div>
        <h1 className="text-base font-semibold text-[var(--foreground)]">{title}</h1>
        {subtitle ? <p className="text-xs text-[var(--muted)]">{subtitle}</p> : null}
      </div>
      <div className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-1.5 text-xs font-mono text-[var(--muted)]">
        <Clock className="h-3.5 w-3.5 text-[var(--primary)]" />
        <span className="text-[var(--foreground)]">{now}</span>
      </div>
    </header>
  );
}

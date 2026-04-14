import { Badge } from '@/components/ui/badge';

export function StudentCard({
  name,
  status,
  warnings,
  cameraOn,
}: {
  name: string;
  status: string;
  warnings?: number;
  cameraOn?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
      <span className="text-sm font-medium">{name}</span>
      <div className="flex flex-wrap items-center gap-2">
        {typeof warnings === 'number' ? (
          <span className="text-xs text-[var(--muted)]">Warnings: {warnings}</span>
        ) : null}
        {typeof cameraOn === 'boolean' ? (
          <span className="text-xs text-[var(--muted)]">Camera: {cameraOn ? 'on' : 'off'}</span>
        ) : null}
        <Badge>{status}</Badge>
      </div>
    </div>
  );
}

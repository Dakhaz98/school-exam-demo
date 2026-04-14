'use client';

export function CameraGrid() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          className="flex aspect-video items-center justify-center rounded-xl border border-dashed border-[var(--border)] text-xs text-[var(--muted)]"
        >
          LiveKit tile placeholder {i}
        </div>
      ))}
    </div>
  );
}

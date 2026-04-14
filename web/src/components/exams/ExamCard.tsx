import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { Exam } from '@/lib/types';

export function ExamCard({ exam }: { exam: Exam }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div>
          <CardTitle>{exam.title}</CardTitle>
          <p className="mt-1 text-xs text-[var(--muted)]">
            {exam.subject} · {exam.duration_minutes} min
          </p>
        </div>
        <Badge>{exam.status}</Badge>
      </CardHeader>
      <CardContent className="flex gap-2">
        <Link href={`/exams/${exam.id}/builder`} className="text-xs font-semibold text-[var(--primary)] hover:underline">
          Builder
        </Link>
        <span className="text-[var(--muted)]">·</span>
        <Link href={`/exams/${exam.id}/models`} className="text-xs font-semibold text-[var(--primary)] hover:underline">
          Models
        </Link>
      </CardContent>
    </Card>
  );
}

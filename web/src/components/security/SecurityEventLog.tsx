import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { SecurityEvent } from '@/lib/types';

export function SecurityEventLog({ events }: { events: SecurityEvent[] }) {
  if (!events.length) {
    return <p className="text-sm text-[var(--muted)]">No security events.</p>;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Time</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>Severity</TableHead>
          <TableHead>Description</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {events.map((e) => (
          <TableRow key={e.id}>
            <TableCell className="whitespace-nowrap text-xs">{new Date(e.created_at).toLocaleString()}</TableCell>
            <TableCell className="text-xs">{e.event_type}</TableCell>
            <TableCell className="text-xs">{e.severity}</TableCell>
            <TableCell className="text-xs text-[var(--muted)]">{e.description ?? '—'}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

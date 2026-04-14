import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const items = [
  { label: 'Active rooms', valueKey: 'activeRooms' as const },
  { label: 'Students online', valueKey: 'studentsOnline' as const },
  { label: 'Cameras active', valueKey: 'camerasActive' as const },
  { label: 'Security alerts', valueKey: 'securityAlerts' as const },
];

export function StatsGrid({
  stats,
}: {
  stats: { activeRooms: number; studentsOnline: number; camerasActive: number; securityAlerts: number };
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {items.map(({ label, valueKey }) => (
        <Card key={valueKey}>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-[var(--muted)]">{label}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-[var(--primary)]">{stats[valueKey]}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

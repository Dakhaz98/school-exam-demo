import Link from 'next/link';
import { getServerSession } from '@/lib/session';
import { StatsGrid } from '@/components/dashboard/StatsGrid';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export default async function DashboardPage() {
  const { supabase, profile } = await getServerSession();

  if (!supabase) {
    return (
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 text-sm text-[var(--muted)]">
        Set <code className="text-[var(--foreground)]">NEXT_PUBLIC_SUPABASE_URL</code> and{' '}
        <code className="text-[var(--foreground)]">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> in{' '}
        <code className="text-[var(--foreground)]">web/.env.local</code>, then restart the dev server.
      </div>
    );
  }

  if (!profile?.school_id) {
    return (
      <div className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 text-sm text-[var(--muted)]">
        <p>Your account has no school assigned. Ask an administrator to link your user row in Supabase to a school.</p>
        <Link href="/exams" className={cn(buttonVariants({ variant: 'outline' }))}>
          Go to exams
        </Link>
      </div>
    );
  }

  const schoolId = profile.school_id;

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [{ count: activeRooms }, { count: activeSessions }, { count: camerasActive }, { count: securityAlerts }] =
    await Promise.all([
      supabase
        .from('exam_rooms')
        .select('*', { count: 'exact', head: true })
        .eq('school_id', schoolId)
        .eq('is_active', true),
      supabase.from('exam_sessions').select('*', { count: 'exact', head: true }).eq('status', 'active'),
      supabase
        .from('exam_sessions')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'active')
        .eq('camera_active', true),
      supabase
        .from('security_events')
        .select('*', { count: 'exact', head: true })
        .eq('school_id', schoolId)
        .in('severity', ['high', 'critical'])
        .gte('created_at', since),
    ]);

  const stats = {
    activeRooms: activeRooms ?? 0,
    studentsOnline: activeSessions ?? 0,
    camerasActive: camerasActive ?? 0,
    securityAlerts: securityAlerts ?? 0,
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-sm text-[var(--muted)]">Signed in as {profile.full_name}</p>
        </div>
        <div className="flex gap-2">
          <Link href="/exams" className={cn(buttonVariants({ variant: 'outline' }))}>
            Exams
          </Link>
          <Link href="/monitor" className={cn(buttonVariants())}>
            Live monitor
          </Link>
        </div>
      </div>
      <StatsGrid stats={stats} />
    </div>
  );
}

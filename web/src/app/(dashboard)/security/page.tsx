import { getServerSession } from '@/lib/session';
import { SecurityEventLog } from '@/components/security/SecurityEventLog';
import type { SecurityEvent } from '@/lib/types';

export default async function SecurityPage() {
  const { supabase, profile } = await getServerSession();

  if (!supabase) {
    return <p className="text-sm text-[var(--muted)]">Supabase is not configured.</p>;
  }

  let events: SecurityEvent[] = [];
  if (profile?.school_id) {
    const { data } = await supabase
      .from('security_events')
      .select('*')
      .eq('school_id', profile.school_id)
      .order('created_at', { ascending: false })
      .limit(200);
    events = (data ?? []) as SecurityEvent[];
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Security</h1>
        <p className="text-sm text-[var(--muted)]">Recent events for your school (last 200 rows).</p>
      </div>
      {!profile?.school_id ? (
        <p className="text-sm text-[var(--muted)]">Assign a school to your user to view security events.</p>
      ) : (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <SecurityEventLog events={events} />
        </div>
      )}
    </div>
  );
}

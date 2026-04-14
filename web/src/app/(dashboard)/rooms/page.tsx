import { getServerSession } from '@/lib/session';
import { CreateRoomForm } from '@/components/rooms/CreateRoomForm';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { ExamRoom } from '@/lib/types';

export default async function RoomsPage() {
  const { supabase, profile } = await getServerSession();

  if (!supabase) {
    return <p className="text-sm text-[var(--muted)]">Supabase is not configured.</p>;
  }

  let rooms: ExamRoom[] = [];
  if (profile?.school_id) {
    const { data } = await supabase
      .from('exam_rooms')
      .select('*')
      .eq('school_id', profile.school_id)
      .order('created_at', { ascending: false });
    rooms = (data ?? []) as ExamRoom[];
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Exam rooms</h1>
        <p className="text-sm text-[var(--muted)]">Create and manage physical or virtual rooms.</p>
      </div>
      {!profile?.school_id ? (
        <p className="text-sm text-[var(--muted)]">Assign a school to your user to manage rooms.</p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Capacity</TableHead>
                  <TableHead>Active</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rooms.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-sm text-[var(--muted)]">
                      No rooms yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  rooms.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">{r.name}</TableCell>
                      <TableCell className="text-xs text-[var(--muted)]">{r.subject ?? '—'}</TableCell>
                      <TableCell className="text-xs">{r.capacity}</TableCell>
                      <TableCell className="text-xs">{r.is_active ? 'Yes' : 'No'}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          <CreateRoomForm />
        </div>
      )}
    </div>
  );
}

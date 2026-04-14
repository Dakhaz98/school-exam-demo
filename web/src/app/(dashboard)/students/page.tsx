import { getServerSession } from '@/lib/session';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { User } from '@/lib/types';

export default async function StudentsPage() {
  const { supabase, profile } = await getServerSession();

  if (!supabase) {
    return <p className="text-sm text-[var(--muted)]">Supabase is not configured.</p>;
  }

  let students: User[] = [];
  if (profile?.school_id) {
    const { data } = await supabase
      .from('users')
      .select('*')
      .eq('school_id', profile.school_id)
      .eq('role', 'student')
      .order('full_name', { ascending: true });
    students = (data ?? []) as User[];
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Students</h1>
        <p className="text-sm text-[var(--muted)]">Roster from Supabase (role = student).</p>
      </div>
      {!profile?.school_id ? (
        <p className="text-sm text-[var(--muted)]">Assign a school to your user to list students.</p>
      ) : (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Student ID</TableHead>
                <TableHead>Active</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {students.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-sm text-[var(--muted)]">
                    No students in this school yet.
                  </TableCell>
                </TableRow>
              ) : (
                students.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">{s.full_name}</TableCell>
                    <TableCell className="text-xs text-[var(--muted)]">{s.email}</TableCell>
                    <TableCell className="text-xs">{s.student_id ?? '—'}</TableCell>
                    <TableCell className="text-xs">{s.is_active ? 'Yes' : 'No'}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

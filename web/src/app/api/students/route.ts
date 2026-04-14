import { NextResponse } from 'next/server';
import { getApiAuth } from '@/lib/api-auth';

export async function GET() {
  const auth = await getApiAuth();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const { supabase, schoolId } = auth;
  const { data, error } = await supabase
    .from('users')
    .select('id, full_name, email, student_id, is_active, created_at')
    .eq('school_id', schoolId)
    .eq('role', 'student')
    .order('full_name', { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ students: data ?? [] });
}

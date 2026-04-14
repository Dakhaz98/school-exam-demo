import { NextResponse } from 'next/server';
import { getApiAuth } from '@/lib/api-auth';

export async function POST(request: Request) {
  const auth = await getApiAuth();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const body = (await request.json().catch(() => null)) as {
    name?: string;
    subject?: string | null;
    capacity?: number;
    description?: string | null;
  } | null;

  if (!body?.name?.trim()) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }

  const { supabase, schoolId } = auth;
  const { data, error } = await supabase
    .from('exam_rooms')
    .insert({
      school_id: schoolId,
      name: body.name.trim(),
      subject: body.subject?.trim() || null,
      capacity: typeof body.capacity === 'number' && body.capacity > 0 ? body.capacity : 30,
      description: body.description?.trim() || null,
    })
    .select('id')
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json(data);
}

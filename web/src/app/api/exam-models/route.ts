import { NextResponse } from 'next/server';
import { getApiAuth } from '@/lib/api-auth';

export async function POST(request: Request) {
  const auth = await getApiAuth();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const body = (await request.json().catch(() => null)) as { name?: string; subject?: string } | null;
  if (!body?.name?.trim() || !body?.subject?.trim()) {
    return NextResponse.json({ error: 'name and subject are required' }, { status: 400 });
  }

  const { supabase, schoolId, userId } = auth;
  const { data, error } = await supabase
    .from('exam_models')
    .insert({
      school_id: schoolId,
      name: body.name.trim(),
      subject: body.subject.trim(),
      created_by: userId,
    })
    .select('id')
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json(data);
}

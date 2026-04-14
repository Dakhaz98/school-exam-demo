import { NextResponse } from 'next/server';
import { getApiAuth } from '@/lib/api-auth';

export async function POST(request: Request) {
  const auth = await getApiAuth();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const body = (await request.json().catch(() => null)) as {
    title?: string;
    subject?: string;
    duration_minutes?: number;
    grade_level?: string | null;
  } | null;

  if (!body?.title?.trim() || !body?.subject?.trim()) {
    return NextResponse.json({ error: 'title and subject are required' }, { status: 400 });
  }

  const { supabase, schoolId, userId } = auth;
  const { data, error } = await supabase
    .from('exams')
    .insert({
      school_id: schoolId,
      title: body.title.trim(),
      subject: body.subject.trim(),
      duration_minutes: typeof body.duration_minutes === 'number' && body.duration_minutes > 0 ? body.duration_minutes : 60,
      grade_level: body.grade_level?.trim() || null,
      status: 'draft',
      created_by: userId,
    })
    .select('id')
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json(data);
}

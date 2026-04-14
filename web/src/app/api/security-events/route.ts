import { NextResponse } from 'next/server';
import { getApiAuth } from '@/lib/api-auth';

export async function POST(request: Request) {
  const auth = await getApiAuth();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const body = (await request.json().catch(() => null)) as {
    session_id?: string;
    event_type?: string;
    severity?: string;
    description?: string | null;
  } | null;

  if (!body?.session_id || !body?.event_type) {
    return NextResponse.json({ error: 'session_id and event_type are required' }, { status: 400 });
  }

  const { supabase, schoolId } = auth;
  const { data: session, error: sErr } = await supabase
    .from('exam_sessions')
    .select('id, student_id, exam_id')
    .eq('id', body.session_id)
    .maybeSingle();

  if (sErr || !session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  const { data: exam } = await supabase.from('exams').select('school_id').eq('id', session.exam_id).maybeSingle();
  if (!exam || exam.school_id !== schoolId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { error } = await supabase.from('security_events').insert({
    session_id: session.id,
    student_id: session.student_id,
    exam_id: session.exam_id,
    school_id: schoolId,
    event_type: body.event_type,
    severity: body.severity ?? 'medium',
    description: body.description ?? null,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}

import { NextResponse } from 'next/server';
import { getApiAuth } from '@/lib/api-auth';

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, ctx: Ctx) {
  const auth = await getApiAuth();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const { id } = await ctx.params;
  const body = (await request.json().catch(() => null)) as { model_id?: string | null; room_id?: string | null } | null;
  if (!body || Object.keys(body).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  }

  const { supabase, schoolId } = auth;
  const { data: exam, error: examErr } = await supabase.from('exams').select('id, school_id').eq('id', id).maybeSingle();
  if (examErr || !exam || exam.school_id !== schoolId) {
    return NextResponse.json({ error: 'Exam not found' }, { status: 404 });
  }

  if (body.model_id !== undefined && body.model_id !== null && body.model_id !== '') {
    const { data: model } = await supabase.from('exam_models').select('id, school_id').eq('id', body.model_id).maybeSingle();
    if (!model || model.school_id !== schoolId) {
      return NextResponse.json({ error: 'Invalid model' }, { status: 400 });
    }
  }

  if (body.room_id !== undefined && body.room_id !== null && body.room_id !== '') {
    const { data: room } = await supabase.from('exam_rooms').select('id, school_id').eq('id', body.room_id).maybeSingle();
    if (!room || room.school_id !== schoolId) {
      return NextResponse.json({ error: 'Invalid room' }, { status: 400 });
    }
  }

  const patch: Record<string, unknown> = {};
  if ('model_id' in body) patch.model_id = body.model_id ?? null;
  if ('room_id' in body) patch.room_id = body.room_id ?? null;

  const { error } = await supabase.from('exams').update(patch).eq('id', id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}

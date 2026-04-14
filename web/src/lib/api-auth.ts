import { createClient } from '@/lib/supabase/server';
import type { SupabaseClient } from '@supabase/supabase-js';

export type ApiAuthOk = {
  ok: true;
  supabase: SupabaseClient;
  userId: string;
  schoolId: string;
};

export type ApiAuthErr = { ok: false; status: number; message: string };

export type ApiAuth = ApiAuthOk | ApiAuthErr;

export async function getApiAuth(): Promise<ApiAuth> {
  const supabase = await createClient();
  if (!supabase) {
    return { ok: false, status: 503, message: 'Supabase not configured' };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, status: 401, message: 'Unauthorized' };
  }

  const { data: profile } = await supabase.from('users').select('school_id').eq('id', user.id).maybeSingle();
  if (!profile?.school_id) {
    return { ok: false, status: 403, message: 'User has no school assigned' };
  }

  return { ok: true, supabase, userId: user.id, schoolId: profile.school_id };
}

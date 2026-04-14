import type { User as SupabaseUser } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import type { SupabaseClient } from '@supabase/supabase-js';

export type AppProfile = {
  id: string;
  school_id: string | null;
  role: string;
  full_name: string;
  email: string;
};

export type ServerSession =
  | { supabase: null; user: null; profile: null }
  | { supabase: SupabaseClient; user: null; profile: null }
  | { supabase: SupabaseClient; user: SupabaseUser; profile: AppProfile | null };

export async function getServerSession(): Promise<ServerSession> {
  const supabase = await createClient();
  if (!supabase) {
    return { supabase: null, user: null, profile: null };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { supabase, user: null, profile: null };
  }

  const { data: profile } = await supabase
    .from('users')
    .select('id, school_id, role, full_name, email')
    .eq('id', user.id)
    .maybeSingle();

  return { supabase, user, profile: profile as AppProfile | null };
}

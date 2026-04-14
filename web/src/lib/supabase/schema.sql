-- School Exam Demo – Supabase / PostgreSQL schema (multi-tenant SaaS)
-- Run in Supabase SQL Editor (or psql). Order matters.

-- Enable UUID
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Schools (one per tenant)
CREATE TABLE schools (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  name_ar TEXT,
  logo_url TEXT,
  plan TEXT DEFAULT 'starter' CHECK (plan IN ('starter','school','campus','university')),
  max_students INTEGER DEFAULT 100,
  subdomain TEXT UNIQUE,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Users
CREATE TABLE users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  school_id UUID REFERENCES schools(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('super_admin','school_admin','teacher','student')),
  full_name TEXT NOT NULL,
  full_name_ar TEXT,
  student_id TEXT,
  email TEXT NOT NULL,
  avatar_url TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Exam Rooms
CREATE TABLE exam_rooms (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID REFERENCES schools(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  subject TEXT,
  capacity INTEGER DEFAULT 30,
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Room Monitors (teachers assigned to rooms)
CREATE TABLE room_monitors (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_id UUID REFERENCES exam_rooms(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  is_primary BOOLEAN DEFAULT false,
  UNIQUE(room_id, user_id)
);

-- Exam Models (A/B/C written by different teachers)
CREATE TABLE exam_models (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID REFERENCES schools(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  subject TEXT NOT NULL,
  created_by UUID REFERENCES users(id),
  is_approved BOOLEAN DEFAULT false,
  approved_by UUID REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Exams
CREATE TABLE exams (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID REFERENCES schools(id) ON DELETE CASCADE,
  room_id UUID REFERENCES exam_rooms(id),
  model_id UUID REFERENCES exam_models(id),
  title TEXT NOT NULL,
  subject TEXT NOT NULL,
  grade_level TEXT,
  duration_minutes INTEGER NOT NULL DEFAULT 60,
  total_marks INTEGER NOT NULL DEFAULT 100,
  pass_marks INTEGER DEFAULT 50,
  instructions TEXT,
  instructions_ar TEXT,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft','scheduled','live','done','cancelled')),
  randomize_questions BOOLEAN DEFAULT true,
  randomize_options BOOLEAN DEFAULT true,
  allow_camera BOOLEAN DEFAULT true,
  require_camera BOOLEAN DEFAULT false,
  prevent_copy BOOLEAN DEFAULT true,
  force_fullscreen BOOLEAN DEFAULT true,
  max_warnings INTEGER DEFAULT 3,
  access_password TEXT,
  scheduled_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Questions
CREATE TABLE questions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  model_id UUID REFERENCES exam_models(id) ON DELETE CASCADE,
  question_text TEXT NOT NULL,
  question_text_ar TEXT,
  question_type TEXT NOT NULL CHECK (question_type IN ('mcq','essay','true_false','short_answer')),
  marks INTEGER DEFAULT 5,
  order_index INTEGER DEFAULT 0,
  image_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Question Options (for MCQ and True/False)
CREATE TABLE question_options (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  question_id UUID REFERENCES questions(id) ON DELETE CASCADE,
  option_text TEXT NOT NULL,
  option_text_ar TEXT,
  is_correct BOOLEAN DEFAULT false,
  order_index INTEGER DEFAULT 0
);

-- Exam Sessions (one per student per exam)
CREATE TABLE exam_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  exam_id UUID REFERENCES exams(id) ON DELETE CASCADE,
  student_id UUID REFERENCES users(id) ON DELETE CASCADE,
  question_order JSONB,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  submitted_at TIMESTAMPTZ,
  last_activity TIMESTAMPTZ DEFAULT NOW(),
  total_score NUMERIC,
  status TEXT DEFAULT 'active' CHECK (status IN ('active','submitted','flagged','terminated')),
  warnings_count INTEGER DEFAULT 0,
  camera_active BOOLEAN DEFAULT false,
  ip_address TEXT,
  UNIQUE(exam_id, student_id)
);

-- Answers
CREATE TABLE answers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id UUID REFERENCES exam_sessions(id) ON DELETE CASCADE,
  question_id UUID REFERENCES questions(id),
  selected_option_id UUID REFERENCES question_options(id),
  text_answer TEXT,
  ai_score NUMERIC,
  ai_feedback TEXT,
  manual_score NUMERIC,
  is_correct BOOLEAN,
  saved_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(session_id, question_id)
);

-- Security Events
CREATE TABLE security_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id UUID REFERENCES exam_sessions(id) ON DELETE CASCADE,
  student_id UUID REFERENCES users(id),
  exam_id UUID REFERENCES exams(id),
  school_id UUID REFERENCES schools(id),
  event_type TEXT NOT NULL CHECK (event_type IN (
    'tab_switch','copy_attempt','paste_attempt','context_menu',
    'devtools_open','fullscreen_exit','camera_off','mic_off',
    'idle_timeout','multiple_faces','no_face','wrong_person',
    'login_failed','exam_terminated','warning_issued'
  )),
  severity TEXT DEFAULT 'medium' CHECK (severity IN ('low','medium','high','critical')),
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Private Messages (teacher <-> student during exam)
CREATE TABLE private_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  exam_id UUID REFERENCES exams(id) ON DELETE CASCADE,
  from_id UUID REFERENCES users(id),
  to_id UUID REFERENCES users(id),
  message TEXT NOT NULL,
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Row Level Security
ALTER TABLE schools ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE exam_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE exams ENABLE ROW LEVEL SECURITY;
ALTER TABLE exam_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE security_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE private_messages ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────
-- RLS policies (required for client + server Supabase queries)
-- Adjust for production (e.g. stricter super_admin paths).
-- ─────────────────────────────────────────────────────────────

CREATE POLICY schools_anon_login_list ON schools FOR SELECT TO anon USING (is_active = true);

CREATE POLICY schools_auth_member ON schools FOR SELECT TO authenticated
  USING (
    is_active = true
    AND (
      id IN (SELECT u.school_id FROM public.users u WHERE u.id = auth.uid() AND u.school_id IS NOT NULL)
    )
  );

CREATE POLICY users_self_and_org ON users FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR (
      school_id IS NOT NULL
      AND school_id = (SELECT u.school_id FROM public.users u WHERE u.id = auth.uid())
    )
  );

CREATE POLICY users_update_self ON users FOR UPDATE TO authenticated
  USING (id = auth.uid()) WITH CHECK (id = auth.uid());

CREATE POLICY exam_rooms_school ON exam_rooms FOR ALL TO authenticated
  USING (school_id = (SELECT u.school_id FROM public.users u WHERE u.id = auth.uid()))
  WITH CHECK (school_id = (SELECT u.school_id FROM public.users u WHERE u.id = auth.uid()));

CREATE POLICY exams_school ON exams FOR ALL TO authenticated
  USING (school_id = (SELECT u.school_id FROM public.users u WHERE u.id = auth.uid()))
  WITH CHECK (school_id = (SELECT u.school_id FROM public.users u WHERE u.id = auth.uid()));

CREATE POLICY exam_sessions_school ON exam_sessions FOR ALL TO authenticated
  USING (
    exam_id IN (
      SELECT e.id FROM public.exams e
      WHERE e.school_id = (SELECT u.school_id FROM public.users u WHERE u.id = auth.uid())
    )
  )
  WITH CHECK (
    exam_id IN (
      SELECT e.id FROM public.exams e
      WHERE e.school_id = (SELECT u.school_id FROM public.users u WHERE u.id = auth.uid())
    )
  );

CREATE POLICY security_events_school ON security_events FOR ALL TO authenticated
  USING (
    school_id IS NULL
    OR school_id = (SELECT u.school_id FROM public.users u WHERE u.id = auth.uid())
  )
  WITH CHECK (
    school_id IS NULL
    OR school_id = (SELECT u.school_id FROM public.users u WHERE u.id = auth.uid())
  );

CREATE POLICY private_messages_school ON private_messages FOR ALL TO authenticated
  USING (
    exam_id IN (
      SELECT e.id FROM public.exams e
      WHERE e.school_id = (SELECT u.school_id FROM public.users u WHERE u.id = auth.uid())
    )
  )
  WITH CHECK (
    exam_id IN (
      SELECT e.id FROM public.exams e
      WHERE e.school_id = (SELECT u.school_id FROM public.users u WHERE u.id = auth.uid())
    )
  );

/** Types aligned with `src/lib/supabase/schema.sql` */

export type UserRole = 'super_admin' | 'school_admin' | 'teacher' | 'student';
export type ExamStatus = 'draft' | 'scheduled' | 'live' | 'done' | 'cancelled';
export type SessionStatus = 'active' | 'submitted' | 'flagged' | 'terminated';
export type QuestionType = 'mcq' | 'essay' | 'true_false' | 'short_answer';
export type Severity = 'low' | 'medium' | 'high' | 'critical';
export type Plan = 'starter' | 'school' | 'campus' | 'university';

export type SecurityEventType =
  | 'tab_switch'
  | 'copy_attempt'
  | 'paste_attempt'
  | 'context_menu'
  | 'devtools_open'
  | 'fullscreen_exit'
  | 'camera_off'
  | 'mic_off'
  | 'idle_timeout'
  | 'multiple_faces'
  | 'no_face'
  | 'wrong_person'
  | 'login_failed'
  | 'exam_terminated'
  | 'warning_issued';

export interface School {
  id: string;
  name: string;
  name_ar: string | null;
  logo_url: string | null;
  plan: Plan;
  max_students: number;
  subdomain: string | null;
  is_active: boolean;
  created_at: string;
}

export interface User {
  id: string;
  school_id: string | null;
  role: UserRole;
  full_name: string;
  full_name_ar: string | null;
  student_id: string | null;
  email: string;
  avatar_url: string | null;
  is_active: boolean;
  created_at: string;
}

export interface ExamRoom {
  id: string;
  school_id: string;
  name: string;
  subject: string | null;
  capacity: number;
  description: string | null;
  is_active: boolean;
  created_at: string;
}

export interface ExamModel {
  id: string;
  school_id: string;
  name: string;
  subject: string;
  created_by: string | null;
  is_approved: boolean;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
}

export interface Exam {
  id: string;
  school_id: string;
  room_id: string | null;
  model_id: string | null;
  title: string;
  subject: string;
  grade_level: string | null;
  duration_minutes: number;
  total_marks: number;
  pass_marks: number;
  instructions: string | null;
  instructions_ar: string | null;
  status: ExamStatus;
  randomize_questions: boolean;
  randomize_options: boolean;
  allow_camera: boolean;
  require_camera: boolean;
  prevent_copy: boolean;
  force_fullscreen: boolean;
  max_warnings: number;
  access_password: string | null;
  scheduled_at: string | null;
  started_at: string | null;
  ended_at: string | null;
  created_by: string | null;
  created_at: string;
}

export interface ExamSession {
  id: string;
  exam_id: string;
  student_id: string;
  question_order: unknown;
  started_at: string;
  submitted_at: string | null;
  last_activity: string;
  total_score: number | null;
  status: SessionStatus;
  warnings_count: number;
  camera_active: boolean;
  ip_address: string | null;
}

export interface SecurityEvent {
  id: string;
  session_id: string;
  student_id: string | null;
  exam_id: string | null;
  school_id: string | null;
  event_type: SecurityEventType;
  severity: Severity;
  description: string | null;
  created_at: string;
}

export interface DashboardStats {
  activeRooms: number;
  studentsOnline: number;
  camerasActive: number;
  securityAlerts: number;
}

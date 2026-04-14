import Link from 'next/link';

export default function HomePage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6" style={{ background: 'var(--background)' }}>
      <h1 className="text-3xl font-bold mb-2" style={{ color: 'var(--foreground)' }}>
        School Exam Demo
      </h1>
      <p className="text-center max-w-md mb-8" style={{ color: 'var(--muted)' }}>
        Next.js app (English UI). Configure Supabase in <code className="text-[var(--primary)]">web/.env.local</code>, then sign in.
      </p>
      <Link
        href="/login"
        className="px-6 py-3 rounded-xl font-semibold"
        style={{ background: 'var(--primary)', color: 'var(--background)' }}
      >
        Go to login
      </Link>
    </div>
  );
}

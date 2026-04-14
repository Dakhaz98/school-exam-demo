'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectRaw = searchParams.get('redirect') ?? '/dashboard';
  const redirect = redirectRaw.startsWith('/') ? redirectRaw : '/dashboard';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { error: signError } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (signError) {
      setError(signError.message);
      return;
    }
    router.replace(redirect);
    router.refresh();
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--background)] p-6">
      <div className="w-full max-w-md space-y-6 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-8">
        <div>
          <h1 className="text-xl font-bold">School Exam Demo</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">Sign in to continue.</p>
        </div>
        <form onSubmit={(e) => void onSubmit(e)} className="space-y-4">
          <Input
            label="Email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <Input
            label="Password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
        <p className="text-center text-xs text-[var(--muted)]">
          <Link href="/" className="text-[var(--primary)] hover:underline">
            Back to home
          </Link>
        </p>
      </div>
    </div>
  );
}

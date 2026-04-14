'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { LayoutDashboard, DoorOpen, FileText, MonitorPlay, BarChart3, Users, Shield, LogOut } from 'lucide-react';
import { cn } from '@/lib/utils';
import { createClient } from '@/lib/supabase/client';

const nav = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/rooms', label: 'Rooms', icon: DoorOpen },
  { href: '/exams', label: 'Exams', icon: FileText },
  { href: '/monitor', label: 'Live monitor', icon: MonitorPlay },
  { href: '/results', label: 'Results', icon: BarChart3 },
  { href: '/students', label: 'Students', icon: Users },
  { href: '/security', label: 'Security', icon: Shield },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
  }

  return (
    <aside
      className="fixed left-0 top-0 z-40 flex h-full w-60 flex-col border-r border-[var(--border)]"
      style={{ background: 'var(--surface)' }}
    >
      <div className="flex items-center gap-2 border-b border-[var(--border)] px-4 py-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg" style={{ background: 'var(--primary)' }}>
          <FileText className="h-4 w-4 text-[#041016]" />
        </div>
        <div>
          <p className="text-sm font-bold">School Exam Demo</p>
          <p className="text-xs text-[var(--muted)]">SaaS console</p>
        </div>
      </div>
      <nav className="flex flex-1 flex-col gap-1 p-3">
        {nav.map(({ href, label, icon: Icon }) => {
          const active =
            href === '/dashboard' ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition',
                active ? 'bg-[var(--surface-2)] text-[var(--primary)]' : 'text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--foreground)]'
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-[var(--border)] p-3">
        <button
          type="button"
          onClick={() => void logout()}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-[var(--danger)] hover:bg-[var(--surface-2)]"
        >
          <LogOut className="h-4 w-4" />
          Log out
        </button>
      </div>
    </aside>
  );
}

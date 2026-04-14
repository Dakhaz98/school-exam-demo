import * as React from 'react';
import { cn } from '@/lib/utils';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className, label, ...props }, ref) => (
  <div className="flex flex-col gap-1.5 w-full">
    {label ? <label className="text-xs font-medium text-[var(--muted)]">{label}</label> : null}
    <input
      ref={ref}
      className={cn(
        'h-10 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--foreground)] placeholder:text-[var(--muted)]',
        'focus:outline-none focus:ring-2 focus:ring-[var(--primary)]',
        className
      )}
      {...props}
    />
  </div>
));
Input.displayName = 'Input';

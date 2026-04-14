import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-xl text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-[var(--primary)] text-[#041016] hover:bg-[var(--primary-hover)]',
        outline: 'border border-[var(--border)] bg-transparent text-[var(--foreground)] hover:bg-[var(--surface-2)]',
        ghost: 'text-[var(--foreground)] hover:bg-[var(--surface-2)]',
        secondary: 'bg-[var(--surface-2)] border border-[var(--border)] text-[var(--foreground)]',
      },
      size: {
        default: 'h-10 px-4',
        sm: 'h-8 px-3 text-xs',
        lg: 'h-12 px-6',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, loading, children, disabled, ...props }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size, className }))} disabled={disabled || loading} {...props}>
      {loading ? 'Loading…' : children}
    </button>
  )
);
Button.displayName = 'Button';

import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/**
 * Button — v3 `.as-btn`, expressed as Tailwind utilities over the token
 * layer rather than as a hand-written class.
 *
 * Two rules from CONTRACT.md are load-bearing here and are easy to undo by
 * accident:
 *
 *  1. A button is BORDER-drawn, never shadow-drawn. "Nothing carries a
 *     border AND a shadow" — an edge is drawn once, by one means. Do not
 *     add `shadow-*` to any variant below.
 *  2. The focus ring is declared ONCE, globally, in globals.css (2px indigo
 *     at 2px offset). This component therefore does not set a ring and must
 *     never set `outline-none` — §10: "Do not remove outlines." The previous
 *     version did exactly that and then rebuilt its own ring in brand teal.
 */
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-chip text-[15px] font-medium transition-colors disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        /* The one interactive colour. Blue means "you can act on this". */
        default: 'bg-blue text-page hover:bg-blue-press',
        /* v3 `.is-quiet` — a real edge, no fill until hover. */
        outline: 'border border-line bg-page text-text-1 hover:bg-wash',
        ghost: 'text-text-1 hover:bg-wash',
        /* Red means a failure or something that needs a person. A
           destructive button is the second reading, so it is allowed. */
        destructive: 'bg-red text-page hover:bg-red/90',
      },
      size: {
        default: 'h-11 px-4',
        sm: 'h-9 px-3 text-[13px]',
        lg: 'h-12 px-6',
        icon: 'h-11 w-11',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  }
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  )
);
Button.displayName = 'Button';

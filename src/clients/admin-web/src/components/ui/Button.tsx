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
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-chip text-body font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        /* THE PRIMARY FILL IS BRAND GREEN (2026-09-02), and the swap is the
           one place in this pass where chrome and data colour sit close
           enough together to need a sentence.

           A BUTTON IS NOT A READING. It is an affordance — "you can do this
           thing" — and it asserts nothing about a number, so it is chrome and
           the brand may own it. What it must NOT do is look like a verdict,
           which is why `--color-brand` (#0f5c3d) is a markedly deeper forest
           than `--color-green` (#0f8a5f, "positive"): the two never read as
           the same green side by side. See globals.css §A.11.

           Blue keeps everything it had. It is still §A.4's "interactive" on
           links, active facets, filter chips and the focus ring; what it
           stops being is the console's identity, which it never was. */
        default: 'bg-brand text-page hover:bg-brand-press',
        /* v3 `.is-quiet` — a real edge, no fill until hover. The edge is
           `--color-control-edge` (3.80:1 on a glass panel), not the divider
           hairline it used to be (1.25:1): WCAG 1.4.11 governs the boundary
           of a control, and a button a low-vision reader cannot find is not
           a quiet button, it is a missing one. The fill is `glass-quiet`, so
           an outline button on a glass panel is part of the pane rather than
           an opaque white rectangle sitting on it. */
        outline: 'glass-quiet border-control-edge text-text-1 hover:bg-wash',
        ghost: 'text-text-1 hover:bg-wash',
        /* Red means a failure or something that needs a person. A
           destructive button is the second reading, so it is allowed. */
        destructive: 'bg-red text-page hover:bg-red/90',
      },
      /* Every step grew with the type scale (globals.css §A.1). A 44px
         button around 17px text is tight; these also clear the 44px pointer
         target on the two smaller steps, which the old `sm` at 36px did
         not. */
      size: {
        default: 'h-12 px-5',
        sm: 'h-10 px-4 text-caption',
        lg: 'h-14 px-7',
        icon: 'h-12 w-12',
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

// One icon set for every place the day's parts appear (the ring's own flat two-tone icons, icons.ts), so a part looks the same on the
// ring, on the result screen, in the schedule, on the day cards and on the home. The markup is a static trusted string from icons.ts.
import type { CSSProperties, ReactNode } from 'react';
import { ICONS, type IconName } from './icons';

export interface CategoryIconProps { name: IconName; size?: number; className?: string; style?: CSSProperties }

export function CategoryIcon({ name, size = 24, className, style }: CategoryIconProps): ReactNode {
  return (
    <span aria-hidden="true" data-icon={name} className={`inline-block shrink-0 [&>svg]:block [&>svg]:h-full [&>svg]:w-full ${className ?? ''}`}
      style={{ width: size, height: size, ...style }} dangerouslySetInnerHTML={{ __html: ICONS[name] }} />
  );
}

export default CategoryIcon;

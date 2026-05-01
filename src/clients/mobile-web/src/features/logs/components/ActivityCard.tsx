/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

// Re-export shim — preserves the original import path
// `import ActivityCard from '../components/ActivityCard'` for callers,
// while the actual implementation lives in `./activity-card/`.
// See `activity-card/ActivityCard.tsx` and the per-sheet/component modules.

export { default } from './activity-card/ActivityCard';
export type { ActivityCardProps } from './activity-card/ActivityCardProps';

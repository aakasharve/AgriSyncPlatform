// Sub-plan 04 Task 6 — backwards-compat shim. ProfilePage now lives at
// `features/profile/ProfilePage.tsx`; AppRouter's lazy import + the upstream
// 9569047 snapshot test still reference this path.
export { default } from '../features/profile/ProfilePage';
export type { ProfileTab } from '../features/profile/ProfilePage';

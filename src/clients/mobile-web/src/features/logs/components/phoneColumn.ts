/**
 * The width of the app's phone column — the same numbers as `AppShell` (480px; 640px from `md`; 720px from `xl`).
 * Anything drawn `fixed` over the app (full-screen sheets, bottom sheets, floating tools) lives INSIDE this column
 * (centred, the sides dimmed), so on a wide window it lines up with the app instead of stretching edge to edge.
 */
export const PHONE_COLUMN = 'w-full max-w-[480px] md:max-w-[640px] xl:max-w-[720px]';

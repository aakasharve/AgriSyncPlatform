/**
 * CR-3 (K22): the names behind farm ids come from the contacts route, which needs the All farms
 * tick. When the server refuses it, a page says so instead of silently keeping the short id
 * (which would read as "this farm has no name"). Renders nothing unless `refused`.
 */
export function FarmNamesNeedTick({ refused }: { refused: boolean }) {
  if (!refused) return null;
  return (
    <p data-farm-names-refused="true" role="note" className="rounded-chip bg-tint-amber px-4 py-2 text-body text-text-1">
      Farm names need the All farms tick. Until then each farm shows by its short id.
    </p>
  );
}

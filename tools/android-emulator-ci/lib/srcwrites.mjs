// Classifies <audio> src writes for ONE selected element in the window from a real tap until playback starts.
// Pure function (unit-tested, including a fixture that reproduces the old double-write behaviour).
export function classifySrcWrites(writes, { selectedElId, tTap, tEnd }) {
  const mine = selectedElId == null ? [] : writes.filter((w) => w.elId === selectedElId);
  const inWindow = mine.filter((w) => w.t >= tTap && w.t <= tEnd);
  const before = mine.filter((w) => w.t < tTap);
  return {
    inWindow,
    before,
    otherElementWrites: writes.length - mine.length,
    // The old first-tap bug wrote src twice on the element for one tap (by hand, then again via React).
    doubleWrite: inWindow.length >= 2,
    ok: inWindow.length <= 1,
  };
}

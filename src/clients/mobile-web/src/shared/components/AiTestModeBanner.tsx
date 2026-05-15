import React, { useEffect, useState } from 'react';
import { readAiTestModeSnapshot } from '../../infrastructure/storage/AiTestModeStore';

// Routed through infrastructure/storage/AiTestModeStore per the
// localStorage-discipline gate (Sub-plan 04 Task 3). The store hides the
// three raw keys (flag, bucket, count) behind a typed API.
function readState() {
  return readAiTestModeSnapshot();
}

export const AiTestModeBanner: React.FC = () => {
  const [state, setState] = useState(readState);

  useEffect(() => {
    const onStorage = () => setState(readState());
    window.addEventListener('storage', onStorage);
    // Same-tab updates don't fire 'storage'; poll lightly.
    const id = window.setInterval(onStorage, 1000);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.clearInterval(id);
    };
  }, []);

  if (!state) return null;

  const meta = (typeof import.meta !== 'undefined' ? import.meta : undefined) as
    | { env?: { VITE_BUILD_SHA?: string } }
    | undefined;
  const buildSha = meta?.env?.VITE_BUILD_SHA ?? 'dev';

  return (
    <div
      style={{
        background: '#7f1d1d',
        color: 'white',
        padding: '6px 12px',
        fontSize: 12,
        fontFamily: "'DM Sans', sans-serif",
        display: 'flex',
        gap: 12,
        alignItems: 'center',
        zIndex: 9999,
      }}
      role="status"
      aria-live="polite"
    >
      <span>🧪 AI TEST MODE</span>
      <span>·</span>
      <span>bucket: {state.bucket}</span>
      <span>·</span>
      <span>{state.count} captured</span>
      <span>·</span>
      <span>build: {buildSha}</span>
    </div>
  );
};

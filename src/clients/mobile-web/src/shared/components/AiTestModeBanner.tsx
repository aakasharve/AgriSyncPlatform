import React, { useEffect, useState } from 'react';

const FLAG_KEY = 'agrisync_ai_test_mode';
const BUCKET_KEY = 'agrisync_ai_test_bucket';
const COUNT_KEY = 'agrisync_ai_test_capture_count';

function readState() {
  if (typeof window === 'undefined') return null;
  if (window.localStorage.getItem(FLAG_KEY) !== 'true') return null;
  return {
    bucket: window.localStorage.getItem(BUCKET_KEY) ?? '—',
    count: window.localStorage.getItem(COUNT_KEY) ?? '0',
  };
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

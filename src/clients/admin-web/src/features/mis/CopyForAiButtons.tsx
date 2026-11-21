/**
 * COPY FOR AI buttons (CR-3 Task A8, D-156b): "Copy for AI (text)" and
 * "Copy as JSON" in the page header of every Company MIS page. The pack goes to
 * the person's own clipboard and nowhere else. When the clipboard cannot be
 * written (no clipboard in this browser, or the write is refused) the pack opens
 * in a selectable box instead, so the button never silently does nothing.
 */
import { useEffect, useRef, useState } from 'react';
import type { CompanyMis } from '@/hooks/useCompanyMis';
import type { MisSectionKey } from './misItems';
import { misToAiJson, misToAiText } from './copyForAi';
import { cx } from './MisUi';

type Kind = 'text' | 'json';

const COPIED_MS = 2000;

const BUTTON = 'rounded-lg px-3 py-1.5 text-[13px] font-medium ring-1 ring-stone-200 bg-white text-stone-700 hover:bg-stone-50';

/** True when the browser took the text; false when there is no clipboard or the write was refused. */
async function writeToClipboard(pack: string): Promise<boolean> {
  const clip = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
  if (!clip || typeof clip.writeText !== 'function') return false;
  try {
    await clip.writeText(pack);
    return true;
  } catch {
    return false;
  }
}

function CopyForAiPack({ answer, section, analyticsSentence }: { answer: CompanyMis; section: MisSectionKey; analyticsSentence: string | null }) {
  const [copied, setCopied] = useState<Kind | null>(null);
  const [shownPack, setShownPack] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const copy = async (kind: Kind) => {
    const opts = { analyticsSentence };
    const pack = kind === 'text' ? misToAiText(answer, section, opts) : misToAiJson(answer, section, opts);
    const written = await writeToClipboard(pack);
    if (!written) {
      setCopied(null);
      setShownPack(pack);
      return;
    }
    setShownPack(null);
    setCopied(kind);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(null), COPIED_MS);
  };

  return (
    <div className="flex flex-col items-start gap-2" data-testid="mis-copy-for-ai">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={cx(BUTTON)} onClick={() => { void copy('text'); }}>
          {copied === 'text' ? 'Copied' : 'Copy for AI (text)'}
        </button>
        <button type="button" className={cx(BUTTON)} onClick={() => { void copy('json'); }}>
          {copied === 'json' ? 'Copied' : 'Copy as JSON'}
        </button>
      </div>
      {shownPack !== null && (
        <div className="w-full max-w-[72ch]">
          <p className="mb-1 text-[12px] text-stone-500">This browser would not copy it. Select all of it below and copy it yourself.</p>
          <textarea
            readOnly
            aria-label="Copy this text"
            value={shownPack}
            rows={10}
            className="w-full rounded-lg border-0 bg-white p-2 text-[12px] text-stone-800 ring-1 ring-stone-200"
            onFocus={(e) => e.currentTarget.select()}
            ref={(el) => { if (el) el.select(); }}
          />
        </div>
      )}
    </div>
  );
}

/**
 * The pack and its "Copied" belong to one page, one range and one answer. A change of any of them
 * starts the buttons afresh, so a box left open never shows another page's numbers.
 */
export function CopyForAiButtons({
  answer,
  section,
  analyticsSentence = null,
}: {
  answer: CompanyMis;
  section: MisSectionKey;
  /** W-1: the sentence for "app events are not being recorded", from the answer's envelope; null when recording. */
  analyticsSentence?: string | null;
}) {
  return (
    <CopyForAiPack
      key={`${section}:${answer.range.from}:${answer.range.to}:${answer.countedAtUtc}:${analyticsSentence ?? ''}`}
      answer={answer}
      section={section}
      analyticsSentence={analyticsSentence}
    />
  );
}

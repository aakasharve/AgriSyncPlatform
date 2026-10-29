/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I22, founder D-4) — TEST BUILD ONLY (the page draws this
 * only when `useSectionLayout().preview` exists, i.e. `IS_LAYOUT_PREVIEW_ENABLED`).
 *
 * "Show the three proposed versions at phone size, including first visit and reopening, using the same farm
 * data … Until role-specific views are implemented, label this as an owner-layout preview." So: the label, the
 * three versions on the real page over the real data, one line each on what it changes against LIVE, and
 * "पहिली भेट" to see a version as a first-time visitor again (it forgets this version's folds and order).
 * Every Marathi string is PROPOSED.
 */
import React from 'react';
import { Tap } from './ui';
import type { LayoutVersion } from './sectionLayout';

const VERSIONS: readonly { v: LayoutVersion; name: string; line: string }[] = [
    { v: 'v1', name: 'सगळे उघडे', line: 'सगळे विभाग नेहमी उघडे. दुमडलेले विभाग आणि क्रम लक्षात राहत नाहीत (आताचे ॲप ते लक्षात ठेवते).' },
    { v: 'v2', name: 'तुमची निवड', line: 'पहिल्या भेटीत शेताची स्थिती, करायची कामे, प्लॉटनिहाय काम उघडे; बाकी दुमडलेले. नंतर तुमची निवड आणि क्रम लक्षात राहतो.' },
    { v: 'v3', name: 'आताच्या ॲपसारखे', line: 'निवड आणि क्रम लक्षात राहतो; कॅलेंडर आणि उत्पन्न-खर्च एका वेळी एकच उघडतो.' },
];

export const LayoutPreviewSwitch: React.FC<{
    version: LayoutVersion;
    onVersion: (v: LayoutVersion) => void;
    onFirstVisit: () => void;
}> = ({ version, onVersion, onFirstVisit }) => (
    <div className="rounded-[22px] border-2 border-dashed border-violet-300 bg-violet-50/70 p-3" data-testid="reflect-layout-preview">
        <p className="m-0 text-[15px] font-extrabold text-violet-900" data-testid="reflect-owner-preview-label">मालकाचा आढावा — नमुना</p>
        <p className="m-0 mt-0.5 text-[12.5px] font-semibold leading-snug text-violet-800">
            फक्त चाचणी ॲपमध्ये दिसते. मजूर किंवा मुकादम यांचा आढावा अजून वेगळा तयार झालेला नाही.
        </p>
        <div className="mt-2 grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="आढाव्याची मांडणी">
            {VERSIONS.map(x => (
                <Tap key={x.v} onClick={() => onVersion(x.v)} role="radio" aria-checked={version === x.v} data-testid={`reflect-layout-${x.v}`}
                    className={`min-h-[44px] rounded-full px-2 text-[13.5px] font-extrabold ring-1 ${version === x.v ? 'bg-violet-700 text-white ring-violet-700' : 'bg-white text-violet-900 ring-violet-300'}`}>
                    {x.name}
                </Tap>
            ))}
        </div>
        <p className="m-0 mt-2 text-[12.5px] font-semibold leading-snug text-stone-700" data-testid="reflect-layout-line">
            {VERSIONS.find(x => x.v === version)?.line}
        </p>
        <Tap onClick={onFirstVisit} data-testid="reflect-layout-first-visit"
            className="mt-2 min-h-[42px] w-full rounded-full border-2 border-violet-500 bg-white text-[14px] font-extrabold text-violet-900">
            पहिली भेट पुन्हा पाहा
        </Tap>
    </div>
);

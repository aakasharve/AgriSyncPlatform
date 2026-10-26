/**
 * Where a schedule came from: the schedule it was copied from (with its version and author) and when it was
 * published. spec: plr-d10 (I15, S15) — the same facts, now in plain Marathi for the शेड्यूल page (it said
 * "Derived from … · Published 3 days ago · Draft"). Shows nothing when neither fact is known.
 */
import React from 'react';

interface LineageRibbonProps {
    derivedFromTemplateId?: string | null;
    derivedFromName?: string | null;
    version?: number;
    author?: string | null;
    publishedAtUtc?: string | null;
}

/** "आज" / "काल" / "N दिवसांपूर्वी". */
export const publishedAgo = (utc: string, nowMs: number = Date.now()): string => {
    const days = Math.floor((nowMs - new Date(utc).getTime()) / 86400000);
    if (days <= 0) return 'आज'; // PROPOSED (Marathi)
    if (days === 1) return 'काल'; // PROPOSED (Marathi)
    return `${days} दिवसांपूर्वी`; // PROPOSED (Marathi)
};

const LineageRibbon: React.FC<LineageRibbonProps> = ({
    derivedFromTemplateId,
    derivedFromName,
    version,
    author,
    publishedAtUtc,
}) => {
    if (!derivedFromTemplateId && !publishedAtUtc) return null;

    return (
        <div
            className="mt-1 flex flex-wrap items-center gap-2 text-[13px] font-bold text-stone-300"
            style={{ fontFamily: "'Noto Sans Devanagari', sans-serif" }}
            data-testid="lineage-ribbon"
        >
            {derivedFromTemplateId && derivedFromName && (
                <span className="rounded-full bg-white/10 px-2 py-0.5">
                    {/* PROPOSED (Marathi) */}
                    यावरून बनवलं: <span className="font-extrabold">{derivedFromName}</span>
                    {version != null && ` · आवृत्ती ${version}`}
                    {author && ` · ${author}`}
                </span>
            )}
            {publishedAtUtc ? (
                <span className="inline-flex items-center gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    {/* PROPOSED (Marathi) */}
                    <span>प्रकाशित: {publishedAgo(publishedAtUtc)}</span>
                </span>
            ) : (
                <span className="inline-flex items-center gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                    {/* PROPOSED (Marathi) */}
                    <span>अजून प्रकाशित नाही</span>
                </span>
            )}
        </div>
    );
};

export default LineageRibbon;

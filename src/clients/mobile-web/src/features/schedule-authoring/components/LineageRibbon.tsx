import React from 'react';

interface LineageRibbonProps {
    derivedFromTemplateId?: string | null;
    derivedFromName?: string | null;
    version?: number;
    author?: string | null;
    publishedAtUtc?: string | null;
}

const LineageRibbon: React.FC<LineageRibbonProps> = ({
    derivedFromTemplateId,
    derivedFromName,
    version,
    author,
    publishedAtUtc,
}) => {
    if (!derivedFromTemplateId && !publishedAtUtc) return null;

    const getRelativeDate = (utc: string) => {
        const diff = Date.now() - new Date(utc).getTime();
        const days = Math.floor(diff / 86400000);
        if (days === 0) return 'today';
        if (days === 1) return 'yesterday';
        return `${days} days ago`;
    };

    return (
        <div
            className="flex items-center gap-2 text-xs text-stone-500 mt-1"
            style={{ fontFamily: "'DM Sans', sans-serif" }}
        >
            {derivedFromTemplateId && derivedFromName && (
                <span className="rounded-full bg-stone-100 px-2 py-0.5">
                    Derived from <span className="font-medium">{derivedFromName}</span>
                    {version != null && ` \u2022 v${version}`}
                    {author && ` by ${author}`}
                </span>
            )}
            {publishedAtUtc && (
                <span className="inline-flex items-center gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    <span>Published {getRelativeDate(publishedAtUtc)}</span>
                </span>
            )}
            {!publishedAtUtc && (
                <span className="inline-flex items-center gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                    <span>Draft</span>
                </span>
            )}
        </div>
    );
};

export default LineageRibbon;

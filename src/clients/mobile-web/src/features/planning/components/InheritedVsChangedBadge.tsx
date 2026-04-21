import React from 'react';

interface InheritedVsChangedBadgeProps {
    sourceTemplateActivityId?: string | null;
    overrideReason?: string | null;
}

/**
 * Badge indicating the lineage state of a planned activity:
 *
 * sourceTemplateActivityId null  AND overrideReason null  → (nothing rendered)
 * sourceTemplateActivityId set   AND overrideReason null  → "Inherited" / "वंशज"       (stone)
 * sourceTemplateActivityId set   AND overrideReason set   → "Changed locally" / "स्थानिक बदल"  (amber)
 * sourceTemplateActivityId null  AND overrideReason set   → "Added locally" / "स्थानिक जोडलं" (emerald)
 */
const InheritedVsChangedBadge: React.FC<InheritedVsChangedBadgeProps> = ({
    sourceTemplateActivityId,
    overrideReason,
}) => {
    const hasSource = Boolean(sourceTemplateActivityId);
    const hasOverride = Boolean(overrideReason);

    if (!hasSource && !hasOverride) {
        return null;
    }

    if (hasSource && !hasOverride) {
        // Inherited
        return (
            <span
                className="inline-flex items-center gap-1 rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-500"
                style={{ fontFamily: "'DM Sans', sans-serif" }}
            >
                <span
                    style={{ fontFamily: "'Noto Sans Devanagari', sans-serif" }}
                    className="font-medium"
                >
                    वंशज
                </span>
                <span className="text-stone-400">Inherited</span>
            </span>
        );
    }

    if (hasSource && hasOverride) {
        // Changed locally
        return (
            <span
                className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700"
                style={{ fontFamily: "'DM Sans', sans-serif" }}
            >
                <span
                    style={{ fontFamily: "'Noto Sans Devanagari', sans-serif" }}
                    className="font-medium"
                >
                    स्थानिक बदल
                </span>
                <span className="text-amber-600">Changed locally</span>
            </span>
        );
    }

    // sourceTemplateActivityId null + overrideReason set → Added locally
    return (
        <span
            className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700"
            style={{ fontFamily: "'DM Sans', sans-serif" }}
        >
            <span
                style={{ fontFamily: "'Noto Sans Devanagari', sans-serif" }}
                className="font-medium"
            >
                स्थानिक जोडलं
            </span>
            <span className="text-emerald-600">Added locally</span>
        </span>
    );
};

export default InheritedVsChangedBadge;

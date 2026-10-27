import React from 'react';
import { HelpCircle, Mic, Edit3, X } from 'lucide-react';
import { UnclearSegment } from '../../../features/logs/logs.types';
import { UNCLEAR_MESSAGES } from '../../utils/marathiPrompts';
import { useOptionalLanguage } from '../../../i18n/LanguageContext';
import type { UnclearReason } from '../../../domain/types/log.types';

/**
 * PLR-D10 I13 (LP-27, round 3) — the card speaks ONE language. The hint under each unclear phrase exists in the
 * prompt file in English only (marathiPrompts UNCLEAR_MESSAGES.suggestion, left untouched: it sits beside the AI
 * prompt); a Marathi user gets the same hint in Marathi here instead of losing it.
 */
// PROPOSED (Marathi) — each hint written for this card, not yet reviewed.
const SUGGESTION_MR: Record<UnclearReason, string> = {
    ambiguous_verb: "झालेल्या कामासाठी 'आज केलं', पुढच्या कामासाठी 'उद्या करायचं' असं सांगा",
    unknown_vocabulary: 'खत, औषध, पाणी, कामगार असे नेहमीचे शब्द वापरा',
    incomplete_sentence: 'काय केलं, किती, कधी — हे सांगा',
    conflicting_markers: 'आधी काय झालं ते सांगा, मग काय करायचं ते',
    no_actionable_content: 'काय काम केलं, काय दिसलं, काय करायचं आहे — ते सांगा',
    audio_quality: 'फोन जवळ धरून बोला, आजूबाजूचा आवाज कमी करा',
    mixed_languages: 'एकाच भाषेत बोला — मराठी किंवा हिंदी',
    unknown: 'हळू आणि स्पष्ट बोला',
};
// The card's own words. Marathi as it always was; English for an English user (no doubled line either way).
const CARD = {
    mr: { title: 'समजलं नाही', again: 'पुन्हा बोला', write: 'लिहा', dismiss: 'नको, सोडून द्या' },
    en: { title: 'Not understood', again: 'Say again', write: 'Write', dismiss: 'No, leave it' },
} as const;

interface UnclearSegmentCardProps {
    segment: UnclearSegment;
    onRelog: (segmentId: string) => void;
    onManualEdit: (segmentId: string) => void;
    onDismiss: (segmentId: string) => void;
}

const UnclearSegmentCard: React.FC<UnclearSegmentCardProps> = ({
    segment,
    onRelog,
    onManualEdit,
    onDismiss
}) => {
    const language = useOptionalLanguage()?.language ?? 'mr';

    const message = UNCLEAR_MESSAGES[segment.reason] || UNCLEAR_MESSAGES.unknown;
    const words = CARD[language === 'en' ? 'en' : 'mr'];
    const suggestion = language === 'en' ? message.suggestion : (SUGGESTION_MR[segment.reason] ?? SUGGESTION_MR.unknown);
    // His language only: an English user reads the English line when the parse gave one, else the line as given.
    const said = language === 'en' && segment.userMessageEn ? segment.userMessageEn : segment.userMessage;

    return (
        <div className="unclear-segment-card bg-gradient-to-br from-red-50 to-red-100/50 
                        border border-red-200 rounded-2xl p-4 mb-3
                        border-l-4 border-l-red-400 shadow-sm">

            {/* Header */}
            <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center shadow-sm">
                    <HelpCircle className="text-red-500" size={18} />
                </div>
                <span className="text-sm font-semibold text-red-700">
                    {words.title}
                </span>
            </div>

            {/* The unclear text - highlighted */}
            <div className="bg-white rounded-xl p-3 mb-3 border border-red-100 shadow-inner">
                <p className="text-base text-slate-700 leading-relaxed font-medium">
                    <span className="bg-red-50 text-red-700 px-1.5 py-0.5 rounded">
                        "{segment.rawText}"
                    </span>
                </p>
            </div>

            {/* Empathetic message */}
            <div className="mb-3">
                {/* PLR-D10 I13 (LP-27) — one line, in his language: never Marathi and English stacked. */}
                <p className="text-sm text-red-700 font-medium mb-1" data-testid="unclear-said">
                    {said}
                </p>
            </div>

            {/* Suggestion hint, in his language. */}
            {suggestion && (
                <div className="bg-white/60 rounded-lg p-2.5 mb-4 border border-red-100/50">
                    <p className="text-xs text-red-500 flex items-start gap-1.5 font-medium">
                        <span>💡</span>
                        <span data-testid="unclear-suggestion">{suggestion}</span>
                    </p>
                </div>
            )}

            {/* Action buttons */}
            <div className="flex gap-2">

                {/* Primary: Re-log with voice */}
                <button
                    onClick={() => onRelog(segment.id)}
                    className="flex-1 flex items-center justify-center gap-2 
                               bg-red-500 text-white py-2.5 px-4 rounded-xl
                               font-medium text-sm 
                               hover:bg-red-600 active:bg-red-700
                               transition-colors shadow-sm"
                >
                    <Mic size={16} />
                    <span>{words.again}</span>
                </button>

                {/* Secondary: Manual entry */}
                <button
                    onClick={() => onManualEdit(segment.id)}
                    className="flex items-center justify-center gap-2
                               bg-white text-red-600 py-2.5 px-4 rounded-xl
                               font-medium text-sm border border-red-200
                               hover:bg-red-50 active:bg-red-100
                               transition-colors shadow-sm"
                >
                    <Edit3 size={16} />
                    <span>{words.write}</span>
                </button>

                {/* Tertiary: Dismiss */}
                <button
                    onClick={() => onDismiss(segment.id)}
                    className="flex items-center justify-center
                               text-red-300 p-2.5 rounded-xl
                               hover:bg-red-50 hover:text-red-400
                               transition-colors"
                    title={words.dismiss}
                >
                    <X size={18} />
                </button>
            </div>
        </div>
    );
};

export default UnclearSegmentCard;

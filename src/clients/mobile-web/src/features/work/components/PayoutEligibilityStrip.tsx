/**
 * PayoutEligibilityStrip — shows whether a job card is eligible for payout.
 * Reads card.status, card.linkedDailyLogId and (lane L4b fix round 1) the linked record's state.
 *
 * CEI Phase 4 §4.8. Lane L4b fix round 1 (H-1 / CTO D-89, founder D-33, M-2): after D-33 a मंजूर confirms the WORK
 * and leaves the card Completed, so a Completed card whose record is approved says so ("काम मंजूर · पेआउट तपासा
 * बाकी"); "नोंद तपासणीची प्रतीक्षा" stays only while the record is not approved; a card a शंका or a correction took
 * back from "ready to pay" says that. One language at a time (Marathi mode = Marathi only). New lines are PROPOSED.
 */

import React from 'react';
import type { JobCard } from '../../../domain/work/JobCard';
import { useOptionalLanguage } from '../../../i18n/LanguageContext';

interface PayoutEligibilityStripProps {
    card: Pick<JobCard, 'status' | 'linkedDailyLogId' | 'linkedDailyLogStatus' | 'payoutCheckWithdrawn'>;
    /** The screen's language; defaults to the app's. */
    language?: 'mr' | 'en';
}

interface StripConfig {
    colorClass: string;
    iconPath: string;
    labelEn: string;
    labelMr: string;
}

const getStripConfig = (card: PayoutEligibilityStripProps['card']): StripConfig => {
    if (card.status === 'PaidOut') {
        return {
            colorClass: 'bg-emerald-50 text-emerald-700',
            iconPath: 'M5 13l4 4L19 7',
            labelEn: 'Paid out',
            labelMr: 'पैसे दिले',
        };
    }
    if (card.status === 'VerifiedForPayout') {
        return {
            colorClass: 'bg-emerald-50 text-emerald-700',
            iconPath: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z',
            labelEn: 'Eligible for payout',
            labelMr: 'पेआउटसाठी पात्र',
        };
    }
    if (card.status === 'Completed') {
        if (card.linkedDailyLogId && card.linkedDailyLogStatus === 'Verified') {
            return {
                colorClass: 'bg-emerald-50 text-emerald-800',
                iconPath: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z',
                labelEn: 'Work approved · payout check pending',
                labelMr: 'काम मंजूर · पेआउट तपासा बाकी',
            };
        }
        if (card.linkedDailyLogId && card.payoutCheckWithdrawn) {
            return {
                colorClass: 'bg-rose-50 text-rose-700',
                iconPath: 'M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
                labelEn: 'Record questioned or corrected — payout check withdrawn',
                labelMr: 'नोंदीवर शंका / दुरुस्ती — पेआउटची खात्री परत घेतली',
            };
        }
        if (card.linkedDailyLogId) {
            return {
                colorClass: 'bg-amber-50 text-amber-700',
                iconPath: 'M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
                labelEn: 'Awaiting log verification',
                labelMr: 'नोंद तपासणीची प्रतीक्षा',
            };
        }
        return {
            colorClass: 'bg-amber-50 text-amber-700',
            iconPath: 'M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
            labelEn: 'Daily log not linked',
            labelMr: 'दैनंदिन नोंद जोडलेली नाही',
        };
    }
    if (card.status === 'InProgress') {
        return {
            colorClass: 'bg-amber-50 text-amber-700',
            iconPath: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z',
            labelEn: 'Work in progress',
            labelMr: 'काम सुरू आहे',
        };
    }
    if (card.status === 'Cancelled') {
        return {
            colorClass: 'bg-rose-50 text-rose-700',
            iconPath: 'M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z',
            labelEn: 'Cancelled',
            labelMr: 'रद्द केले',
        };
    }
    // Draft or Assigned
    return {
        colorClass: 'bg-stone-50 text-stone-500',
        iconPath: 'M8 12h.01M12 12h.01M16 12h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
        labelEn: card.status === 'Draft' ? 'Draft' : 'Assigned — not started',
        labelMr: card.status === 'Draft' ? 'मसुदा' : 'नेमणूक झाली — सुरू नाही',
    };
};

const PayoutEligibilityStrip: React.FC<PayoutEligibilityStripProps> = ({ card, language }) => {
    const appLanguage = useOptionalLanguage()?.language;
    const isEnglish = (language ?? appLanguage) === 'en';
    const config = getStripConfig(card);

    return (
        <div
            data-testid="payout-strip"
            className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold ${config.colorClass}`}
        >
            <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="shrink-0"
                style={{ fontFamily: "'DM Sans', sans-serif" }}
            >
                <path d={config.iconPath} />
            </svg>
            {isEnglish ? (
                <span style={{ fontFamily: "'DM Sans', sans-serif" }}>{config.labelEn}</span>
            ) : (
                <span style={{ fontFamily: "'Noto Sans Devanagari', sans-serif" }}>{config.labelMr}</span>
            )}
        </div>
    );
};

export default PayoutEligibilityStrip;

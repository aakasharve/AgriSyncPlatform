/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane UI-8; founder D-148 "layout C", D-150) - the owner bar of the शेड्यूल tab: a slim WHITE card
 * (it was a black card), its top edge green, with the schedule maker's picture at the left (92 px; 72 px under 360 px width), the small label
 * "शेड्यूल बनवणारे", the maker's name, and the schedule's name.
 *
 * The picture place takes an optional picture: a person's photo is round, a schedule's picture or an institution's logo is square; with none it shows
 * the letter of the real name, or a leaf (the same badge the page had). Lane SCH-ID-P feeds it: the picture the phone holds for this schedule (the
 * server named it in the pull) fills the place; a caller's `imageUrl` wins over it; the page never invents one.
 * The name is the creator's REAL name as the app holds it. When the app holds no name, the line says who made it with the app's own words
 * (`OWNER_LABEL`: "ॲपमधलं मूळ शेड्यूल", "शेतकऱ्याने स्वतः बनवलेलं", ...) - never an invented institution.
 * Everything the old dark card said about the schedule stays under the name: the lineage, ShramSafal's check, and the note on a schedule the check
 * does not stand behind.
 */
import React from 'react';
import LineageRibbon from '../../schedule-authoring/components/LineageRibbon';
import type { CropScheduleTemplate } from '../scheduler.types';
import { ScheduleCheckBadge } from '../components/ScheduleCheckBadge';
import { OWNER_LABEL } from './scheduleCopy';
import { scheduleNameMr } from './scheduleNames';
import { realCreatorName } from './ScheduleCreatorBadge';
import { ScheduleMakerBadge } from '../pictures/ScheduleMakerBadge';
import { scheduleMapWords } from './scheduleMapCopy';
import { useOptionalLanguage } from '../../../i18n/LanguageContext';

export const ScheduleOwnerBar: React.FC<{
    template: CropScheduleTemplate;
    /** The maker's picture when the caller has one; otherwise the picture this phone holds for the schedule (if any). */
    imageUrl?: string | null;
    /** What sits under the name after the check badge (the "not checked" / "withdrawn" note and its door). */
    children?: React.ReactNode;
}> = ({ template, imageUrl = null, children }) => {
    const language = useOptionalLanguage()?.language === 'en' ? 'en' : 'mr';
    const words = scheduleMapWords(language);
    const creator = realCreatorName(template);
    const typeLabel = OWNER_LABEL[template.ownerType] ?? OWNER_LABEL.SYSTEM_DEFAULT;
    const extra = template as unknown as Record<string, unknown>;
    return (
        <section className="rounded-2xl border border-stone-200 border-t-[5px] border-t-emerald-600 bg-white p-2.5 shadow-[0_3px_12px_rgba(28,25,23,0.07)]" data-testid="sched-owner-bar">
            <div className="flex items-center gap-2.5">
                <ScheduleMakerBadge template={template} imageUrl={imageUrl} size={80} tone="light"
                    sizeClass="h-[72px] w-[72px] text-[32px] min-[360px]:h-[92px] min-[360px]:w-[92px] min-[360px]:text-[42px]" />
                <div className="min-w-0 flex-1" data-testid="sched-owner" data-owner={template.ownerType}>
                    <p className="m-0 text-[13px] font-extrabold leading-tight text-emerald-700">{words.ownerLabel}</p>
                    <p className="m-0 mt-0.5 break-words text-[18px] font-black leading-snug text-stone-900" data-testid="sched-owner-name">{creator ?? typeLabel}</p>
                    {/* A real name is followed by what KIND of maker it is (the old card's "कोणी बनवलं: संस्था · नाव"). */}
                    {creator && <p className="m-0 text-[13px] font-bold leading-snug text-stone-600" data-testid="sched-owner-type">{typeLabel}</p>}
                    <p className="m-0 mt-0.5 break-words text-[15px] font-bold leading-snug text-stone-700" data-testid="sched-name">{scheduleNameMr(template.name)}</p>
                </div>
            </div>
            <LineageRibbon
                tone="light"
                derivedFromTemplateId={extra['derivedFromTemplateId'] as string | null | undefined}
                derivedFromName={extra['derivedFromName'] as string | null | undefined}
                version={extra['version'] as number | undefined}
                author={creator}
                publishedAtUtc={(extra['publishedAtUtc'] as string | null | undefined) ?? template.publishedAt}
            />
            {/* spec: plr-d10 lane SCH-A - ShramSafal's check, from the server's record only */}
            <ScheduleCheckBadge template={template} tone="light" testId="sched-check" />
            {children}
        </section>
    );
};

export default ScheduleOwnerBar;

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane DFES-Q, task 5) - the line on Sathi's card that names each piece of
 * work he logged. Renders NOTHING until the founder has ticked the pattern wording (his rule: every Sathi sentence is wording he
 * approved). Marathi mode shows the Marathi line only.
 */
import React from 'react';
import { useOptionalLanguage } from '../../../i18n/LanguageContext';
import { appreciationText, type AppreciationRecord } from '../../../domain/dfes/appreciation';

export const SathiAppreciation: React.FC<{ record: AppreciationRecord }> = ({ record }) => {
    const language = useOptionalLanguage()?.language === 'en' ? 'en' : 'mr';
    const line = appreciationText(record, language);
    if (!line || !line.approved) return null;
    return (
        <p className="mb-2 text-[16px] font-semibold leading-snug text-stone-800" data-testid="sathi-appreciation" lang={language}>
            {line.text}
        </p>
    );
};

export default SathiAppreciation;

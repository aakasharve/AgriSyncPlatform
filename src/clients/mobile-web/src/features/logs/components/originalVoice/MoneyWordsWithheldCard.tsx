/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * lane MU-3 fix 1 (F3, founder D-66 = option 1; item 16 W1) — what a record card shows IN PLACE of the words and voice
 * of a record that mentions money, for a person who does not see the farm's money and did not make it. Never an empty
 * transcript that looks like "nothing was said": the founder's rule line, read as ShramSafal's rule, and the work
 * details stay below it.
 */
import React from 'react';
import { useOptionalLanguage } from '../../../../i18n/LanguageContext';
import { ruleWithheldCopy } from '../../../../i18n/ruleWithheldTranslations';

export const MoneyWordsWithheldCard: React.FC<{ testId?: string }> = ({ testId = 'money-words-withheld' }) => {
    const language = useOptionalLanguage()?.language;
    return (
        <p className="m-0 my-1 basis-full rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-[14px] font-bold leading-snug text-stone-700"
            data-testid={testId}>
            {ruleWithheldCopy(language).recordWords}
        </p>
    );
};

export default MoneyWordsWithheldCard;

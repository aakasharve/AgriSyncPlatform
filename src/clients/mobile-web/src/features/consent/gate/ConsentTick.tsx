// spec: plr-d10-x1-consent-tick-on-phone-screen-2026-10-25
//
// One tick, on the screen where the phone number is typed. Founder decision 2026-10-25:
// "put the link and only tick mark while logging in."
//
// Rules this row is built to:
//   • NEVER PRE-TICKED. The tick is the one affirmative act; a box that arrives ticked is
//     not consent.
//   • THE WHOLE ROW IS THE TARGET. The row is the checkbox's label, so a tap anywhere on
//     it ticks — a 24 px box alone is too small a target for a thumb in the field. The
//     green words are the one exception: they open the notice and do not tick.
//   • THE LINK OPENS THE NOTICE IN PLACE. An overlay, not a navigation — the typed number
//     survives reading it.
//   • NOTHING IS SAID TWICE. The sentence he ticks is `tick.lead + tick.link + tick.tail`
//     from the hashed notice; the hint under it is `ctaDisabledHint`, also hashed. This row
//     adds no words of its own.
//   • HELD WHILE SAVING. While the acceptance is being written the box cannot be unticked:
//     a box that reads "not agreed" while an agreement lands would be a false screen.
//   • GONE ONCE GIVEN — for this visit only (`passed`); the next login asks again.

import React from 'react';
import ConsentNoticeSheet from './ConsentNoticeSheet';
import { CONSENT_NOTICE } from './consentNotice';
import type { ConsentBeforeOtp } from './useConsentBeforeOtp';

interface Props {
    consent: ConsentBeforeOtp;
    disabled?: boolean;
}

const ConsentTick: React.FC<Props> = ({ consent, disabled = false }) => {
    if (consent.status !== 'required') return null;
    const n = CONSENT_NOTICE[consent.language];
    const held = disabled || consent.recording;

    return (
        <div className="space-y-1.5">
            <label
                htmlFor="consent-tick"
                className={`flex min-h-[56px] items-start gap-3 rounded-xl bg-emerald-50/70 px-3 py-3 ring-1 ring-emerald-200 ${
                    held ? 'cursor-default opacity-80' : 'cursor-pointer'
                }`}
            >
                <input
                    id="consent-tick"
                    type="checkbox"
                    data-testid="consent-tick"
                    checked={consent.ticked}
                    disabled={held}
                    // The accessible name is the WHOLE sentence he is agreeing to.
                    aria-labelledby="consent-tick-sentence"
                    onChange={(e) => consent.setTicked(e.target.checked)}
                    className="mt-0.5 h-7 w-7 shrink-0 cursor-pointer rounded border-stone-400 accent-emerald-700"
                />
                <span id="consent-tick-sentence" className="text-[14px] font-semibold leading-snug text-stone-800">
                    {n.tick.lead}
                    <button
                        type="button"
                        data-testid="consent-open-notice"
                        onClick={(e) => {
                            // Inside the label: reading the notice must not tick the box.
                            e.preventDefault();
                            e.stopPropagation();
                            consent.setNoticeOpen(true);
                        }}
                        // min-h-0/min-w-0: the global 44 px touch rule on <button> would
                        // otherwise make this inline link a 44 px box and split the sentence.
                        className="min-h-0 min-w-0 p-0 align-baseline font-bold leading-snug text-emerald-800 underline decoration-emerald-400 underline-offset-2"
                    >
                        {n.tick.link}
                    </button>
                    {n.tick.tail}
                </span>
            </label>
            {!consent.ticked && (
                <p data-testid="consent-tick-hint" className="px-1 text-[12.5px] font-medium leading-snug text-stone-500">
                    {n.ctaDisabledHint}
                </p>
            )}
            <ConsentNoticeSheet open={consent.noticeOpen} onClose={() => consent.setNoticeOpen(false)} />
        </div>
    );
};

export default ConsentTick;

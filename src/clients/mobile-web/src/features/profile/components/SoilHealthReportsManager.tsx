/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * "माती व पाणी अहवाल".
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I7 / WP-5), doctrine P5 ("a truthful missing
 * feature beats a fake working one"). This page used to have an "Upload Report" button that uploaded
 * nothing: it waited 1.5 s and added a made-up "Soil Test - May 25" row to screen state only (gone on
 * the next visit), its delete button did nothing, and it promised "precise fertilizer recipes". There
 * is no report upload anywhere in the app, so the page now says that plainly and offers no button.
 */
import React from 'react';
import { FlaskConical } from 'lucide-react';
import { GlassCard, IconDot, Soon } from './hubUi';

export const SoilHealthReportsManager: React.FC = () => (
    <div className="space-y-3" data-testid="soil-reports">
        <GlassCard>
            <div className="flex items-start gap-3">
                <IconDot tone="violet"><FlaskConical size={22} aria-hidden="true" /></IconDot>
                <div className="min-w-0">
                    <p className="m-0 text-[16px] font-extrabold text-stone-900">माती आणि पाणी तपासणीचे अहवाल</p>
                    <p className="m-0 mt-0.5 text-[14px] font-semibold leading-snug text-stone-600">
                        अहवाल या अ‍ॅपमध्ये जोडण्याची सोय अजून तयार झालेली नाही. तोपर्यंत अहवाल तुमच्याकडेच जपून ठेवा.
                    </p>
                </div>
            </div>
        </GlassCard>
        <Soon what="अहवालाचा फोटो किंवा आकडे जोडणं" />
    </div>
);

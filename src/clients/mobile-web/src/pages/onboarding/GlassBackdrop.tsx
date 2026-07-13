/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * GlassBackdrop — a soft, premium backdrop for the onboarding screens: a light
 * base with a few large blurred colour blobs (emerald / warm / teal) forming a
 * gentle aurora, a faint horizon glow, and a fine grain overlay. Designed to
 * sit UNDER frosted-glass surfaces so the blur picks up subtle colour, without
 * competing with the farmer artwork. Replaces the literal cartoon farm scene.
 */
import React from 'react';

const GRAIN =
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

interface GlassBackdropProps {
    faded?: boolean;
}

const GlassBackdrop: React.FC<GlassBackdropProps> = ({ faded = false }) => (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        {/* Sky gradient fallback / base */}
        <div className="absolute inset-0 bg-gradient-to-b from-[#FFF9EC] via-[#FFF2D4] to-[#EDF0D5]" />
        
        {/* Farmland vector landscape background */}
        <img 
            src="/brand/welcome-bg.svg" 
            alt="" 
            className="absolute inset-0 h-full w-full object-cover object-bottom transition-opacity duration-700"
            style={{ opacity: faded ? 0.35 : 1 }}
        />

        {/* Soft blur overlay if faded (permissions screen) */}
        {faded && (
            <div className="absolute inset-0 bg-white/40 backdrop-blur-[1px]" />
        )}

        {/* Faint horizon glow (blends bottom safebars) */}
        <div className="absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-[#EDF0D5]/80 via-[#EDF0D5]/30 to-transparent" />

        {/* Fine grain overlay for premium texture */}
        <div className="absolute inset-0 opacity-[0.035] mix-blend-soft-light" style={{ backgroundImage: GRAIN, backgroundRepeat: 'repeat' }} />
    </div>
);

export default GlassBackdrop;


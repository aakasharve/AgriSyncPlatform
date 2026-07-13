/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * FarmerIllustration — a clean, on-brand SVG rendition of the Shram Safal
 * farmer (turban with a leaf, moustache, green kurta, shield badge). Used as
 * the character on the onboarding screens until the exact PNG art is dropped
 * into /brand/farmer-*.png; then those images take over automatically.
 */
import React from 'react';

const FarmerIllustration: React.FC<{ className?: string }> = ({ className }) => (
    <svg viewBox="0 0 200 240" className={className} aria-hidden="true" role="img">
        <defs>
            <linearGradient id="fi-kurta" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#2f8f4e" />
                <stop offset="1" stopColor="#1f6b39" />
            </linearGradient>
            <linearGradient id="fi-turban" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#fbf7ec" />
                <stop offset="1" stopColor="#eaddc2" />
            </linearGradient>
            <radialGradient id="fi-skin" cx="0.5" cy="0.4" r="0.7">
                <stop offset="0" stopColor="#f2b784" />
                <stop offset="1" stopColor="#e0a06a" />
            </radialGradient>
        </defs>

        {/* shoulders / kurta */}
        <path d="M28 240 C 30 188 58 168 100 168 C 142 168 170 188 172 240 Z" fill="url(#fi-kurta)" />
        {/* collar */}
        <path d="M84 176 L100 196 L116 176 C 110 170 90 170 84 176 Z" fill="#f2b784" />
        <path d="M84 176 L100 190 L100 240 L86 240 C 82 214 82 194 84 176 Z" fill="#256a37" />
        <path d="M116 176 L100 190 L100 240 L114 240 C 118 214 118 194 116 176 Z" fill="#2b7a41" />
        {/* placket + buttons */}
        <rect x="97" y="192" width="6" height="46" rx="3" fill="#215f32" />
        <circle cx="100" cy="204" r="2.4" fill="#173f22" />
        <circle cx="100" cy="220" r="2.4" fill="#173f22" />
        {/* shield badge on chest */}
        <g transform="translate(126 196)">
            <path d="M0 2 C 8 -1 14 -1 22 2 C 22 14 16 22 11 25 C 6 22 0 14 0 2 Z" fill="#ffffff" />
            <path d="M3 5 C 9 3 13 3 19 5 C 19 13 15 19 11 21 C 7 19 3 13 3 5 Z" fill="#e9f7ee" />
            <circle cx="8.5" cy="10" r="2.2" fill="#2f8f4e" />
            <path d="M12 8 l3 3 l4 -5" stroke="#2563eb" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </g>

        {/* neck */}
        <rect x="88" y="150" width="24" height="26" rx="10" fill="#e0a06a" />

        {/* ears */}
        <ellipse cx="58" cy="104" rx="8" ry="11" fill="url(#fi-skin)" />
        <ellipse cx="142" cy="104" rx="8" ry="11" fill="url(#fi-skin)" />

        {/* hair sides */}
        <path d="M60 70 C 48 84 50 120 60 132 C 54 112 56 84 66 74 Z" fill="#241812" />
        <path d="M140 70 C 152 84 150 120 140 132 C 146 112 144 84 134 74 Z" fill="#241812" />

        {/* face */}
        <ellipse cx="100" cy="100" rx="43" ry="47" fill="url(#fi-skin)" />

        {/* eyebrows */}
        <path d="M74 90 q10 -8 20 -1" stroke="#241812" strokeWidth="4.5" fill="none" strokeLinecap="round" />
        <path d="M106 89 q10 -7 20 1" stroke="#241812" strokeWidth="4.5" fill="none" strokeLinecap="round" />
        {/* eyes */}
        <ellipse cx="84" cy="101" rx="6.5" ry="7.5" fill="#fff" />
        <ellipse cx="116" cy="101" rx="6.5" ry="7.5" fill="#fff" />
        <circle cx="85" cy="102" r="3.4" fill="#2a1a10" />
        <circle cx="117" cy="102" r="3.4" fill="#2a1a10" />
        <circle cx="86.3" cy="100.6" r="1" fill="#fff" />
        <circle cx="118.3" cy="100.6" r="1" fill="#fff" />
        {/* nose */}
        <path d="M100 104 q4 8 -1 13 q-4 -1 -6 -3" stroke="#c98850" strokeWidth="2.6" fill="none" strokeLinecap="round" />
        {/* moustache */}
        <path d="M100 126 C 90 116 78 120 74 128 C 82 126 92 126 100 132 C 108 126 118 126 126 128 C 122 120 110 116 100 126 Z" fill="#241812" />
        {/* smile */}
        <path d="M90 134 q10 8 20 0" stroke="#a15a34" strokeWidth="2.6" fill="none" strokeLinecap="round" />

        {/* turban */}
        <path d="M56 78 C 54 40 84 22 100 22 C 116 22 146 40 144 78 C 128 66 112 62 100 62 C 88 62 72 66 56 78 Z" fill="url(#fi-turban)" />
        {/* turban fold lines */}
        <path d="M64 70 C 82 58 118 58 136 70" stroke="#dccaa6" strokeWidth="2.5" fill="none" strokeLinecap="round" />
        <path d="M70 56 C 84 46 116 46 130 56" stroke="#dccaa6" strokeWidth="2.5" fill="none" strokeLinecap="round" />
        {/* front band */}
        <path d="M56 78 C 72 70 128 70 144 78 C 142 86 138 90 132 90 C 116 82 84 82 68 90 C 62 90 58 86 56 78 Z" fill="#e7d8b6" />
        {/* leaf accent */}
        <g transform="translate(120 34) rotate(24)">
            <path d="M0 0 C 10 -6 20 -3 24 6 C 14 9 4 8 0 0 Z" fill="#3fae54" />
            <path d="M2 2 C 9 0 16 1 21 5" stroke="#2b7d3b" strokeWidth="1.4" fill="none" />
        </g>
    </svg>
);

export default FarmerIllustration;

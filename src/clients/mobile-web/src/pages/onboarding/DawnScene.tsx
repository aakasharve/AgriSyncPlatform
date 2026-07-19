/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DawnScene — the backdrop for the first-run Welcome screen, aligned to the
 * LOGIN screen's theme so the login → welcome transition feels like one product:
 *   1. a light, airy white / pale-mint base (matches the login gradient)
 *   2. a soft cool glow behind the farmer (subtle depth, not a warm sun)
 *   3. a green farm-field band at the bottom — the same layered-hills motif as
 *      the login screen's FarmFooter — so the character stands in the field and
 *      green stays concentrated at the base instead of flooding the screen.
 *
 * The farmer's lower body is dissolved into this base by WelcomeScreen (mask +
 * white ground-scrim) so the day's-log text reads cleanly over it.
 */
import React from 'react';

interface DawnSceneProps {
    /** Drives the one-time entrance (the cool glow eases in). */
    lit?: boolean;
}

const DawnScene: React.FC<DawnSceneProps> = ({ lit = true }) => (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        {/* 1 — light base, matches the login screen */}
        <div
            className="absolute inset-0"
            style={{ background: 'linear-gradient(180deg,#ECFDF5 0%,#FBFEFC 40%,#FFFFFF 58%,#EFFAF3 100%)' }}
        />

        {/* 2 — soft cool glow behind the farmer's head/shoulders */}
        <div
            className="absolute left-1/2 top-[30%] h-[380px] w-[380px] transition-all duration-[1100ms] ease-out"
            style={{
                background:
                    'radial-gradient(circle,rgba(209,250,229,0.9) 0%,rgba(209,250,229,0.4) 40%,rgba(236,253,245,0.2) 58%,transparent 72%)',
                opacity: lit ? 1 : 0,
                transform: `translate(-50%,-50%) scale(${lit ? 1 : 0.9})`,
            }}
        />

        {/* 3 — green farm-field band at the bottom (echoes the login FarmFooter) */}
        <svg
            viewBox="0 0 1440 300"
            preserveAspectRatio="xMidYMax slice"
            className="absolute inset-x-0 bottom-0 h-[36%] w-full"
        >
            <defs>
                <linearGradient id="ds-field" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor="#34d399" />
                    <stop offset="1" stopColor="#059669" />
                </linearGradient>
            </defs>
            <path d="M0,150 C260,96 520,178 760,140 C1000,104 1240,176 1440,124 L1440,300 L0,300 Z" fill="#d1fae5" />
            <path d="M0,196 C300,150 620,222 920,186 C1140,160 1320,206 1440,186 L1440,300 L0,300 Z" fill="#a7f3d0" />
            <path d="M0,236 C360,204 720,250 1080,228 C1260,216 1380,240 1440,230 L1440,300 L0,300 Z" fill="#6ee7b7" />
            <path d="M0,266 C360,248 720,278 1080,262 C1260,254 1380,272 1440,264 L1440,300 L0,300 Z" fill="url(#ds-field)" />
            <g stroke="#065f46" strokeOpacity="0.15" strokeWidth="2" fill="none">
                <path d="M120,280 C480,268 960,284 1320,274" />
                <path d="M60,291 C480,279 960,295 1380,285" />
            </g>
        </svg>
    </div>
);

export default DawnScene;

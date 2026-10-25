/** @type {import('tailwindcss').Config} */
export default {
    darkMode: 'class',
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            fontFamily: {
                sans: ['"DM Sans"', '"Noto Sans Devanagari"', 'sans-serif'],
                display: ['"DM Sans"', '"Noto Sans Devanagari"', 'sans-serif'],
                serif: ['"Noto Serif Devanagari"', 'serif'],
            },
            spacing: {
                'safe-top': 'var(--safe-area-inset-top, env(safe-area-inset-top, 0px))',
                'safe-bottom': 'var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px))',
                'safe-left': 'var(--safe-area-inset-left, env(safe-area-inset-left, 0px))',
                'safe-right': 'var(--safe-area-inset-right, env(safe-area-inset-right, 0px))',
            },
            minHeight: {
                'screen-safe': 'calc(100dvh - var(--safe-area-inset-top, env(safe-area-inset-top, 0px)) - var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px)))',
            },
            height: {
                'screen-safe': 'calc(100dvh - var(--safe-area-inset-top, env(safe-area-inset-top, 0px)) - var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px)))',
            },
            colors: {
                // "Agri-Tech Green" - Vibrant, Premium, Trustworthy
                emerald: {
                    50: '#ECFDF5',
                    100: '#D1FAE5',
                    200: '#A7F3D0',
                    300: '#6EE7B7',
                    400: '#34D399',
                    500: '#10B981', // Standard Tailwind
                    600: '#059669', // Deepening for contrast
                    700: '#047857',
                    800: '#065F46',
                    900: '#064E3B',
                    950: '#022C22',
                },
                // "Soil & Stone" - Warm Neutrals
                stone: {
                    50: '#FAFAF9',
                    100: '#F5F5F4',
                    200: '#E7E5E4',
                    300: '#D6D3D1',
                    400: '#A8A29E',
                    500: '#78716C',
                    600: '#57534E',
                    700: '#44403C',
                    800: '#292524',
                    900: '#1C1917',
                    950: '#0C0A09',
                },
                // Semantic Surfaces
                surface: {
                    DEFAULT: '#FFFFFF',
                    100: '#FAFAF9',
                    200: '#F5F5F4',
                    300: '#E7E5E4',
                }
            },
            boxShadow: {
                'soft': '0 2px 10px rgba(0, 0, 0, 0.03)',
                'medium': '0 4px 20px rgba(0, 0, 0, 0.06)',
                'hard': '0 8px 30px rgba(0, 0, 0, 0.08)',
                'glow-emerald': '0 0 20px rgba(16, 185, 129, 0.3)',
            },
            // PLR-D5: live, calm motion for the log entry screens. Prefixed so nothing else is touched;
            // every use is behind `motion-safe:` so it stops for people who ask their phone for less motion.
            keyframes: {
                plrRise: { from: { opacity: '0', transform: 'translateY(16px) scale(0.97)' }, to: { opacity: '1', transform: 'none' } },
                plrBob: { '0%, 100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(6px)' } },
                plrNudge: { '0%, 100%': { transform: 'translateX(0)' }, '50%': { transform: 'translateX(5px)' } },
                plrKen: { from: { transform: 'scale(1)' }, to: { transform: 'scale(1.12)' } },
                plrSheen: { '0%': { transform: 'translateX(-130%) skewX(-18deg)' }, '55%, 100%': { transform: 'translateX(520%) skewX(-18deg)' } },
                plrPop: { '0%': { transform: 'scale(0.6)', opacity: '0' }, '60%': { transform: 'scale(1.12)', opacity: '1' }, '100%': { transform: 'scale(1)' } },
                plrTap: { '0%, 100%': { transform: 'translateY(0) scale(1)' }, '50%': { transform: 'translateY(3px) scale(0.94)' } },
                // Setup Hub icon (header): tap press and spreading rings. Not behind motion-safe: short, started by the user's own tap.
                hubPress: { '0%': { transform: 'scale(1)' }, '20%': { transform: 'scale(0.82)' }, '60%': { transform: 'scale(1.12)' }, '100%': { transform: 'scale(1)' } },
                hubRipple: { '0%': { transform: 'scale(0.9)', opacity: '0.85' }, '100%': { transform: 'scale(2.1)', opacity: '0' } },
                // Page switcher / bottom bar: a ripple that grows from the finger and fades.
                navRipple: { '0%': { transform: 'scale(0)', opacity: '1' }, '100%': { transform: 'scale(1)', opacity: '0' } },
                plrGlow: { '0%, 100%': { opacity: '0.35' }, '50%': { opacity: '0.9' } },
                plrOrbit: { to: { transform: 'rotate(360deg)' } },
                plrGlint: { '0%, 100%': { opacity: '0.35', transform: 'translate(0, 0) scale(0.85)' }, '45%': { opacity: '1', transform: 'translate(8px, -10px) scale(1.15)' } },
                plrShrink: { from: { transform: 'scaleX(1)' }, to: { transform: 'scaleX(0)' } },
                plrFlow: { to: { strokeDashoffset: '-72' } },
                plrEq: { '0%, 100%': { transform: 'scaleY(0.30)' }, '50%': { transform: 'scaleY(1)' } },
            },
            animation: {
                'plr-rise': 'plrRise 0.6s cubic-bezier(0.2, 0.8, 0.2, 1) backwards',
                'plr-bob': 'plrBob 1.8s ease-in-out infinite',
                'plr-nudge': 'plrNudge 1.2s ease-in-out infinite',
                'plr-ken': 'plrKen 16s ease-in-out infinite alternate',
                'plr-sheen': 'plrSheen 5s ease-in-out infinite',
                'plr-pop': 'plrPop 0.55s cubic-bezier(0.2, 0.9, 0.3, 1.2) both',
                'plr-tap': 'plrTap 1.8s ease-in-out infinite',
                'plr-glow': 'plrGlow 2.4s ease-in-out infinite',
                'hub-press': 'hubPress 0.55s cubic-bezier(0.2, 0.9, 0.3, 1.2) both',
                'hub-ripple': 'hubRipple 0.8s ease-out both',
                'nav-ripple': 'navRipple 0.6s ease-out forwards',
                'plr-orbit': 'plrOrbit 16s linear infinite',
                'plr-glint': 'plrGlint 4s ease-in-out infinite',
                'plr-shrink': 'plrShrink 1.1s linear forwards',
                'plr-flow': 'plrFlow 1.8s linear infinite',
                'plr-flow-fast': 'plrFlow 1s linear infinite',
                'plr-eq': 'plrEq 1s ease-in-out infinite',
                'plr-orbit-rev': 'plrOrbit 26s linear infinite reverse',
            },
            backgroundImage: {
                'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
                'subtle-mesh': 'radial-gradient(at 0% 0%, hsla(140,100%,93%,1) 0, transparent 50%), radial-gradient(at 50% 0%, hsla(125,100%,96%,1) 0, transparent 50%), radial-gradient(at 100% 0%, hsla(168,100%,94%,1) 0, transparent 50%)',
            }
        },
    },
    plugins: [],
}

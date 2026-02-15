/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            fontFamily: {
                sans: ['"Inter"', 'system-ui', 'sans-serif'],
                display: ['"Outfit"', 'system-ui', 'sans-serif'],
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
            backgroundImage: {
                'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
                'subtle-mesh': 'radial-gradient(at 0% 0%, hsla(140,100%,93%,1) 0, transparent 50%), radial-gradient(at 50% 0%, hsla(125,100%,96%,1) 0, transparent 50%), radial-gradient(at 100% 0%, hsla(168,100%,94%,1) 0, transparent 50%)',
            }
        },
    },
    plugins: [],
}

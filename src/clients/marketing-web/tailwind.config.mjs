/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        serif: ['var(--font-serif)'],
        sans: ['var(--font-sans)'],
      },
      colors: {
        brand: { DEFAULT: '#059669', hover: '#047857', fresh: '#10B981', blue: '#1565C0', 'blue-light': '#1E88E5' },
        surface: { DEFAULT: '#FFFFFF', main: '#FEFCF8', green: '#ECFDF5', cream: '#FFFBEB', parchment: '#FEF7EC', dark: '#0d1a0f' },
        ink: { DEFAULT: '#1C1917', secondary: '#57534E', muted: '#A8A29E' },
        border: { soft: '#D6D3D1' },
        accent: { soil: '#78350F', water: '#0EA5E9', harvest: '#F59E0B' },
        danger: { DEFAULT: '#DC2626', light: '#FEE2E2', border: '#FECACA' },
        farm: {
          soil: '#78350F',
          'soil-warm': '#92400E',
          harvest: '#D97706',
          golden: '#F59E0B',
          sky: '#0EA5E9',
          leaf: '#4ADE80',
          terracotta: '#C2410C',
          'green-deep': '#166534',
        },
        soil: '#5A3E2B',
        haldi: '#D89B1D',
        sand: '#F7F3EA',
      },
      maxWidth: {
        prose: '68ch',
        site: '1280px',
      },
      spacing: {
        section: 'clamp(48px, 8vw, 96px)',
        'section-tight': 'clamp(32px, 5vw, 64px)',
      },
      fontSize: {
        'hero': ['clamp(3rem, 8vw, 6rem)', { lineHeight: 'var(--heading-line-height)', letterSpacing: 'var(--heading-letter-spacing)', fontWeight: '800' }],
        'h2': ['clamp(2.25rem, 5.5vw, 4rem)', { lineHeight: 'var(--heading-line-height)', letterSpacing: 'var(--heading-letter-spacing)', fontWeight: '700' }],
        'h3': ['clamp(1.75rem, 3.5vw, 2.75rem)', { lineHeight: 'var(--heading-line-height)', letterSpacing: 'var(--heading-letter-spacing)' }],
        'body-lg': ['clamp(1.25rem, 2vw, 1.45rem)', { lineHeight: 'var(--body-line-height)' }],
      },
      backgroundImage: {
        'field-pattern': "url(\"data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M30 0 L60 30 L30 60 L0 30 Z' fill='none' stroke='%23059669' stroke-width='0.5' opacity='0.06'/%3E%3C/svg%3E\")",
        'topo-lines': "url(\"data:image/svg+xml,%3Csvg width='100' height='100' xmlns='http://www.w3.org/2000/svg'%3E%3Cellipse cx='50' cy='50' rx='40' ry='30' fill='none' stroke='%23059669' stroke-width='0.4' opacity='0.04'/%3E%3Cellipse cx='50' cy='50' rx='30' ry='22' fill='none' stroke='%23059669' stroke-width='0.4' opacity='0.03'/%3E%3Cellipse cx='50' cy='50' rx='20' ry='14' fill='none' stroke='%23059669' stroke-width='0.4' opacity='0.02'/%3E%3C/svg%3E\")",
      },
    },
  },
  plugins: [],
};

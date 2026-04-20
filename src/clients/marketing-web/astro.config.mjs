import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import react from '@astrojs/react';

export default defineConfig({
  integrations: [tailwind(), react()],
  server: { port: 4000 },
  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'mr'],
    routing: { prefixDefaultLocale: true },
  },
});

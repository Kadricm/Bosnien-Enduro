import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: process.env.PUBLIC_SITE_URL || 'https://bosnien-endurotours-demo.vercel.app',
  output: 'server',
  adapter: vercel(),
  trailingSlash: 'ignore',
  devToolbar: { enabled: false }, // čist prikaz za prezentaciju
  vite: { plugins: [tailwindcss()] },
});

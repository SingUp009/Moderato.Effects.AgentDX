import react from '@astrojs/react';
import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';
import starlightThemeNord from 'starlight-theme-nord';

export default defineConfig({
  site: 'https://moderato-effects-agent-dx.009singup.workers.dev',
  trailingSlash: 'always',
  integrations: [
    starlight({
      title: 'Moderato.Effects Agent DX',
      favicon: '/favicon.svg',
      plugins: [starlightThemeNord()],
      social: [
        { icon: 'github', label: 'Benchmark repository', href: 'https://github.com/SingUp009/Moderato.Effects.AgentDX' },
      ],
    }),
    react(),
  ],
});

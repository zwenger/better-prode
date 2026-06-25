import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { cloudflare } from '@cloudflare/vite-plugin'

// TanStack Start + Cloudflare Workers. The worker entry (Durable Object export
// + test-auth interception) is src/server.ts, set as wrangler `main` — see that
// file for why a custom main is required.
//
// NOTE: `vite dev` is currently broken upstream — @cloudflare/vite-plugin's
// rolldown SSR dep-optimization fails to resolve TanStack's #tanstack-*-entry
// subpath imports (https://github.com/cloudflare/workers-sdk/issues/11100).
// The dev/test workflow uses `npm run build` + `npm run preview` instead, which
// does not run that dep-opt pass and works correctly. Re-enable `vite dev` once
// the upstream issue is fixed.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [
    devtools(),
    cloudflare({ viteEnvironment: { name: 'ssr' } }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
})

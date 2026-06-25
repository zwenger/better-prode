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
// optimizeDeps.exclude — REQUIRED for `vite dev`. @tanstack/start-server-core
// does `import('#tanstack-router-entry')` / `import('#tanstack-start-entry')`;
// the dev dep-optimizer tries to pre-bundle that package and can't resolve those
// subpath imports (tanstackStart() provides them at runtime, not in the package's
// own imports map). Excluding it defers resolution to runtime where the alias is
// present. (Project is pinned to Vite 7 — Vite 8's rolldown optimizer hits the
// same import eagerly and is not fixed by this exclude.)
export default defineConfig({
  optimizeDeps: {
    exclude: ['@tanstack/start-server-core', '@tanstack/react-start'],
  },
  environments: {
    ssr: {
      optimizeDeps: {
        exclude: ['@tanstack/start-server-core', '@tanstack/react-start'],
      },
    },
  },
  plugins: [
    devtools(),
    cloudflare({ viteEnvironment: { name: 'ssr' } }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
})

import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import { devtools } from '@tanstack/devtools-vite'
import path from 'node:path'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { cloudflare } from '@cloudflare/vite-plugin'

/**
 * Fix for @tanstack/start-server-core + @cloudflare/vite-plugin dev mode.
 *
 * Problem: rolldown dep-optimization for the SSR environment encounters
 * #tanstack-router-entry and #tanstack-start-entry dynamic imports inside
 * @tanstack/start-server-core. Rolldown's native Rust resolver handles #xxx
 * imports via Node's packageImportsResolve (from the importer's package.json)
 * BEFORE JavaScript plugins get a chance to intercept. Since @tanstack/start-server-core
 * doesn't define these entries, resolution fails.
 *
 * Fix: add resolveDynamicImport and resolveId hooks to the rolldownOptions
 * plugins list via configEnvironment() (which runs after config() hooks, so it
 * can append to the Cloudflare plugin's plugins list). Both hooks return the real
 * app entry files so rolldown bundles the correct modules.
 *
 * The pre-bundled output then contains references to the actual app router/start
 * files, which is the same result tanstackStart()'s resolve.alias would produce.
 */
function fixTanstackCloudflareDevPlugin(): Plugin {
  const root = path.resolve(import.meta.dirname)
  const routerEntry = path.join(root, 'src/router.tsx')
  const startEntry = path.join(root, 'src/start.ts')

  const rolldownEntryResolverPlugin = {
    name: 'better-prode:tanstack-entry-resolver',
    resolveId(id: string) {
      if (id === '#tanstack-router-entry') return routerEntry
      if (id === '#tanstack-start-entry') return startEntry
      return null
    },
    resolveDynamicImport(specifier: string) {
      if (specifier === '#tanstack-router-entry') return { id: routerEntry }
      if (specifier === '#tanstack-start-entry') return { id: startEntry }
      return null
    },
  }

  return {
    name: 'better-prode:fix-tanstack-cloudflare-dev',
    enforce: 'post',
    configEnvironment(name) {
      if (name === 'ssr') {
        return {
          optimizeDeps: {
            rolldownOptions: {
              plugins: [rolldownEntryResolverPlugin],
            },
          },
        }
      }
    },
  }
}

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [
    devtools(),
    cloudflare({ viteEnvironment: { name: 'ssr' } }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
    fixTanstackCloudflareDevPlugin(),
  ],
})

export default config

import { HeadContent, Link, Scripts, createRootRoute } from '@tanstack/react-router'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { TanStackDevtools } from '@tanstack/react-devtools'

import appCss from '../styles.css?url'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1, viewport-fit=cover',
      },
      {
        title: 'BetterProde',
      },
    ],
    links: [
      {
        rel: 'stylesheet',
        href: appCss,
      },
    ],
  }),
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <head>
        <HeadContent />
      </head>
      <body>
        <header
          style={{
            position: 'sticky',
            top: 0,
            zIndex: 30,
            backgroundColor: 'var(--background)',
            borderBottom: '1px solid var(--border-hairline)',
            display: 'flex',
            alignItems: 'center',
            height: '44px',
            paddingLeft: '1rem',
            paddingRight: '1rem',
          }}
        >
          <Link
            to="/today"
            data-testid="app-brand-home"
            style={{
              fontFamily: 'Archivo, system-ui, sans-serif',
              fontWeight: 700,
              fontSize: '1rem',
              color: 'var(--pitch-green)',
              textDecoration: 'none',
              letterSpacing: '-0.01em',
            }}
          >
            better-prode
          </Link>
        </header>
        {children}
        <TanStackDevtools
          config={{
            position: 'bottom-right',
          }}
          plugins={[
            {
              name: 'Tanstack Router',
              render: <TanStackRouterDevtoolsPanel />,
            },
          ]}
        />
        <Scripts />
      </body>
    </html>
  )
}

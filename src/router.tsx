import { useQuery } from '@tanstack/react-query'
import {
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Outlet,
} from '@tanstack/react-router'
import { TanStackRouterDevtools } from '@tanstack/router-devtools'

import { loadStackCards } from '@/lib/stack-data'

function RootLayout() {
  return (
    <div className="shell">
      <header className="hero">
        <p className="eyebrow">RipenFlow stack</p>
        <div className="hero-copy">
          <div>
            <h1>React + TanStack + Drizzle sobre Bun</h1>
            <p>
              Base inicial para producto web con TypeScript, routing tipado,
              cache declarativa, Postgres y linting moderno.
            </p>
          </div>
          <nav>
            <Link className="ghost-link" to="/">
              Inicio
            </Link>
          </nav>
        </div>
      </header>

      <main>
        <Outlet />
      </main>

      {import.meta.env.DEV ? <TanStackRouterDevtools /> : null}
    </div>
  )
}

function HomePage() {
  const stackQuery = useQuery({
    queryKey: ['stack-cards'],
    queryFn: loadStackCards,
  })

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <p className="section-label">Estado</p>
          <h2>Stack listo para empezar a construir</h2>
        </div>
        <span className="pill">
          {stackQuery.isSuccess ? 'Listo' : 'Cargando'}
        </span>
      </div>

      <div className="grid">
        {stackQuery.data?.map((card) => (
          <article key={card.title} className="card">
            <p className="card-kicker">{card.title}</p>
            <h3>{card.summary}</h3>
            <p>{card.detail}</p>
          </article>
        ))}
      </div>

      <div className="panel-footer">
        <div>
          <p className="section-label">Comandos</p>
          <code>bun dev</code>
        </div>
        <div>
          <p className="section-label">Migraciones</p>
          <code>bun run db:generate</code>
        </div>
        <div>
          <p className="section-label">Lint</p>
          <code>bun run lint</code>
        </div>
      </div>
    </section>
  )
}

const rootRoute = createRootRoute({
  component: RootLayout,
})

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: HomePage,
})

const routeTree = rootRoute.addChildren([indexRoute])

export const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

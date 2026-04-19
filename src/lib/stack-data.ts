export type StackCard = {
  title: string
  summary: string
  detail: string
}

const stackCards: StackCard[] = [
  {
    title: 'React + TypeScript',
    summary: 'UI con Vite, React 19 y alias @ configurado.',
    detail:
      'La app arranca con TypeScript estricto y una base lista para crecer.',
  },
  {
    title: 'TanStack',
    summary: 'Router y React Query ya integrados.',
    detail: 'Tenes routing tipado, cache declarativa y devtools en desarrollo.',
  },
  {
    title: 'Postgres + Drizzle',
    summary: 'Schema, cliente y scripts de migracion preparados.',
    detail:
      'Solo falta definir DATABASE_URL para generar o correr migraciones.',
  },
  {
    title: 'Bun + Biome',
    summary: 'Scripts pensados para Bun y lint/format con Biome.',
    detail:
      'El repo queda sin ESLint y con comandos unificados para chequeo y formato.',
  },
]

export async function loadStackCards() {
  return stackCards
}

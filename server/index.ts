import path from 'node:path'

const port = Number.parseInt(process.env.PORT ?? '3000', 10)
const hostname = '0.0.0.0'
const distDir = path.join(process.cwd(), 'dist')
const indexFile = Bun.file(path.join(distDir, 'index.html'))

function jsonResponse(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      'cache-control': 'no-store',
    },
  })
}

function inferContentType(filePath: string) {
  return Bun.file(filePath).type || 'application/octet-stream'
}

async function handleApiRequest(request: Request) {
  const url = new URL(request.url)

  if (request.method === 'GET' && url.pathname === '/health') {
    return jsonResponse({
      ok: true,
      service: 'ripenflow-web',
      uptimeSeconds: Math.round(process.uptime()),
    })
  }

  if (request.method === 'GET' && url.pathname === '/api/health') {
    try {
      const { checkDatabaseConnection } = await import('../db/health')

      await checkDatabaseConnection()

      return jsonResponse({
        ok: true,
        database: 'reachable',
      })
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Database check failed'

      return jsonResponse(
        {
          ok: false,
          database: 'unreachable',
          error: message,
        },
        503,
      )
    }
  }

  return null
}

async function serveStaticAsset(url: URL) {
  const relativePath =
    url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, '')
  const filePath = path.join(distDir, relativePath)
  const file = Bun.file(filePath)
  const looksLikeAssetRequest = path.extname(relativePath).length > 0

  if (await file.exists()) {
    return new Response(file, {
      headers: {
        'content-type': inferContentType(filePath),
      },
    })
  }

  if (looksLikeAssetRequest) {
    return new Response('Not found', {
      status: 404,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
      },
    })
  }

  if (await indexFile.exists()) {
    return new Response(indexFile, {
      headers: {
        'content-type': 'text/html; charset=utf-8',
      },
    })
  }

  return new Response(
    'Frontend build not found. Run "bun run build" before starting the server.',
    {
      status: 500,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
      },
    },
  )
}

const server = Bun.serve({
  hostname,
  port,
  async fetch(request) {
    const apiResponse = await handleApiRequest(request)

    if (apiResponse) {
      return apiResponse
    }

    return serveStaticAsset(new URL(request.url))
  },
})

console.log(`RipenFlow server listening on http://${server.hostname}:${server.port}`)

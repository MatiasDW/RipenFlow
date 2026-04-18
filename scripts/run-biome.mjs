import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

const candidatesByPlatform = {
  darwin: ['@biomejs/cli-darwin-arm64/biome', '@biomejs/cli-darwin-x64/biome'],
  linux: [
    '@biomejs/cli-linux-arm64/biome',
    '@biomejs/cli-linux-arm64-musl/biome',
    '@biomejs/cli-linux-x64/biome',
    '@biomejs/cli-linux-x64-musl/biome',
  ],
  win32: [
    '@biomejs/cli-win32-arm64/biome.exe',
    '@biomejs/cli-win32-x64/biome.exe',
  ],
}

const candidates = candidatesByPlatform[process.platform] ?? []

const binaryPath = candidates.find((candidate) => {
  try {
    require.resolve(candidate)
    return true
  } catch {
    return false
  }
})

if (!binaryPath) {
  throw new Error(`Biome binary not found for platform ${process.platform}`)
}

const resolvedBinary = require.resolve(binaryPath)

const result = spawnSync(resolvedBinary, process.argv.slice(2), {
  stdio: 'inherit',
})

if (result.error) {
  throw result.error
}

process.exit(result.status ?? 1)

import { access, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
const root = resolve(import.meta.dirname, '..')
const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
const patch = await readFile(resolve(root, 'cordis.patch.yml'), 'utf8')

if (manifest.name !== 'dsh-risk-guard') {
  throw new Error(`unexpected npm package name: ${JSON.stringify(manifest.name)}`)
}
if (manifest.publishConfig?.access !== 'public' || manifest.publishConfig?.registry !== 'https://registry.npmjs.org/') {
  throw new Error('package must publish publicly to the official npm registry')
}
if (!patch.includes("name: 'dsh-risk-guard'")) {
  throw new Error('cordis.patch.yml must resolve the npm package name')
}
if (manifest.scripts?.prepublishOnly !== 'pnpm verify' || manifest.scripts?.prepare !== undefined) {
  throw new Error('npm release lifecycle scripts are missing or Git prepare is still enabled')
}
for (const peer of Object.keys(manifest.peerDependencies ?? {})) {
  if (manifest.peerDependenciesMeta?.[peer]?.optional !== true) {
    throw new Error(`DSH-provided peer must be optional for clean profile installation: ${peer}`)
  }
}
if (manifest.dsh?.bundle?.patch !== './cordis.patch.yml') {
  throw new Error('bundle patch declaration is missing or incorrect')
}
for (const path of ['./lib/index.js', './lib/index.d.ts', './cordis.patch.yml', './README.md', './README.zh.md', './LICENSE']) {
  await access(resolve(root, path))
}
for (const entry of ['lib', 'cordis.patch.yml', 'README.md', 'README.zh.md', 'LICENSE']) {
  if (!manifest.files?.includes(entry)) throw new Error(`npm files[] is missing ${entry}`)
}

const mod = await import(pathToFileURL(resolve(root, 'lib/index.js')).href)
if ('default' in mod) {
  throw new Error('built plugin must not expose a default export (function/object form only)')
}
if (mod.name !== 'risk-guard' || typeof mod.apply !== 'function' || mod.Config == null) {
  throw new Error('built plugin exports are not the expected Cordis plugin shape')
}

console.log('package contract verified')

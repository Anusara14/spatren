// Publishes the Android over-the-air update with every web build (runs after `vite build`, locally and on Vercel):
//   dist/ota/web-<build>.zip   the built web app (index.html at the root, as Capgo expects)
//   dist/app-version.json      { build, zip, sha256, minNative, apk } that the app checks on open
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { zipSync } from 'fflate'

const SITE = 'https://spatren.vercel.app'
const dist = 'dist'
const build = Number(readFileSync(join(dist, 'build.txt'), 'utf8'))
if (!Number.isFinite(build)) throw new Error('dist/build.txt missing: run vite build first')
const native = JSON.parse(readFileSync('native-version.json', 'utf8'))

const files = {}
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const rel = relative(dist, p).split(sep).join('/')
    if (rel === 'ota' || rel === 'app-version.json') continue // never zip earlier outputs
    if (statSync(p).isDirectory()) walk(p)
    else files[rel] = readFileSync(p)
  }
}
walk(dist)
if (!files['index.html']) throw new Error('dist/index.html missing')

const zip = zipSync(files, { level: 9 })
const name = `web-${build}.zip`
mkdirSync(join(dist, 'ota'), { recursive: true })
writeFileSync(join(dist, 'ota', name), zip)
const manifest = {
  build,
  zip: `${SITE}/ota/${name}`,
  sha256: createHash('sha256').update(zip).digest('hex'),
  minNative: native.minNativeForWeb,
  apk: { versionCode: native.versionCode, versionName: native.versionName, url: native.apkUrl },
}
writeFileSync(join(dist, 'app-version.json'), JSON.stringify(manifest, null, 2))
console.info(`ota: build ${build}, ${(zip.length / 1024).toFixed(0)} KB, ${Object.keys(files).length} files`)

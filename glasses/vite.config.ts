import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'
import { readFileSync } from 'node:fs'

// One self-contained index.html (no asset paths to get wrong in the phone's WebView), as in the
// owner's g2-claude-starter. The version is baked in for the phone page.
const manifest = JSON.parse(readFileSync(new URL('./app.json', import.meta.url), 'utf8'))
export default defineConfig({
  base: './',
  plugins: [viteSingleFile()],
  build: { target: 'es2020', outDir: 'dist' },
  server: { host: true },
  define: { __APP_VERSION__: JSON.stringify(manifest.version) },
})

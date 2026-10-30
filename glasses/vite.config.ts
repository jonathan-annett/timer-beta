import { defineConfig } from 'vite'

// Relative asset paths: the Even app loads the packed files from wherever it keeps them
export default defineConfig({ base: './', server: { host: true } })

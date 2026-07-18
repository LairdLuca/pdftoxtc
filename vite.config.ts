import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base './' keeps the build relocatable (GitHub Pages subpath, local file serving)
export default defineConfig({
  base: './',
  plugins: [react()]
})

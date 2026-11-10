import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Tauri serves the built files; dev runs on a fixed port the Rust side points at.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 5180, strictPort: true, fs: { allow: ['..'] } }, // shares the phone app's design tokens in ../src
  build: { target: 'es2022' },
})

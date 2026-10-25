import { defineConfig } from 'vite';

// La base se puede cambiar sin tocar código:
//   - Vercel, Netlify y dominio propio: se queda en '/'.
//   - GitHub Pages de un repositorio llamado TurboCircuit: VITE_BASE=/TurboCircuit/
// En desarrollo siempre se sirve en la raíz.
export default defineConfig({
  base: process.env.VITE_BASE || '/',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    target: 'es2020',
  },
  server: {
    open: false,
    port: 5173,
  },
  preview: {
    port: 4173,
  },
});

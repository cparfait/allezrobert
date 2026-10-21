import { defineConfig } from 'vite';

/**
 * Appli compagnon (PWA). En production elle est servie par Caddy sous /companion/ (même
 * origine que le jeu et l'API : cookie de session partagé). En dev : http://localhost:5174.
 */
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/companion/' : '/',
  server: {
    port: 5174,
    strictPort: true,
    host: true,
    // Le client réseau est partagé avec le jeu (apps/client/src/net).
    fs: { allow: ['..', '../../packages'] },
  },
  preview: { port: 5174, strictPort: true },
  build: { target: 'es2022', sourcemap: true, outDir: 'dist', emptyOutDir: true },
  clearScreen: false,
}));

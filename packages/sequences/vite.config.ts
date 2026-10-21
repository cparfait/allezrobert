// Banc d'essai des séquences (dev/index.html) — n'affecte pas le client du jeu.
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'dev',
  server: { port: 5180, strictPort: true, fs: { allow: ['..', '../../..'] } },
  clearScreen: false,
});

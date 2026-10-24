import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts', 'tools/*/test/**/*.test.ts'],
    environment: 'node',
    // Les audits de confidentialité des mondes parcourent des milliers de fichiers : plus de 5 s dès que le dossier grossit.
    testTimeout: 30_000,
  },
});

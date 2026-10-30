import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts', 'tools/*/test/**/*.test.ts'],
    environment: 'node',
    // Les audits de confidentialité des mondes parcourent des milliers de fichiers : plus de 5 s dès que le dossier grossit.
    testTimeout: 30_000,
    // Avec TEST_DATABASE_URL (CI), les fichiers de test partagent une même base PostgreSQL qu'ils remettent à zéro
    // (DROP SCHEMA) : en parallèle ils se marchent dessus (« duplicate key … pg_type_typname_nsp_index »).
    fileParallelism: !process.env.TEST_DATABASE_URL,
  },
});

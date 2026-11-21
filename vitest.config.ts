import { defineConfig } from 'vitest/config';

// Avec TEST_DATABASE_URL (CI), les fichiers de test du serveur partagent une même base PostgreSQL qu'ils remettent à
// zéro (DROP SCHEMA) : en parallèle ils se marchent dessus (« duplicate key … pg_type_typname_nsp_index »). Seul le
// projet « server » passe donc en série ; les autres paquets, qui n'ont pas de base, restent en parallèle.
const common = {
  environment: 'node' as const,
  // Les audits de confidentialité des mondes parcourent des milliers de fichiers : plus de 5 s dès que le dossier grossit.
  testTimeout: 30_000,
};

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          ...common,
          name: 'server',
          include: ['apps/server/test/**/*.test.ts'],
          fileParallelism: !process.env.TEST_DATABASE_URL,
        },
      },
      {
        test: {
          ...common,
          name: 'unit',
          include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts', 'tools/*/test/**/*.test.ts'],
          exclude: ['apps/server/**', '**/node_modules/**'],
        },
      },
    ],
  },
});

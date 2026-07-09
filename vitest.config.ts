import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Reporting only — no thresholds. `npm run coverage` exists so untested
    // modules stop hiding: two bugs shipped in code no test ever executed (#50).
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'html'],
      reportsDirectory: 'coverage',
      include: ['src/**/*.ts', 'server/**/*.ts'],
      exclude: ['src/main.ts', '**/*.d.ts'],
    },
  },
});

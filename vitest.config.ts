import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    clearMocks: true,
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['lib/**/*.ts', 'app/components/*-model.ts', 'app/components/consumer-utils.ts'],
      exclude: ['lib/**/*.d.ts', 'lib/**/types.ts', 'lib/i18n/**'],
      thresholds: {
        lines: 75,
        statements: 70,
        functions: 70,
        branches: 60,
      },
    },
  },
});

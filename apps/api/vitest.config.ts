import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Integration tests need a database; they have their own config and command.
    exclude: ['src/**/*.int.test.ts'],
  },
});

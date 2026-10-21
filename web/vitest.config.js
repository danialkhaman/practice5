import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.js', 'monitor/**/*.test.js'],
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 120_000,
    fileParallelism: false, // каждый файл поднимает свой Anvil на своём порту, но последовательно надёжнее
    reporters: ['verbose'],
  },
});

import { defineConfig } from 'vitest/config';

// Three named projects so CI can report them separately and so `npm test`
// never silently skips a layer.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'functional',
          include: ['tests/functional/**/*.test.ts'],
          environment: 'jsdom',
        },
      },
      {
        test: {
          name: 'regression',
          include: ['tests/regression/**/*.test.ts'],
          environment: 'jsdom',
        },
      },
    ],
  },
});

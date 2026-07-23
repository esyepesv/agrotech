// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/require-await': 'off',
    },
  },
  // Regla de dependencia hexagonal: domain y application no importan
  // infraestructura, interfaces, config ni librerías externas.
  {
    files: ['src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '**/application/**',
                '**/infrastructure/**',
                '**/interfaces/**',
                '**/config/**',
              ],
              message: 'domain es puro: no puede importar capas externas.',
            },
            {
              group: ['fastify', 'openai', '@supabase/*', 'pino', 'zod', 'node:*'],
              message: 'domain es puro: no puede importar librerías externas.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/application/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/infrastructure/**', '**/interfaces/**', '**/config/**'],
              message: 'application solo depende de domain.',
            },
            {
              group: ['fastify', 'openai', '@supabase/*', 'pino', 'zod'],
              message: 'application solo depende de domain: sin librerías externas.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['eslint.config.js', 'vitest.config.ts'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  prettier,
);

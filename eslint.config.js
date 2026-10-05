import eslint from '@eslint/js'
import eslintReact from '@eslint-react/eslint-plugin'
import query from '@tanstack/eslint-plugin-query'
import { defineConfig, globalIgnores } from 'eslint/config'
import prettier from 'eslint-config-prettier/flat'
import reactHooks from 'eslint-plugin-react-hooks'
import simpleImportSort from 'eslint-plugin-simple-import-sort'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default defineConfig(
  globalIgnores(['dist/**', 'coverage/**', 'node_modules/**']),
  {
    files: ['**/*.{js,ts,tsx}'],
    extends: [eslint.configs.recommended],
    plugins: { 'simple-import-sort': simpleImportSort },
    rules: {
      'no-duplicate-imports': ['error', { allowSeparateTypeImports: true }],
      'simple-import-sort/imports': [
        'error',
        {
          groups: [
            ['^\\u0000(?!.*\\.css$)'],
            ['^react(?:$|/|-dom)(?!.*\\u0000$)'],
            ['^node:', '^@?\\w(?!.*\\u0000$)'],
            ['^\\.{1,2}/(?:.*/)?(?:app|api|shared)/(?!.*\\u0000$)'],
            [
              '^\\.{1,2}/(?:.*/)?features/(?!.*\\u0000$)',
              '^\\.\\./(?:chats|connection|messages|notifications)/(?!.*\\u0000$)',
            ],
            ['^\\.(?!.*\\u0000$)'],
            ['\\u0000$'],
            ['^.+\\.(?:css|svg|png|jpe?g|webp)(?:\\u0000)?$'],
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [
      eslintReact.configs['recommended-typescript'],
      reactHooks.configs.flat.recommended,
      query.configs['flat/recommended'],
    ],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    files: ['*.config.{js,ts}'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['src/**/*.test.{ts,tsx}'],
    rules: {
      '@typescript-eslint/require-await': 'off',
    },
  },
  prettier,
)

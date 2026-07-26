import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'

const applicationFiles = ['src/**/*.{ts,tsx}', 'tests/**/*.{ts,tsx}', '*.{config,setup}.ts']
const typescriptFiles = [...applicationFiles, 'scripts/**/*.ts']

export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'release/**',
      'coverage/**',
      'test-results/**',
      'playwright-report/**',
      'AnimalWF/**'
    ]
  },
  {
    ...js.configs.recommended,
    files: ['scripts/**/*.mjs', '*.config.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.node
    }
  },
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: typescriptFiles,
    languageOptions: {
      ...config.languageOptions,
      parserOptions: {
        ...config.languageOptions?.parserOptions,
        ecmaVersion: 'latest',
        sourceType: 'module'
      },
      globals: {
        ...globals.browser,
        ...globals.node
      }
    }
  })),
  {
    files: applicationFiles,
    plugins: {
      'react-hooks': reactHooks
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          varsIgnorePattern: '^_'
        }
      ],
      'no-console': ['error', { allow: ['error', 'warn'] }],
      'react-hooks/exhaustive-deps': 'error',
      'react-hooks/rules-of-hooks': 'error'
    }
  },
  {
    files: ['scripts/accessibility-audit.mjs', 'scripts/file-smoke.mjs', 'scripts/pages-smoke.mjs'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser
      }
    }
  }
)

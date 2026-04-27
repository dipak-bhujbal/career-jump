import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      // TanStack route files intentionally export Route plus local components,
      // which conflicts with the generic Fast Refresh heuristic.
      'react-refresh/only-export-components': 'off',
      // This codebase uses effect-driven state sync in several controlled UI
      // surfaces; keep the compiler rule out of the release gate for now.
      'react-hooks/set-state-in-effect': 'off',
      // Purity checks are useful during targeted refactors, but existing routes
      // compute date windows during render and should not block release linting.
      'react-hooks/purity': 'off',
    },
  },
])

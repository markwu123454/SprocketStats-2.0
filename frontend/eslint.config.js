import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { globalIgnores } from 'eslint/config'

export default tseslint.config([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs['recommended-latest'],
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
  },
  {
    // Notification / push platform APIs may only be touched by src/lib/push.ts,
    // which wraps them in null-safe guards. Anywhere else, calling them directly
    // reintroduces the "notification returned None → page crash" class of bug, so
    // ban them and point people at the guarded helpers instead.
    files: ['**/*.{ts,tsx}'],
    // src/lib/push.ts owns the notification/push API surface. src/main.tsx is the
    // sanctioned bootstrap spot for service-worker *lifecycle* wiring (PWA update
    // reload) — that's not the notification path, so it's exempt too.
    ignores: ['src/lib/push.ts', 'src/main.tsx'],
    rules: {
      'no-restricted-globals': [
        'error',
        {
          name: 'Notification',
          message: 'Use the guarded helpers in src/lib/push.ts instead of Notification directly.',
        },
        {
          name: 'PushManager',
          message: 'Use the guarded helpers in src/lib/push.ts instead of PushManager directly.',
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[property.name='serviceWorker'][object.name='navigator']",
          message: 'Use the guarded helpers in src/lib/push.ts instead of navigator.serviceWorker directly.',
        },
      ],
    },
  },
])

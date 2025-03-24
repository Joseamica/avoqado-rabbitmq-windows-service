// eslint.config.js
import globals from 'globals'
import js from '@eslint/js'
import eslintConfigPrettier from 'eslint-config-prettier'
import prettierPlugin from 'eslint-plugin-prettier'

/** @type {import('eslint').Linter.FlatConfig[]} */
export default [
  // Global browser environment
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node // Add Node.js globals since you're using it
      },
      ecmaVersion: 2022,
      sourceType: 'module'
    }
  },

  // Base ESLint recommended rules
  js.configs.recommended,

  // Prettier plugin with recommended configuration
  {
    plugins: {
      prettier: prettierPlugin
    },
    rules: {
      ...eslintConfigPrettier.rules,
      'prettier/prettier': 'error',
      'no-console': 'off', // Allow console.log
      'no-undef': 'error', // Error on undefined variables
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }] // Error on unused variables except those starting with _
    }
  },

  // Specific overrides for different file types if needed
  {
    files: ['**/*.js'],
    rules: {
      // Any JavaScript-specific rules
    }
  }
]

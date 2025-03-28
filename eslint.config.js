import { defineConfig } from 'eslint/config'
import globals from 'globals'
import js from '@eslint/js'

export default defineConfig([
  // Common settings for all JavaScript files
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node }
    },
    plugins: { js },
    extends: ['js/recommended']
  },

  // Settings specific for ES Modules (.mjs files and .js if using "type": "module" in package.json)
  {
    files: ['**/*.mjs'],
    languageOptions: {
      sourceType: 'module',
      ecmaVersion: 2022
    }
  },

  // Settings specific for CommonJS modules (.cjs files)
  {
    files: ['**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      ecmaVersion: 2022
    }
  },

  // For .js files, you should decide based on your package.json "type" field
  // If "type": "module" in package.json, use:
  {
    files: ['**/*.js'],
    languageOptions: {
      sourceType: 'module', // Change to "commonjs" if not using "type": "module"
      ecmaVersion: 2022
    }
  }
])

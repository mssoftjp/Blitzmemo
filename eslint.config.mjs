import eslint from '@eslint/js';
import globals from 'globals';
import path from 'node:path';
import tseslint from 'typescript-eslint';
import { fileURLToPath } from 'node:url';

const tsconfigRootDir = path.dirname(fileURLToPath(import.meta.url));

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir
      }
    },
    rules: {
      ...tseslint.configs.recommendedTypeCheckedOnly[2].rules,
      'no-undef': 'off'
    }
  },
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node
      }
    }
  },
  {
    rules: {
      'no-restricted-globals': 'off',
      'no-alert': 'off'
    }
  },
  {
    ignores: ['**/node_modules/**/*', '**/dist/**/*', 'src/renderer/lib/fvad-wasm/**']
  },
  {
    linterOptions: {
      reportUnusedDisableDirectives: true
    }
  }
);

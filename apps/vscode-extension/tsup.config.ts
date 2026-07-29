import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/extension.ts'],
  format: ['cjs'],
  external: ['vscode'],
  outDir: 'dist',
  clean: false,
  sourcemap: true,
  outExtension: () => ({ js: '.cjs' })
});


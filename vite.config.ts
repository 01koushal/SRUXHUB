import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { localFileApi } from './scripts/local-file-api.mjs';

export default defineConfig(({ command, mode }) => {
  const root = process.cwd();
  const localApi = command === 'serve'
    ? [localFileApi(loadEnv(mode, root, ''))]
    : [];

  return {
    plugins: [react(), ...localApi as Plugin[]],
  };
});

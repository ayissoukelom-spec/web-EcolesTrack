import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const resolveReact = (subpath: string) => path.resolve(__dirname, 'node_modules', 'react', subpath);
const resolveReactDom = (subpath: string) => path.resolve(__dirname, 'node_modules', 'react-dom', subpath);

export default defineConfig({
  plugins: [react()],
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      '@web-root': path.resolve(__dirname, '../src'),
      react: path.resolve(__dirname, 'node_modules/react'),
      'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
      'react/jsx-runtime': resolveReact('jsx-runtime.js'),
      'react/jsx-dev-runtime': resolveReact('jsx-dev-runtime.js'),
      'react-dom/client': path.resolve(__dirname, 'node_modules/react-dom/client/dist/react-dom-client.cjs.js'),
    },
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
  },
  server: {
    port: 4173,
    fs: {
      allow: ['..'],
    },
  },
});

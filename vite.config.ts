import { defineConfig } from 'vite';

// The deploy host is deliberately not baked in. GitHub Pages serves a project
// site from /<repo>/, Cloudflare Pages and a local preview serve from /.
// Set VITE_BASE in CI to move hosts without touching anything else.
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  build: {
    target: 'es2022',
    // No runtime network calls, so everything must be in the bundle.
    assetsInlineLimit: 0,
    sourcemap: true,
  },
});

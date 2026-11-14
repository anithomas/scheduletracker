import { defineConfig, type Plugin } from 'vite';
import { copyFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// recurrence.js has to stay at the repo root, unmodified, because
// scripts/send-reminders.js and scripts/recurrence.test.js both `require('../recurrence')`
// from the scripts/ directory — moving it into public/ (Vite's usual way of
// shipping an unbundled static file) would break that Node-side require.
// This plugin is the alternative: it serves the root file at /recurrence.js
// in `vite dev`, and copies it into dist/ after `vite build`, so the one
// file on disk is what both the browser and the reminder job run — nothing
// to keep in sync by hand.
function recurrenceJsAsStatic(): Plugin {
  const src = resolve(__dirname, 'recurrence.js');
  return {
    name: 'recurrence-js-as-static',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url === '/recurrence.js') {
          res.setHeader('Content-Type', 'application/javascript');
          res.end(readFileSync(src));
          return;
        }
        next();
      });
    },
    closeBundle() {
      copyFileSync(src, resolve(__dirname, 'dist/recurrence.js'));
    },
  };
}

// Household Tracker — Phase 3 (R4): Vite build replacing the old single
// index.html served as-is. GitHub Pages still serves static files from a
// directory; the only change is that directory is now a build *output*
// (dist/) instead of the repo root. See the Phase 3 PR description for the
// one manual GitHub Settings change (Pages source → "GitHub Actions") this
// requires before it can go live.
export default defineConfig({
  base: '/',
  plugins: [recurrenceJsAsStatic()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: 'index.html',
      },
    },
  },
  server: {
    port: 5173,
  },
});

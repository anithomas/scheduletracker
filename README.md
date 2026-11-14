# scheduletracker
Family Schedule Tracker

## Development

The app is a Vite + TypeScript build (Phase 3). The source lives in `src/`;
`index.html` is the entry HTML and `recurrence.js` stays a plain script at
the repo root (it's also `require()`'d server-side by `scripts/send-reminders.js`).

```sh
npm install
npm run dev      # local dev server
npm run build    # type-checks, then builds dist/
npm run preview  # serve the dist/ build locally
```

Deploys to tracker.logicmanse.ca happen via the "Deploy to GitHub Pages"
GitHub Actions workflow, which builds `dist/` and publishes it.

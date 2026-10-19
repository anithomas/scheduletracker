# Access & security rules

Who can use the tracker is decided by the database, not just the app screen.

| Role | Can do |
|---|---|
| admin | Everything, including Admin settings and who has access |
| contributor | View everything; add, edit, delete records, events and home items |
| viewer | View everything; manage only their own devices and notification preferences |
| denied / not listed | Nothing |

Roles live in Firestore at `settings/config`:

- `authorizedUsers` — the list shown under **Admin → Family Members & Access**
- `accessRoles` — `{ "email@lowercase": "role" }`, written by the app from
  `authorizedUsers` every time an admin saves. **The rules read this map.**

Rules files: `firestore.rules`, `storage.rules`. Tests: `tests/rules/`
(run automatically by the *Security rules tests* GitHub Action on any change).

## Deploying rules

Order matters the first time: the app must write `accessRoles` before the
rules that depend on it go live.

1. Deploy the app (push to `main`).
2. Sign in once as an admin. The app writes `accessRoles` automatically.
   Check in the Firebase console that `settings/config` now has an
   `accessRoles` field listing every household email.
3. Publish the rules, either:
   - **Console:** Firestore → Rules → paste `firestore.rules` → Publish;
     Storage → Rules → paste `storage.rules` → Publish (accept the prompt to
     let Storage read Firestore), or
   - **CLI:** `npx firebase-tools deploy --only firestore:rules,storage`

## If everyone is locked out

The app no longer makes the first person to sign in an admin. To recover,
open the Firebase console → Firestore → `settings/config` and set
`accessRoles.<your email in lowercase>` to `admin` (and add yourself to
`authorizedUsers` with `role: "admin"`). Reload the app.

## Notes

- The daily reminder job uses the Firebase Admin SDK and is not affected by
  these rules.
- Attachments are linked by download URL; anyone holding a specific file's
  URL can open that file.
- The Firebase web API key in `index.html` is a public identifier, not a
  secret; these rules are what protect the data. If you add website
  restrictions to the key in Google Cloud Console, include every origin the
  app runs on (tracker.logicmanse.ca, the firebaseapp.com auth domain, and
  the Android app) or sign-in will break.

#!/bin/bash
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

# Root deps: Capacitor CLI/Android tooling used by build-apk.yml
npm install --prefix "$CLAUDE_PROJECT_DIR"

# scripts/ deps: firebase-admin + nodemailer used by send-reminders.js (reminders.yml)
npm install --prefix "$CLAUDE_PROJECT_DIR/scripts"

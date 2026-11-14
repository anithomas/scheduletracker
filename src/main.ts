// ─── APP ENTRY POINT ────────────────────────────────────────────
// Imports every module in the same top-to-bottom order the old single-file
// index.html executed its sections in (Phase 3 / R4: TypeScript + Vite
// modules replacing one 2894-line inline <script>). Importing a module runs
// its top-level side effects — Firebase init, the auth-state listener, the
// periodic refresh timer, etc. — exactly once, in that order.
//
// index.html's markup still calls these functions by name from inline
// onclick="…"/onchange="…" attributes (and the handful of module files that
// build the same kind of attribute string into innerHTML at runtime). Vite's
// module output has no globals, so every function reachable that way has to
// be attached to `window` explicitly below — this is the one place that
// happens.
import './modules/firebase-init';
import './modules/html-escape';
import './modules/dialogs';
import './modules/save-guards';
import './modules/settings';
import {
  markAdminFormDirty,
} from './modules/vehicles';
import {
  onEventMemberChange, previewBranding, saveBranding, saveTaxSettings,
  selectVehicleColor, selectMemberColor, openAdminVehicleModal, saveAdminVehicle,
  delAdminVehicle, openAdminMemberModal, saveAdminMember, delAdminMember,
  toggleNotifyAll, toggleMpNotifyAll, openMyProfile, saveMyProfile,
  registerMyDevice, registerCurrentMemberDevice, unregisterCurrentMemberDevice,
  removeSpecificDeviceToken,
} from './modules/member-prefs';
import { saveReminderSettings } from './modules/notifications';
import {
  addHomeCategory, addServiceType, addEventType, removeCat, removeService, delEventType,
} from './modules/admin-catalog';
import './modules/display-names';
import { removeAuthorizedUser, setUserRole } from './modules/rbac';
import { signInWithGoogle, signOut } from './modules/auth';
import './modules/listeners';
import './modules/utils';
import { showSection, fabAction } from './modules/section-nav';
import { updateHst, overrideTotal, updateKm, updateHomeDuration } from './modules/tax';
import { previewFile, openAttachmentLink } from './modules/file-upload';
import { saveAuto, editAuto, delAuto, toggleAutoDone } from './modules/auto';
import { toggleHomeDone } from './modules/home';
import { saveHome, editHome, delHome } from './modules/mark-done';
import {
  changeMonth, goToday, openCalDay, saveEvent, editEvent, toggleRecurOptions,
} from './modules/calendar';
import {
  confirmDeleteEvent, deleteFromModal, runDeleteChoice, toggleEventDone,
} from './modules/delete-event';
import { syncToGCal } from './modules/gcal-sync';
import {
  showReport, renderReportAuto, renderReportHome, renderReportCal,
} from './modules/reports';
import { openModal, closeModal } from './modules/modal';
import { initAboutBadge, registerServiceWorker } from './modules/app-init';

Object.assign(window, {
  // modal.ts
  openModal, closeModal,
  // section-nav.ts
  showSection, fabAction,
  // tax.ts
  updateHst, overrideTotal, updateKm, updateHomeDuration,
  // file-upload.ts
  previewFile, openAttachmentLink,
  // auto.ts
  saveAuto, editAuto, delAuto, toggleAutoDone,
  // home.ts / mark-done.ts
  toggleHomeDone, saveHome, editHome, delHome,
  // calendar.ts
  changeMonth, goToday, openCalDay, saveEvent, editEvent, toggleRecurOptions,
  // delete-event.ts
  confirmDeleteEvent, deleteFromModal, runDeleteChoice, toggleEventDone,
  // gcal-sync.ts
  syncToGCal,
  // reports.ts
  showReport, renderReportAuto, renderReportHome, renderReportCal,
  // auth.ts
  signInWithGoogle, signOut,
  // rbac.ts
  removeAuthorizedUser, setUserRole,
  // vehicles.ts
  markAdminFormDirty,
  // member-prefs.ts
  onEventMemberChange, previewBranding, saveBranding, saveTaxSettings,
  selectVehicleColor, selectMemberColor, openAdminVehicleModal, saveAdminVehicle,
  delAdminVehicle, openAdminMemberModal, saveAdminMember, delAdminMember,
  toggleNotifyAll, toggleMpNotifyAll, openMyProfile, saveMyProfile,
  registerMyDevice, registerCurrentMemberDevice, unregisterCurrentMemberDevice,
  removeSpecificDeviceToken,
  // notifications.ts
  saveReminderSettings,
  // admin-catalog.ts
  addHomeCategory, addServiceType, addEventType, removeCat, removeService, delEventType,
});

// Page-setup that used to run as separate inline <script> tags in
// index.html (see app-init.ts for why that moved here — in short, S5's CSP
// can't allow unnamed inline scripts to run).
initAboutBadge();
registerServiceWorker();

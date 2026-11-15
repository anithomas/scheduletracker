// ─── SECTION NAV ──────────────────────────────────────────────
import { renderSummary } from './reports';
import { openModal } from './modal';

// FAB config per section (mobile only)
const FAB_CONFIG: Record<string, { label: string; title: string; modal: string }> = {
  calendar:  { label:'📅', title:'Add Event',    modal:'calModal'    },
  auto:      { label:'🚗', title:'Add Record',   modal:'autoModal'   },
  home:      { label:'🏡', title:'Add Item',     modal:'homeModal'   },
  renewals:  { label:'🔖', title:'Add Renewal',  modal:'renewalModal' },
};
let _currentSection = 'calendar';

export function showSection(id: string, btn: HTMLElement) {
  document.querySelectorAll('.section').forEach(s=>s.classList.remove('active'));
  document.querySelectorAll('nav button, .mobile-bottom-nav button').forEach(b=>b.classList.remove('active'));
  document.getElementById(id)!.classList.add('active');
  document.querySelectorAll(`[onclick*="'${id}'"]`).forEach(b=>b.classList.add('active'));
  if(id==='reports') renderSummary();
  window.scrollTo(0, 0);
  _currentSection = id;
  // Show/hide FAB based on section
  const fab = document.getElementById('fab');
  if(fab){
    const cfg = FAB_CONFIG[id];
    if(cfg){
      fab.classList.remove('fab-hidden');
      fab.title = cfg.title;
    } else {
      fab.classList.add('fab-hidden');
    }
  }
}

export function fabAction(){
  const cfg = FAB_CONFIG[_currentSection];
  if(cfg) openModal(cfg.modal);
}

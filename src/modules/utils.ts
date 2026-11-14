// ─── UTILITIES ────────────────────────────────────────────────
import { parseDs, TODAY } from './save-guards';
import { HST_RATE } from '../config';
import { appMembers } from './settings';

export function daysUntil(ds: string) {
  if (!ds) return null;
  const d=parseDs(ds);
  return Math.round((d.getTime()-TODAY.getTime())/86400000);
}
export function statusBadge(ds: string, completed: boolean) {
  if (completed) return '<span class="badge badge-complete">✅ Completed</span>';
  const d=daysUntil(ds);
  if (d===null) return '<span class="badge badge-ok">—</span>';
  if (d<0)  return `<span class="badge badge-overdue">Overdue ${Math.abs(d)}d</span>`;
  if (d===0) return '<span class="badge badge-due">Due today</span>';
  if (d<=14) return `<span class="badge badge-due">Due in ${d}d</span>`;
  return '<span class="badge badge-ok">On Track</span>';
}
export function progressBar(lastDs: string, nextDs: string) {
  if (!lastDs||!nextDs) return '';
  const last=parseDs(lastDs);
  const next=parseDs(nextDs);
  const total=next.getTime()-last.getTime(), elapsed=TODAY.getTime()-last.getTime();
  const pct=Math.min(100,Math.max(0,Math.round(elapsed/total*100)));
  const cls=pct>=100?'progress-overdue':pct>=75?'progress-due':'progress-ok';
  return `<div class="progress-wrap"><div class="progress-bar-bg"><div class="progress-bar-fill ${cls}" style="width:${pct}%"></div></div></div>`;
}
export function fmt(ds: string) {
  if (!ds) return '—';
  const [y,m,d]=ds.split('-'); return `${m}/${d}/${y}`;
}
export function fmtTime(t: string) {
  if (!t) return '';
  const [hh, mm] = t.split(':').map(Number);
  const ampm = hh >= 12 ? 'PM' : 'AM';
  const hr = hh % 12 || 12;
  return `${hr}:${String(mm).padStart(2,'0')} ${ampm}`;
}
export function fmtCost(v: any) {
  if (!v||isNaN(v)) return '—';
  return '$'+Number(v).toFixed(2);
}
export function costWithHst(cost: any, taxRate: any) {
  const rate = (taxRate != null ? Number(taxRate) : HST_RATE * 100) / 100;
  const c = parseFloat(cost)||0;
  if (!c) return '—';
  const total = c * (1 + rate);
  const pct = Math.round(rate * 100);
  return `<div class="td-main">${fmtCost(total)}</div><div class="td-sub">${fmtCost(c)} + ${pct}% tax</div>`;
}
let _toastTimer: ReturnType<typeof setTimeout> | null = null;
export function toast(msg: string) {
  const t=document.getElementById('toast')!;
  t.textContent=msg; t.classList.add('show');
  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer=setTimeout(()=>t.classList.remove('show'),2500);
}
export function toastAction(msg: string, label: string, fn: () => void, ms=7000){
  const t=document.getElementById('toast')!;
  t.innerHTML='';
  const span=document.createElement('span'); span.textContent=msg;
  const b=document.createElement('button'); b.type='button'; b.className='toast-action'; b.textContent=label;
  b.onclick=()=>{ if (_toastTimer) clearTimeout(_toastTimer); t.classList.remove('show'); fn(); };
  t.append(span,b); t.classList.add('show');
  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer=setTimeout(()=>t.classList.remove('show'),ms);
}
export function memberLabel(m: string){
  const s=String(m||'').toLowerCase().trim();
  return (s==='all'||s==='family')?'All/Family':String(m||'');
}

// On phones, wide data tables (5+ columns) collapse into stacked cards via CSS.
// Each cell gets its column header as data-label so the card can show
// "NEXT DUE  10/27/2026" rows instead of forcing a sideways scroll.
export function labelTable(table: HTMLTableElement){
  const heads=[...table.querySelectorAll('thead th')].map(th=>(th.textContent||'').trim());
  if(heads.length<5) return;
  table.classList.add('rt');
  table.querySelectorAll('tbody tr').forEach(tr=>{
    [...tr.children].forEach((td,i)=>{
      if(td.hasAttribute('colspan')) return;
      (td as HTMLElement).dataset.label=heads[i]||'';
      const txt=(td.textContent||'').trim();
      td.classList.toggle('rt-empty', i>0 && heads[i]!=='' && (txt==='—'||txt===''));
    });
  });
}
const _rtObserver=new MutationObserver(muts=>{
  new Set(muts.map(m=>(m.target as HTMLElement).closest('table')).filter(Boolean) as HTMLTableElement[]).forEach(labelTable);
});
document.querySelectorAll<HTMLTableElement>('.table-wrap table').forEach(t=>{
  labelTable(t);
  if(t.tBodies[0]) _rtObserver.observe(t.tBodies[0],{childList:true});
});
export function memberColor(member: string) {
  if(!member) return 'var(--gray-400)';
  const m=String(member).toLowerCase().trim();
  if(m==='all'||m==='family') return 'var(--m-all)';
  // Exact match on full name or nickname — no substring guessing, which used to
  // mis-colour any new member whose name contained an existing one
  // (e.g. "Daniel" matched "ani").
  const found=appMembers.find(x=>
    String(x.name||'').toLowerCase().trim()===m ||
    String(x.nickname||'').toLowerCase().trim()===m
  );
  if(found) return found.color;
  // Match on first name as a last resort ("ANI Thomas" -> "Ani")
  const first=m.split(/\s+/)[0];
  const byFirst=appMembers.find(x=>
    String(x.name||'').toLowerCase().trim().split(/\s+/)[0]===first ||
    String(x.nickname||'').toLowerCase().trim()===first
  );
  if(byFirst) return byFirst.color;
  return 'var(--gray-400)';
}

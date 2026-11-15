// ─── REPORTS ──────────────────────────────────────
import { esc, escJs } from './html-escape';
import { autoRecords, homeItems, events, TODAY, toDs, todayDs } from './save-guards';
import { HST_RATE } from '../config';
import { daysUntil, fmt, fmtTime, memberColor, memberLabel } from './utils';
import { CAT_ICONS } from './admin-catalog';
import { appVehicles } from './settings';
import { getVehicleForRecord } from './vehicles';
import { durLabel } from './tax';
import { fileIcon, openAttachmentLink } from './file-upload';
import { toCsv, downloadCsv } from './csv-export';

// Phase 4, F4 — each render*() below also stashes the exact rows it just
// displayed (post-filter, post-sort, with the same tax math already done)
// so the matching export*Csv() can write out precisely what's on screen,
// without recomputing it or drifting from it.
let _autoExportRows: (string | number)[][] = [];
let _homeExportRows: (string | number)[][] = [];
let _calExportRows: (string | number)[][] = [];

export function showReport(id: string, btn: HTMLElement){
  document.querySelectorAll('.report-panel').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.report-tab').forEach(b=>b.classList.remove('active'));
  document.getElementById(id)!.classList.add('active');
  if(btn) btn.classList.add('active');
  if(id==='rAuto') renderReportAuto();
  if(id==='rHome') renderReportHome();
  if(id==='rCal')  renderReportCal();
  if(id==='rSummary') renderSummary();
  if(id==='rActivity') renderReportActivity();
}

export function renderSummary(){
  const el=document.getElementById('summaryContent');
  if(!el) return;
  const autoTotal=autoRecords.reduce((s,r)=>s+(parseFloat(r.cost)||0)*(1+HST_RATE),0);
  const homeTotal=homeItems.reduce((s,h)=>s+(parseFloat(h.cost)||0)*(1+HST_RATE),0);
  const combined=autoTotal+homeTotal;
  const overAuto=autoRecords.filter(r=>{if(r.completed)return false;const d=daysUntil(r.nextDate);return d!==null&&d<0;}).length;
  const overHome=homeItems.filter(h=>{if(h.completed)return false;const d=daysUntil(h.nextDate);return d!==null&&d<0;}).length;
  const todayStr=toDs(TODAY);
  const fd=new Date(TODAY); fd.setDate(fd.getDate()+30);
  const eventsNext30=events.filter(e=>e.date>=todayStr&&e.date<=toDs(fd)).length;
  const homeByCat: Record<string, number>={};
  homeItems.forEach(h=>{const c=h.category||'Other';homeByCat[c]=(homeByCat[c]||0)+(parseFloat(h.cost)||0)*(1+HST_RATE);});
  const catRows=Object.entries(homeByCat).sort((a,b)=>b[1]-a[1]).map(([c,v])=>`<tr><td><div class="td-main">${CAT_ICONS[c]||'📦'} ${esc(c)}</div></td><td><div class="td-main">$${v.toFixed(2)}</div></td></tr>`).join('');
  const byMember: Record<string, number>={};
  events.forEach(e=>{const m=e.member||'Unknown';byMember[m]=(byMember[m]||0)+1;});
  const memberRows=Object.entries(byMember).sort((a,b)=>b[1]-a[1]).map(([m,c])=>`
    <tr><td><span style="display:inline-flex;align-items:center;gap:6px;font-weight:600">
      <span style="width:9px;height:9px;border-radius:50%;background:${memberColor(m)}"></span>${esc(memberLabel(m))}
    </span></td><td><div class="td-main">${c}</div></td></tr>`).join('');
  // Dynamic vehicle spend rows
  const vehicleRows=appVehicles.map(v=>{
    const vCost=autoRecords.filter(r=>getVehicleForRecord(r)&&(getVehicleForRecord(r) as any).id===v.id).reduce((s,r)=>s+(parseFloat(r.cost)||0)*(1+HST_RATE),0);
    return `<tr><td><div class="td-main">${esc(v.emoji||'🚗')} ${esc(v.name)}</div></td><td><div class="td-main">${vCost>0?'$'+vCost.toFixed(2):'$0'}</div></td></tr>`;
  }).join('');
  el.innerHTML=`
    <div class="report-total-row">
      <div class="report-total-card"><div class="report-total-label">Auto Spend (w/HST)</div><div class="report-total-val">${autoTotal>0?'$'+autoTotal.toFixed(2):'$0'}</div></div>
      <div class="report-total-card"><div class="report-total-label">Home Spend (w/HST)</div><div class="report-total-val">${homeTotal>0?'$'+homeTotal.toFixed(2):'$0'}</div></div>
      <div class="report-total-card highlight"><div class="report-total-label">Total Combined</div><div class="report-total-val">${combined>0?'$'+combined.toFixed(2):'$0'}</div></div>
      <div class="report-total-card"><div class="report-total-label">Overdue Items</div><div class="report-total-val" style="color:var(--red)">${overAuto+overHome}</div></div>
      <div class="report-total-card"><div class="report-total-label">Events Next 30d</div><div class="report-total-val" style="color:var(--blue)">${eventsNext30}</div></div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:18px">
      <div class="card" style="margin:0">
        <div class="card-title" style="margin-bottom:14px;display:flex;justify-content:space-between;align-items:center">🚗 Auto Spend by Vehicle<button class="print-btn" style="font-size:.72rem;padding:4px 10px" onclick="exportVehicleSpendCsv()">⬇️ CSV</button></div>
        <div class="table-wrap"><table>
          <thead><tr><th>Vehicle</th><th>Total (w/HST)</th></tr></thead>
          <tbody>${vehicleRows||'<tr><td colspan="2"><div class="empty-state" style="padding:16px"><p>No vehicles</p></div></td></tr>'}</tbody>
        </table></div>
      </div>
      <div class="card" style="margin:0">
        <div class="card-title" style="margin-bottom:14px;display:flex;justify-content:space-between;align-items:center">🏡 Home Spend by Category<button class="print-btn" style="font-size:.72rem;padding:4px 10px" onclick="exportCategorySpendCsv()">⬇️ CSV</button></div>
        <div class="table-wrap"><table>
          <thead><tr><th>Category</th><th>Total (w/HST)</th></tr></thead>
          <tbody>${catRows||'<tr><td colspan="2"><div class="empty-state" style="padding:16px"><p>No costs recorded</p></div></td></tr>'}</tbody>
        </table></div>
      </div>
      <div class="card" style="margin:0">
        <div class="card-title" style="margin-bottom:14px">📅 Events by Member</div>
        <div class="table-wrap"><table>
          <thead><tr><th>Member</th><th>Events</th></tr></thead>
          <tbody>${memberRows||'<tr><td colspan="2"><div class="empty-state" style="padding:16px"><p>No events</p></div></td></tr>'}</tbody>
        </table></div>
      </div>
    </div>`;
}

export function exportVehicleSpendCsv(){
  const rows=appVehicles.map(v=>{
    const vCost=autoRecords.filter(r=>getVehicleForRecord(r)&&(getVehicleForRecord(r) as any).id===v.id).reduce((s,r)=>s+(parseFloat(r.cost)||0)*(1+HST_RATE),0);
    return [v.name, vCost.toFixed(2)];
  });
  downloadCsv(`vehicle-spend-${todayDs()}.csv`, toCsv(['Vehicle','Total (w/HST)'], rows));
}

export function exportCategorySpendCsv(){
  const homeByCat: Record<string, number>={};
  homeItems.forEach(h=>{const c=h.category||'Other';homeByCat[c]=(homeByCat[c]||0)+(parseFloat(h.cost)||0)*(1+HST_RATE);});
  const rows=Object.entries(homeByCat).sort((a,b)=>b[1]-a[1]).map(([c,v])=>[c, v.toFixed(2)]);
  downloadCsv(`home-category-spend-${todayDs()}.csv`, toCsv(['Category','Total (w/HST)'], rows));
}

export function renderReportAuto(){
  const vFilter=(document.getElementById('rfVehicle') as HTMLSelectElement)?.value||'';
  const from=(document.getElementById('rfAutoFrom') as HTMLInputElement)?.value||'';
  const to=(document.getElementById('rfAutoTo') as HTMLInputElement)?.value||'';
  let data=[...autoRecords];
  if(vFilter) data=data.filter(r=>r.vehicle===vFilter);
  if(from) data=data.filter(r=>r.lastDate>=from);
  if(to)   data=data.filter(r=>r.lastDate<=to);
  data.sort((a,b)=>(b.lastDate||'').localeCompare(a.lastDate||''));
  const pretax=data.reduce((s,r)=>s+(r.totalOverride?r.totalOverride/(1+(r.taxRate||13)/100):parseFloat(r.cost)||0),0);
  const totalWithTax=data.reduce((s,r)=>{
    if(r.totalOverride) return s+r.totalOverride;
    const c=parseFloat(r.cost)||0; return s+c*(1+(r.taxRate||13)/100);
  },0);
  const taxTotal=totalWithTax-pretax;
  document.getElementById('autoReportTotals')!.innerHTML=`
    <div class="report-total-card"><div class="report-total-label">Records</div><div class="report-total-val">${data.length}</div></div>
    <div class="report-total-card"><div class="report-total-label">Pre-Tax</div><div class="report-total-val">$${pretax.toFixed(2)}</div></div>
    <div class="report-total-card"><div class="report-total-label">Tax</div><div class="report-total-val">$${taxTotal.toFixed(2)}</div></div>
    <div class="report-total-card highlight"><div class="report-total-label">Total (w/Tax)</div><div class="report-total-val">$${totalWithTax.toFixed(2)}</div></div>`;
  _autoExportRows=[];
  document.getElementById('autoReportBody')!.innerHTML=data.map(r=>{
    const taxPct=(r.taxRate||13);
    const c=r.totalOverride?r.totalOverride/(1+taxPct/100):parseFloat(r.cost)||0;
    const tot=r.totalOverride||c*(1+taxPct/100);
    const taxAmt=tot-c;
    _autoExportRows.push([r.vehicle||'', r.service||'', fmt(r.lastDate), c>0?c.toFixed(2):'', c>0?taxAmt.toFixed(2):'', tot>0?tot.toFixed(2):'']);
    return `<tr>
      <td><div class="td-main">${esc(r.vehicle)}</div>${r.durVal?`<div class="td-sub">${esc(durLabel(r.durVal,r.durUnit))}</div>`:''}</td>
      <td><div class="td-main">${esc(r.service)}</div>${r.mileage?`<div class="td-sub">${Number(r.mileage).toLocaleString('en-CA')} km</div>`:''}</td>
      <td>${fmt(r.lastDate)}</td>
      <td>${c>0?'$'+c.toFixed(2):'—'}</td>
      <td>${c>0?taxPct+'% · $'+taxAmt.toFixed(2):'—'}</td>
      <td><strong>${tot>0?'$'+tot.toFixed(2):'—'}</strong></td>
      <td>${r.attachmentUrl?`<a class="attachment-link" href="javascript:void(0)" onclick="openAttachmentLink('${escJs(r.attachmentUrl)}')">${fileIcon(r.attachmentUrl)} View</a>`:'—'}</td>
    </tr>`;
  }).join('')||`<tr><td colspan="7"><div class="empty-state"><div class="empty-icon">🚗</div><p>No records match filters</p></div></td></tr>`;
}

export function exportAutoReportCsv(){
  downloadCsv(`auto-service-report-${todayDs()}.csv`,
    toCsv(['Vehicle','Service','Date','Pre-Tax','Tax','Total'], _autoExportRows));
}

export function renderReportHome(){
  const cFilter=(document.getElementById('rfHomeCategory') as HTMLSelectElement)?.value||'';
  const from=(document.getElementById('rfHomeFrom') as HTMLInputElement)?.value||'';
  const to=(document.getElementById('rfHomeTo') as HTMLInputElement)?.value||'';
  let data=[...homeItems];
  if(cFilter) data=data.filter(h=>h.category===cFilter);
  if(from) data=data.filter(h=>h.lastDate>=from);
  if(to)   data=data.filter(h=>h.lastDate<=to);
  data.sort((a,b)=>(b.lastDate||'').localeCompare(a.lastDate||''));
  const hPretax=data.reduce((s,h)=>s+(h.totalOverride?h.totalOverride/(1+(h.taxRate||13)/100):parseFloat(h.cost)||0),0);
  const hTotalWithTax=data.reduce((s,h)=>{
    if(h.totalOverride) return s+h.totalOverride;
    const c=parseFloat(h.cost)||0; return s+c*(1+(h.taxRate||13)/100);
  },0);
  const hTaxTotal=hTotalWithTax-hPretax;
  document.getElementById('homeReportTotals')!.innerHTML=`
    <div class="report-total-card"><div class="report-total-label">Records</div><div class="report-total-val">${data.length}</div></div>
    <div class="report-total-card"><div class="report-total-label">Pre-Tax</div><div class="report-total-val">$${hPretax.toFixed(2)}</div></div>
    <div class="report-total-card"><div class="report-total-label">Tax</div><div class="report-total-val">$${hTaxTotal.toFixed(2)}</div></div>
    <div class="report-total-card highlight"><div class="report-total-label">Total (w/Tax)</div><div class="report-total-val">$${hTotalWithTax.toFixed(2)}</div></div>`;
  _homeExportRows=[];
  document.getElementById('homeReportBody')!.innerHTML=data.map(h=>{
    const taxPct=(h.taxRate||13);
    const c=h.totalOverride?h.totalOverride/(1+taxPct/100):parseFloat(h.cost)||0;
    const tot=h.totalOverride||c*(1+taxPct/100);
    const taxAmt=tot-c;
    _homeExportRows.push([h.item||'', h.category||'', fmt(h.lastDate), c>0?c.toFixed(2):'', c>0?taxAmt.toFixed(2):'', tot>0?tot.toFixed(2):'']);
    return `<tr>
      <td><div class="td-main">${CAT_ICONS[h.category]||'📦'} ${esc(h.item)}</div>${h.durVal?`<div class="td-sub">${esc(durLabel(h.durVal,h.durUnit))}</div>`:''}</td>
      <td><span class="type-badge type-general">${esc(h.category)}</span></td>
      <td>${fmt(h.lastDate)}</td>
      <td>${c>0?'$'+c.toFixed(2):'—'}</td>
      <td>${c>0?taxPct+'% · $'+taxAmt.toFixed(2):'—'}</td>
      <td><strong>${tot>0?'$'+tot.toFixed(2):'—'}</strong></td>
      <td>${h.attachmentUrl?`<a class="attachment-link" href="javascript:void(0)" onclick="openAttachmentLink('${escJs(h.attachmentUrl)}')">📎 View</a>`:'—'}</td>
    </tr>`;
  }).join('')||`<tr><td colspan="7"><div class="empty-state"><div class="empty-icon">🏡</div><p>No records match filters</p></div></td></tr>`;
}

export function exportHomeReportCsv(){
  downloadCsv(`home-maintenance-report-${todayDs()}.csv`,
    toCsv(['Item','Category','Date','Pre-Tax','Tax','Total'], _homeExportRows));
}

export function renderReportCal(){
  const mFilter=(document.getElementById('rfMember') as HTMLSelectElement)?.value||'';
  const tFilter=(document.getElementById('rfCalType') as HTMLSelectElement)?.value||'';
  const from=(document.getElementById('rfCalFrom') as HTMLInputElement)?.value||'';
  const to=(document.getElementById('rfCalTo') as HTMLInputElement)?.value||'';

  // Expand recurring series into their individual occurrences so a weekly event
  // that started months ago still shows up in a report for the current window.
  // Without a range the expansion is unbounded, so default to a 1-year window.
  const _rangeFrom = from || todayDs();
  const _rangeTo   = to   || (()=>{ const d=new Date(); d.setFullYear(d.getFullYear()+1); return toDs(d); })();

  let data: any[]=[];
  events.forEach(e=>{
    if (e.recurrence && e.recurrence.type) {
      // Walk the range day by day, collecting matching occurrences (capped for safety)
      const start = new Date(_rangeFrom+'T00:00:00');
      const end   = new Date(_rangeTo+'T00:00:00');
      let guard = 0;
      for(let d=new Date(start); d<=end && guard<1000; d.setDate(d.getDate()+1), guard++){
        const ds = toDs(d);
        if (isRecurringOnDay(e, ds)) {
          // Skip dates that have a standalone exception doc (edited occurrence)
          const hasException = events.some(ex => ex.recurringParentId===e.id && ex.exceptionDate===ds);
          if (!hasException) data.push({...e, date: ds, endDate: ds, _isRecurringInstance:true});
        }
      }
    } else {
      data.push(e);
    }
  });

  if(mFilter) data=data.filter(e=>(e.members&&e.members.length?e.members.includes(mFilter):e.member===mFilter));
  if(tFilter) data=data.filter(e=>e.type===tFilter);
  if(from) data=data.filter(e=>e.date>=from);
  if(to)   data=data.filter(e=>e.date<=to);
  data.sort((a,b)=>(a.date||'').localeCompare(b.date||''));
  const byType: Record<string, number>={};
  data.forEach(e=>{byType[e.type]=(byType[e.type]||0)+1;});
  document.getElementById('calReportTotals')!.innerHTML=`
    <div class="report-total-card"><div class="report-total-label">Total Events</div><div class="report-total-val">${data.length}</div></div>
    ${Object.entries(byType).map(([t,c])=>`<div class="report-total-card"><div class="report-total-label">${esc(t)}</div><div class="report-total-val">${c}</div></div>`).join('')}`;
  _calExportRows=data.map(e=>[fmt(e.date), e.time?fmtTime(e.time):'', e.title||'', e.member?memberLabel(e.member):'', e.type||'', e.location||'', e.notes||'']);
  document.getElementById('calReportBody')!.innerHTML=data.map(e=>`
    <tr>
      <td><div class="td-main">${fmt(e.date)}</div>${e.endDate&&e.endDate!==e.date?`<div class="td-sub">→ ${fmt(e.endDate)}</div>`:''}</td>
      <td>${e.time?fmtTime(e.time):'—'}</td>
      <td><div class="td-main">${esc(e.title)}</div></td>
      <td><span style="display:inline-flex;align-items:center;gap:5px;font-weight:600;font-size:.82rem">
        <span style="width:8px;height:8px;border-radius:50%;background:${memberColor(e.member)}"></span>${e.member?esc(memberLabel(e.member)):'—'}
      </span></td>
      <td><span class="type-badge type-${esc(e.type)}">${esc(e.type)}</span></td>
      <td><div style="font-size:.79rem">${e.location?esc(e.location):'—'}</div></td>
      <td><div style="font-size:.79rem;color:var(--gray-500);max-width:140px">${e.notes?esc(e.notes):'—'}</div></td>
    </tr>`).join('')||`<tr><td colspan="7"><div class="empty-state"><div class="empty-icon">📅</div><p>No events match filters</p></div></td></tr>`;
}

export function exportCalReportCsv(){
  downloadCsv(`calendar-events-report-${todayDs()}.csv`,
    toCsv(['Date','Time','Title','Member','Type','Location','Notes'], _calExportRows));
}

// ─── ACTIVITY (Phase 4, F10) ────────────────────────────────────
// "Anju marked oil change done" — assembled entirely from data every record
// already carries (updatedBy/updatedAt on the record itself, plus the {by,
// at} on each entry in auto/home's own `history` array from markDone() in
// mark-done.ts). No new collection, no new writes: this is a read-only view
// over what's already there, which is also why it needs no Firestore rule
// changes — it's exactly as readable as the records it's built from.
type ActivityEntry = { icon: string; text: string; ts: number };

// updatedAt arrives as a Firestore Timestamp once the server echo lands, but
// can briefly be the serverTimestamp() sentinel (no toMillis/toDate yet) on a
// record this tab just wrote — skip those rather than mis-sorting them to
// the epoch. history[].at is already a plain ISO string from mark-done.ts.
function activityMillis(ts: any): number {
  if (!ts) return 0;
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  if (typeof ts.toDate === 'function') return ts.toDate().getTime();
  if (ts instanceof Date) return ts.getTime();
  const n = Date.parse(ts);
  return Number.isFinite(n) ? n : 0;
}

function relTime(ms: number): string {
  if (!ms) return '';
  const diff = Date.now() - ms;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 14) return `${days}d ago`;
  return new Date(ms).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function renderReportActivity() {
  const entries: ActivityEntry[] = [];

  autoRecords.forEach(r => {
    const label = r.service || 'a service record';
    if (r.updatedBy) entries.push({ icon: '🚗', text: `${r.updatedBy} updated ${label}`, ts: activityMillis(r.updatedAt) });
    (r.history || []).forEach((h: any) => {
      if (h.by) entries.push({ icon: '✅', text: `${h.by} marked ${label} done`, ts: activityMillis(h.at) });
    });
  });

  homeItems.forEach(h => {
    const label = h.item || 'a home item';
    if (h.updatedBy) entries.push({ icon: '🏡', text: `${h.updatedBy} updated ${label}`, ts: activityMillis(h.updatedAt) });
    (h.history || []).forEach((entry: any) => {
      if (entry.by) entries.push({ icon: '✅', text: `${entry.by} marked ${label} done`, ts: activityMillis(entry.at) });
    });
  });

  events.forEach(e => {
    if (e.updatedBy) entries.push({ icon: '📅', text: `${e.updatedBy} updated ${e.title || 'an event'}`, ts: activityMillis(e.updatedAt) });
  });

  entries.sort((a, b) => b.ts - a.ts);
  const top = entries.filter(e => e.ts > 0).slice(0, 50);

  const el = document.getElementById('activityList');
  if (!el) return;
  el.innerHTML = top.length
    ? top.map(e => `
      <div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--gray-100)">
        <span style="font-size:1.1rem;flex-shrink:0">${e.icon}</span>
        <div style="flex:1;min-width:0"><div style="font-size:.86rem;color:var(--gray-700)">${esc(e.text)}</div></div>
        <div style="font-size:.74rem;color:var(--gray-400);flex-shrink:0">${relTime(e.ts)}</div>
      </div>`).join('')
    : `<div class="empty-state"><div class="empty-icon">🕐</div><p>No activity recorded yet</p></div>`;
}

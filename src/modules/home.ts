// ─── HOME ──────────────────────────────────────────
import { esc, escJs } from './html-escape';
import { homeItems } from './save-guards';
import { statusBadge, progressBar, fmt, costWithHst } from './utils';
import { CAT_ICONS } from './admin-catalog';
import { durLabel } from './tax';
import { fileIcon, openAttachmentLink } from './file-upload';
import { isRecurring, markDone } from './mark-done';

export function renderHome(){
  document.getElementById('homeBody')!.innerHTML=homeItems.map(h=>`
    <tr>
      <td><div class="td-main">${CAT_ICONS[h.category]||'📦'} ${esc(h.item)}</div>${h.notes?`<div class="td-sub">${esc(h.notes)}</div>`:''}${h.assignedTo?`<div class="td-sub">👤 ${esc(h.assignedTo)}</div>`:''}</td>
      <td><span class="type-badge type-general">${esc(h.category)}</span></td>
      <td>${esc(h.durVal?durLabel(h.durVal,h.durUnit):freqLabel(h.freq))}</td>
      <td>${fmt(h.lastDate)}</td>
      <td>${fmt(h.nextDate)}</td>
      <td>${costWithHst(h.cost, h.taxRate)}</td>
      <td>${statusBadge(h.nextDate,h.completed)}</td>
      <td class="col-progress" style="min-width:80px">${progressBar(h.lastDate,h.nextDate)}</td>
      <td><div class="btn-actions">
        ${[...(h.attachmentUrls||[]),...(h.attachmentUrl&&!(h.attachmentUrls||[]).includes(h.attachmentUrl)?[h.attachmentUrl]:[])].map((u,i)=>`<a class="btn-icon btn-attach" href="javascript:void(0)" onclick="openAttachmentLink('${escJs(u)}')" title="File ${i+1}">${fileIcon(u)}</a>`).join('')}
        <button class="btn-icon btn-done${h.completed?' is-complete':''}" onclick="toggleHomeDone('${escJs(h.id)}')" title="${h.completed?'Mark as not done':isRecurring(h)?'Mark done — schedules the next one':'Mark done'}">${h.completed?'✅':'⬜'}</button>
        <button class="btn-icon btn-edit" onclick="editHome('${escJs(h.id)}')" title="Edit">✏️</button>
        <button class="btn-icon btn-del"  onclick="delHome('${escJs(h.id)}')"  title="Delete">🗑</button>
      </div></td>
    </tr>`).join('')||`<tr><td colspan="9"><div class="empty-state"><div class="empty-icon">🏡</div><p>No home items yet</p></div></td></tr>`;
}

export function freqLabel(f: string){return({'30':'Monthly','60':'Every 2 Mo','90':'Quarterly','180':'6 Months','365':'Yearly'} as Record<string,string>)[f]||'Custom';}

export async function toggleHomeDone(id: string) {
  const h=homeItems.find(x=>x.id===id);
  if(h) await markDone('homeItems', h);
}

// ─── FILE UPLOAD ──────────────────────────────────────────────
import { storage } from './firebase-init';
import { esc } from './html-escape';
import { toast } from './utils';

const BLOCKED_EXTS = new Set([
  'exe','bat','cmd','com','msi','dmg','app','pkg','deb','rpm',
  'sh','bash','ps1','psm1','psd1','vbs','vbe','jse','wsf','wsh',
  'reg','inf','scr','pif','lnk','dll','so','dylib','bin','run',
  'gadget','hta','cpl','msc'
]);

const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB per file

export function isSafeFile(file: File) {
  const ext = (file.name.split('.').pop()||'').toLowerCase();
  return !BLOCKED_EXTS.has(ext);
}

export function isAcceptableSize(file: File) {
  return !file || file.size <= MAX_FILE_BYTES;
}
export function humanSize(b: number){
  return b > 1048576 ? (b/1048576).toFixed(1)+'MB' : Math.round(b/1024)+'KB';
}

export function fileIcon(urlOrName: string) {
  const name = (urlOrName||'').split('?')[0].split('/').pop()||'';
  const ext = (name.split('.').pop()||'').toLowerCase();
  if(['jpg','jpeg','png','gif','webp','heic','heif','bmp','svg','tiff'].includes(ext)) return '🖼️';
  if(ext==='pdf') return '📄';
  if(['doc','docx','odt','pages','rtf','txt','md'].includes(ext)) return '📝';
  if(['xls','xlsx','ods','numbers','csv','tsv'].includes(ext)) return '📊';
  if(['ppt','pptx','odp','keynote'].includes(ext)) return '📑';
  if(['mp4','mov','avi','mkv','webm','m4v'].includes(ext)) return '🎬';
  if(['mp3','m4a','wav','aac','flac','ogg'].includes(ext)) return '🎵';
  if(['zip','7z','tar','gz','rar'].includes(ext)) return '🗜️';
  return '📎';
}

export function previewFile(inputId: string, previewId: string) {
  const input = document.getElementById(inputId) as HTMLInputElement;
  const preview = document.getElementById(previewId);
  if(!preview || !input) return;
  const allFiles = Array.from(input.files||[]);
  const safe = allFiles.filter(f => isSafeFile(f) && isAcceptableSize(f));
  const blocked = allFiles.filter(f=>!isSafeFile(f));
  const tooBig  = allFiles.filter(f=>isSafeFile(f) && !isAcceptableSize(f));
  if(blocked.length>0) toast(`🚫 Blocked ${blocked.length} unsafe file(s): ${blocked.map(f=>f.name).join(', ')}`);
  if(tooBig.length>0)  toast(`🚫 Too large (max ${humanSize(MAX_FILE_BYTES)}): ${tooBig.map(f=>f.name+' — '+humanSize(f.size)).join(', ')}`);
  if(safe.length===0){preview.innerHTML='';return;}
  preview.innerHTML = safe.map(f=>`<div>${fileIcon(f.name)} ${esc(f.name)} (${f.size>1048576?(f.size/1048576).toFixed(1)+'MB':Math.round(f.size/1024)+'KB'})</div>`).join('');
}

// ─── S3: attachments identified by Storage path, not a stored open URL ─────
// uploadFile() used to resolve with task.snapshot.ref.getDownloadURL() — a
// permanent, unauthenticated link that keeps working forever (Storage
// Security Rules are only checked at the moment that URL is minted, not on
// every later request), and that link was what got written into the
// Firestore record. Now it resolves with the Storage *path* instead, so
// what's persisted can't be opened by anyone who merely has read access to
// the Firestore doc (a DB export, the browser's network tab, …) — only
// someone who can also pass Storage's rules can turn the path into a working
// link, and only at the moment they click it (see openAttachmentLink below).
export async function uploadFile(file: File, path: string): Promise<string | null> {
  if(!file) return null;
  return new Promise((resolve)=>{
    const ref = storage.ref(path);
    const task = ref.put(file);
    task.on('state_changed',
      snap=>{ const pct=Math.round(snap.bytesTransferred/snap.totalBytes*100); toast(`⏳ Uploading ${file.name}… ${pct}%`); },
      err=>{ console.warn('File upload failed:', err); toast('⚠️ Upload failed for '+file.name+' — saved without it'); resolve(null); },
      ()=>{ resolve(task.snapshot.ref.fullPath); }
    );
  });
}

export async function uploadFiles(files: File[], uid: string, prefix: string): Promise<string[]> {
  const paths: string[] = [];
  for(const f of files){
    if(!isSafeFile(f)){ toast(`🚫 Skipped unsafe file: ${f.name}`); continue; }
    if(!isAcceptableSize(f)){ toast(`🚫 Skipped ${f.name} — ${humanSize(f.size)} exceeds the ${humanSize(MAX_FILE_BYTES)} limit`); continue; }
    const path = await uploadFile(f, `receipts/${uid}/${prefix}_${Date.now()}_${f.name}`);
    if(path) paths.push(path);
  }
  return paths;
}

// Resolves a stored attachment value to an openable URL and opens it.
// Accepts either the new storage-path form, or (for records saved before
// this change) the legacy full download URL, so old attachments keep
// working unchanged.
export async function openAttachmentLink(value: string) {
  if(!value) return;
  if(/^https?:\/\//i.test(value)){ window.open(value, '_blank', 'noopener'); return; }
  try {
    const url = await storage.ref(value).getDownloadURL();
    window.open(url, '_blank', 'noopener');
  } catch(e: any) {
    toast('⚠️ Could not open attachment: ' + (e?.message || e));
  }
}

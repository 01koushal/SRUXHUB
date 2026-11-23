import { useState } from 'react';
import { ArrowDownToLine, ArrowUp, Copy, ExternalLink, FileArchive, FileText, MoreHorizontal, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { toggleFileVote } from './service';
import type { StoredFile } from '../../storage/provider';

export function FileCard({ file, onDelete }: { file: StoredFile; onDelete?: (file: StoredFile) => void }) {
  const { user, canParticipate } = useAuth();
  const navigate = useNavigate();
  const [upvotes, setUpvotes] = useState(file.upvotes ?? 0);
  const [hasVoted, setHasVoted] = useState(file.hasVoted ?? false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const isOwner = user?.id === file.uploaderId;
  async function share() {
    const url = `${window.location.origin}/files/${encodeURIComponent(file.id)}`;
    if (navigator.share) { try { await navigator.share({ title: file.name, url }); return; } catch (cause) { if ((cause as DOMException)?.name === 'AbortError') return; } }
    try { await navigator.clipboard.writeText(url); setNotice('Secure member link copied. Community access is still required.'); }
    catch { window.prompt('Copy this secure member link:', url); }
  }
  async function vote() { if (!canParticipate) return navigate('/auth'); setBusy(true); try { const next=await toggleFileVote(file.id); setHasVoted(next); setUpvotes(n=>Math.max(0,n+(next?1:-1))); } finally { setBusy(false); } }
  function open() { navigate(`/files/${encodeURIComponent(file.id)}`, { state: { from: window.location.pathname + window.location.search } }); }
  return <article className="file-card" role="link" tabIndex={0} onClick={event => { if (!(event.target as HTMLElement).closest('button,a,details')) open(); }} onKeyDown={event => { if (event.key==='Enter'||event.key===' ') { event.preventDefault(); open(); } }}>
    <div className="file-icon" aria-hidden="true">{file.mimeType.includes('zip')?<FileArchive size={20}/>:<FileText size={20}/>}</div>
    <div className="file-main"><h3 title={file.name}>{file.name}</h3><p>{file.mimeType} · {formatSize(file.size)} · {file.communityName||'Community'} · {formatDate(file.uploadedAt)}</p><small>Shared by {file.uploaderName||'SRU student'}{file.uploaderUsername?` · @${file.uploaderUsername}`:''}</small>{notice&&<div className="file-notice" role="status">{notice}</div>}</div>
    <div className="file-actions"><button className={`vote-file ${hasVoted?'voted':''}`} type="button" onClick={event=>{event.stopPropagation();void vote()}} disabled={busy} aria-pressed={hasVoted} aria-label={`${upvotes} upvotes`}><ArrowUp size={17}/><span>{upvotes}</span></button><details className="file-menu"><summary className="viewer-icon" aria-label={`Actions for ${file.name}`}><MoreHorizontal size={18}/></summary><div className="file-menu-pop"><button type="button" onClick={event=>{event.stopPropagation();void share()}}><Copy size={15}/>Share link</button><button type="button" onClick={event=>{event.stopPropagation();open()}}><ArrowDownToLine size={15}/>File details & download</button><a href={`/files/${encodeURIComponent(file.id)}`} target="_blank" rel="noreferrer"><ExternalLink size={15}/>Open details in new tab</a>{isOwner&&onDelete&&<button type="button" onClick={()=>onDelete(file)}><Trash2 size={15}/>Delete file</button>}</div></details></div>
  </article>;
}
export function formatSize(size:number) { if(size<1024*1024)return `${Math.max(1,Math.round(size/1024))} KB`;return `${(size/(1024*1024)).toFixed(1)} MB`; }
function formatDate(value?:string) { if(!value)return 'Date unavailable';return new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric',year:'numeric'}).format(new Date(value)); }

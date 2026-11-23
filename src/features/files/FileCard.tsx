import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowUp, Copy, FileArchive, FileText, MoreHorizontal, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { toggleFileVote } from './service';
import { storageProvider, type StoredFile } from '../../storage/provider';

export function FileCard({ file, onDelete, canDelete: mayDelete }: { file: StoredFile; onDelete?: (file: StoredFile) => void; canDelete?: boolean }) {
  const { user, session, canParticipate } = useAuth();
  const navigate = useNavigate();
  const [upvotes, setUpvotes] = useState(file.upvotes ?? 0);
  const [hasVoted, setHasVoted] = useState(file.hasVoted ?? false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [action, setAction] = useState('');
  const [removed, setRemoved] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuAbove, setMenuAbove] = useState(false);
  const actionRef = useRef('');
  const menuRef = useRef<HTMLDetailsElement>(null);
  const menuButtonRef = useRef<HTMLElement>(null);
  const isOwner = user?.id === file.uploaderId;
  const canDelete = mayDelete ?? isOwner;

  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (actionRef.current !== 'open') return;
      // pageshow also runs for normal loads; a stale open only survives when a page is restored.
      if (event.persisted) {
        actionRef.current = '';
        setAction('');
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      if (menuRef.current?.open && !menuRef.current.contains(event.target as Node)) menuRef.current.open = false;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !menuRef.current?.open) return;
      menuRef.current.open = false;
      menuButtonRef.current?.focus();
    };
    const onOtherMenu = (event: Event) => {
      const openFileId = (event as CustomEvent<string>).detail;
      if (openFileId !== `file:${file.id}` && menuRef.current) menuRef.current.open = false;
    };
    window.addEventListener('pageshow', onPageShow);
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('sruxhub:overlay-menu-open', onOtherMenu);
    return () => {
      window.removeEventListener('pageshow', onPageShow);
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('sruxhub:overlay-menu-open', onOtherMenu);
    };
  }, [file.id]);

  function startAction(next: string) { actionRef.current = next; setAction(next); }
  function finishAction() { actionRef.current = ''; setAction(''); }
  async function share() {
    const url = `${window.location.origin}/files/${encodeURIComponent(file.id)}`;
    try { await navigator.clipboard.writeText(url); setNotice('Secure SRUXHUB link copied.'); }
    catch { window.prompt('Copy this secure member link:', url); }
  }
  async function vote() { if (!canParticipate) return navigate('/auth'); setBusy(true); try { const next=await toggleFileVote(file.id); setHasVoted(next); setUpvotes(n=>Math.max(0,n+(next?1:-1))); } finally { setBusy(false); } }
  async function open() {
    if (actionRef.current) return;
    if (!canParticipate || !session) return navigate(`/auth?next=${encodeURIComponent(`/files/${encodeURIComponent(file.id)}`)}`);
    startAction('open'); setNotice('');
    try { const response=await fetch(`/api/files/${encodeURIComponent(file.id)}`,{method:'POST',headers:{Authorization:`Bearer ${session.access_token}`}}); if(!response.ok) throw new Error(await fileError(response)); window.location.assign(`/api/files/${encodeURIComponent(file.id)}?inline=1`); }
    catch(cause){setNotice(cause instanceof Error?cause.message:'Could not open this file.');finishAction();}
  }
  async function download() {
    if (actionRef.current) return;
    if (!session || !canParticipate) return navigate('/auth');
    startAction('download'); setNotice('Preparing download…');
    try { const blob=await storageProvider.download(file.id,session.access_token); const url=URL.createObjectURL(blob); const link=document.createElement('a'); link.href=url; link.download=file.name; link.click(); window.setTimeout(()=>URL.revokeObjectURL(url),1000); setNotice('Download started.'); }
    catch(cause){setNotice(cause instanceof Error?cause.message:'Download failed.');}
    finally{finishAction();}
  }
  async function remove() {
    if (actionRef.current) return;
    if(!session||!window.confirm(`Delete “${file.name}”? This cannot be undone.`)) return;
    startAction('delete');setNotice('Deleting file…');
    try{await storageProvider.delete(file.id,session.access_token);setRemoved(true);onDelete?.(file);}
    catch(cause){setNotice(cause instanceof Error?cause.message:'Delete failed.');}
    finally{finishAction();}
  }
  if (removed) return null;
  return <article className="file-card" role="link" tabIndex={0} onClick={event => { if (!(event.target as HTMLElement).closest('button,a,details')) void open(); }} onKeyDown={event => { if (!(event.target as HTMLElement).closest('button,a,details') && (event.key==='Enter'||event.key===' ')) { event.preventDefault(); void open(); } }}>
    <div className="file-icon" aria-hidden="true">{file.mimeType.includes('zip')?<FileArchive size={20}/>:<FileText size={20}/>}</div>
    <div className="file-main"><h3 title={file.name}>{file.name}</h3><p>{file.mimeType} · {formatSize(file.size)} · {formatDate(file.uploadedAt)}{file.communityName?` · ${file.communityName}`:''}</p><small>Shared by {file.uploaderName||'SRU student'}{file.uploaderUsername?` · @${file.uploaderUsername}`:''}</small>{notice&&<div className="file-notice" role="status">{notice}</div>}</div>
    <div className="file-actions"><button className={`vote-file ${hasVoted?'voted':''}`} type="button" onClick={event=>{event.stopPropagation();void vote()}} disabled={busy} aria-pressed={hasVoted} aria-label={`${upvotes} upvotes`}><ArrowUp size={17}/><span>{upvotes}</span></button><details className={`file-menu ${menuAbove?'opens-up':''}`} ref={menuRef} onToggle={event=>{setMenuOpen(event.currentTarget.open);if(event.currentTarget.open){const popup=event.currentTarget.querySelector('.file-menu-pop')?.getBoundingClientRect();setMenuAbove(Boolean(popup&&popup.bottom>window.innerHeight));document.dispatchEvent(new CustomEvent('sruxhub:overlay-menu-open',{detail:`file:${file.id}`}));}}}><summary className="viewer-icon" ref={menuButtonRef as React.RefObject<HTMLElement>} aria-label={`File actions for ${file.name}`} aria-haspopup="menu" aria-expanded={menuOpen} onClick={event=>event.stopPropagation()}><MoreHorizontal size={18}/></summary><div className="file-menu-pop" role="menu"><button type="button" role="menuitem" disabled={Boolean(action)} onClick={event=>{event.stopPropagation();menuRef.current!.open=false;void download()}}><ArrowDownToLine size={15}/>{action==='download'?'Preparing…':'Download'}</button><button type="button" role="menuitem" onClick={event=>{event.stopPropagation();menuRef.current!.open=false;void share()}}><Copy size={15}/>Share link</button>{canDelete&&<button type="button" role="menuitem" disabled={Boolean(action)} onClick={event=>{event.stopPropagation();menuRef.current!.open=false;void remove()}}><Trash2 size={15}/>{action==='delete'?'Deleting…':'Delete'}</button>}</div></details></div>
  </article>;
}
async function fileError(response:Response){try{return ((await response.json()) as {error?:string}).error||`File unavailable (HTTP ${response.status}).`;}catch{return `File unavailable (HTTP ${response.status}).`;}}
export function formatSize(size:number) { if(size<1024*1024)return `${Math.max(1,Math.round(size/1024))} KB`;return `${(size/(1024*1024)).toFixed(1)} MB`; }
function formatDate(value?:string) { if(!value)return 'Date unavailable';return new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric',year:'numeric'}).format(new Date(value)); }

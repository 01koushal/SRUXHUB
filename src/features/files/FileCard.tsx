import { useEffect, useState } from 'react';
import { ArrowDownToLine, ArrowUp, Copy, ExternalLink, Eye, FileArchive, FileText, Trash2, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { toggleFileVote } from './service';
import { storageProvider, type StoredFile } from '../../storage/provider';

export const QUICK_PREVIEW_MAX_BYTES = Number(import.meta.env.VITE_FILE_PREVIEW_MAX_BYTES) || 10 * 1024 * 1024;

export function FileCard({ file, onDelete }: { file: StoredFile; onDelete?: (file: StoredFile) => void }) {
  const { user, session, canParticipate } = useAuth();
  const navigate = useNavigate();
  const [upvotes, setUpvotes] = useState(file.upvotes ?? 0);
  const [hasVoted, setHasVoted] = useState(file.hasVoted ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');
  const previewable = file.mimeType === 'application/pdf' || ['image/jpeg','image/png','image/gif','image/webp'].includes(file.mimeType);
  const isOwner = user?.id === file.uploaderId;

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  async function download(preview = false) {
    if (!canParticipate || !session) { navigate('/auth'); return; }
    setError(''); setNotice('');
    if (!preview) { window.open(`/files/${encodeURIComponent(file.id)}?download=1`, '_blank', 'noopener'); return; }
    if (preview && file.size > QUICK_PREVIEW_MAX_BYTES) { setNotice('This file is too large for quick preview. Use Open in New Tab instead.'); return; }
    if (preview && !previewable) return;
    setBusy(true);
    try {
      const blob = await storageProvider.download(file.id, session.access_token);
      const url = URL.createObjectURL(blob);
      setPreviewUrl(url);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'File request failed.'); }
    finally { setBusy(false); }
  }

  async function share() {
    const url = `${window.location.origin}/files/${encodeURIComponent(file.id)}`;
    try { await navigator.clipboard.writeText(url); setNotice('Secure member link copied. Community access is still required.'); }
    catch { window.prompt('Copy this secure member link:', url); }
  }

  async function vote() {
    if (!canParticipate) { navigate('/auth'); return; }
    setBusy(true); setError('');
    try { const next = await toggleFileVote(file.id); setHasVoted(next); setUpvotes(count => Math.max(0, count + (next ? 1 : -1))); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not update your vote.'); }
    finally { setBusy(false); }
  }

  return <>
    <article className="file-card">
      <div className="file-icon" aria-hidden="true">{file.mimeType.includes('zip') ? <FileArchive size={20}/> : <FileText size={20}/>}</div>
      <div className="file-main"><h3 title={file.name}>{file.name}</h3><p>{file.mimeType} · {formatSize(file.size)} · {file.communityName || 'Community'} · {formatDate(file.uploadedAt)}</p><small>Shared by {file.uploaderName || 'SRU student'}{file.uploaderUsername ? ` · @${file.uploaderUsername}` : ''}</small>{notice && <div className="file-notice" role="status">{notice}</div>}{error && <div className="file-error" role="alert">{error}</div>}</div>
      <div className="file-actions">
        <button className={`vote-file ${hasVoted ? 'voted' : ''}`} type="button" onClick={vote} disabled={busy} aria-pressed={hasVoted} aria-label={`${upvotes} upvotes`}><ArrowUp size={17}/><span>{upvotes}</span></button>
        <a className="primary icon-action" href={`/files/${encodeURIComponent(file.id)}`} target="_blank" rel="noreferrer"><ExternalLink size={16}/><span>Open in New Tab</span></a>
        {previewable && <button className="secondary icon-action" type="button" onClick={() => void download(true)} disabled={busy} aria-label={`Quick preview ${file.name}`}><Eye size={17}/><span>Quick Preview</span></button>}
        <button className="secondary icon-action" type="button" onClick={() => void download()} disabled={busy} aria-label={`Download ${file.name}`}><ArrowDownToLine size={17}/><span>Download</span></button>
        <button className="secondary icon-action" type="button" onClick={() => void share()} aria-label={`Share ${file.name}`}><Copy size={16}/><span>Share Link</span></button>
        {isOwner && onDelete && <button className="quiet-danger" type="button" onClick={() => onDelete(file)} aria-label={`Delete ${file.name}`}><Trash2 size={17}/></button>}
      </div>
    </article>
    {previewUrl && <div className="preview-backdrop" role="presentation" onClick={() => { URL.revokeObjectURL(previewUrl); setPreviewUrl(''); }}><section className="preview-dialog" role="dialog" aria-modal="true" aria-label={`Preview ${file.name}`} onClick={event => event.stopPropagation()}><header><strong>{file.name}</strong><button className="icon-btn" onClick={() => { URL.revokeObjectURL(previewUrl); setPreviewUrl(''); }} aria-label="Close preview"><X/></button></header>{file.mimeType.startsWith('image/') ? <img src={previewUrl} alt={file.name}/> : <iframe src={previewUrl} title={`Preview ${file.name}`}/>}</section></div>}
  </>;
}

export function formatSize(size: number) { if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`; return `${(size / (1024 * 1024)).toFixed(1)} MB`; }
function formatDate(value?: string) { if (!value) return 'Date unavailable'; return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value)); }

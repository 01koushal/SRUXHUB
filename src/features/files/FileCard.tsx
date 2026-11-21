import { useState } from 'react';
import { ArrowDownToLine, ArrowUp, Eye, FileArchive, FileText, Trash2, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { toggleFileVote } from './service';
import { storageProvider, type StoredFile } from '../../storage/provider';

export function FileCard({ file, onDelete }: { file: StoredFile; onDelete?: (file: StoredFile) => void }) {
  const { user, session, canParticipate } = useAuth();
  const navigate = useNavigate();
  const [upvotes, setUpvotes] = useState(file.upvotes ?? 0);
  const [hasVoted, setHasVoted] = useState(file.hasVoted ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');
  const previewable = file.mimeType === 'application/pdf' || file.mimeType.startsWith('image/');
  const isOwner = user?.id === file.uploaderId;

  async function download(preview = false) {
    if (!canParticipate || !session) {
      navigate('/auth');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const blob = await storageProvider.download(file.id, session.access_token);
      if (preview && previewable) {
        setPreviewUrl(URL.createObjectURL(blob));
      } else {
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = file.name;
        anchor.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'File request failed.');
    } finally {
      setBusy(false);
    }
  }

  async function vote() {
    if (!canParticipate) {
      navigate('/auth');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const next = await toggleFileVote(file.id);
      setHasVoted(next);
      setUpvotes(count => Math.max(0, count + (next ? 1 : -1)));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update your vote.');
    } finally {
      setBusy(false);
    }
  }

  return <>
    <article className="file-card">
      <div className="file-icon" aria-hidden="true">
        {file.mimeType.includes('zip') ? <FileArchive size={20}/> : <FileText size={20}/>}
      </div>
      <div className="file-main">
        <h3 title={file.name}>{file.name}</h3>
        <p>{file.communityName || 'Community'} · {formatSize(file.size)} · {formatDate(file.uploadedAt)}</p>
        <small>Shared by {file.uploaderName || 'SRU student'}{file.uploaderUsername ? ` · @${file.uploaderUsername}` : ''}</small>
        {error && <div className="file-error" role="alert">{error}</div>}
      </div>
      <div className="file-actions">
        <button className={`vote-file ${hasVoted ? 'voted' : ''}`} type="button" onClick={vote} disabled={busy} aria-pressed={hasVoted} aria-label={`${upvotes} upvotes`}>
          <ArrowUp size={17}/><span>{upvotes}</span>
        </button>
        {previewable && <button className="secondary icon-action" type="button" onClick={() => download(true)} disabled={busy} aria-label={`Preview ${file.name}`}><Eye size={17}/><span>Preview</span></button>}
        <button className="secondary icon-action" type="button" onClick={() => download()} disabled={busy} aria-label={`Download ${file.name}`}><ArrowDownToLine size={17}/><span>Download</span></button>
        {isOwner && onDelete && <button className="quiet-danger" type="button" onClick={() => {
          if (window.confirm(`Delete “${file.name}” from this community? This cannot be undone.`)) onDelete(file);
        }} aria-label={`Delete ${file.name}`}><Trash2 size={17}/></button>}
      </div>
    </article>
    {previewUrl && <div className="preview-backdrop" role="presentation" onClick={() => { URL.revokeObjectURL(previewUrl); setPreviewUrl(''); }}>
      <section className="preview-dialog" role="dialog" aria-modal="true" aria-label={`Preview ${file.name}`} onClick={event => event.stopPropagation()}>
        <header><strong>{file.name}</strong><button className="icon-btn" onClick={() => { URL.revokeObjectURL(previewUrl); setPreviewUrl(''); }} aria-label="Close preview"><X/></button></header>
        {file.mimeType.startsWith('image/') ? <img src={previewUrl} alt={file.name}/> : <iframe src={previewUrl} title={`Preview ${file.name}`}/>}
      </section>
    </div>}
  </>;
}

export function formatSize(size: number) {
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value?: string) {
  if (!value) return 'Date unavailable';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value));
}

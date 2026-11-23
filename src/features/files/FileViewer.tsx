import { useState } from 'react';
import { ArrowDownToLine, ArrowLeft, ExternalLink, FileText, Share2, Trash2 } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { storageProvider, type StoredFile } from '../../storage/provider';
import { formatSize } from './FileCard';

type Metadata = StoredFile & { status?: string; canDelete?: boolean };
export function FileViewer({ id, metadata, error, onDeleted }: { id: string; metadata: Metadata | null; error: string; onDeleted: () => void }) {
  const { session } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const returnTo = (location.state as { from?: string } | null)?.from || '/files';
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState('');
  const [actionError, setActionError] = useState('');
  const [failedAction, setFailedAction] = useState<'download' | 'open'>('open');
  const path = `/api/files/${encodeURIComponent(id)}`;
  const extension = metadata?.name.includes('.') ? metadata.name.split('.').pop()?.toUpperCase() : 'No extension';
  const fileType = extension && extension !== 'No extension' ? `${metadata?.mimeType} · ${extension}` : metadata?.mimeType;

  async function openInNewTab() {
    if (!session) return;
    const tab = window.open('about:blank', '_blank');
    setBusy('open'); setActionError('');
    try {
      const access = await fetch(path, { method: 'POST', headers: { Authorization: `Bearer ${session.access_token}` } });
      if (!access.ok) throw new Error(await apiError(access));
      if (tab) { tab.opener = null; tab.location.href = path; }
      else window.location.assign(path);
    } catch (cause) { tab?.close(); setFailedAction('open'); setActionError(cause instanceof Error ? cause.message : 'Could not open this file.'); }
    finally { setBusy(''); }
  }

  async function download() {
    if (!session) return;
    setBusy('download'); setActionError('');
    try {
      const blob = await storageProvider.download(id, session.access_token);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a'); link.href = url; link.download = metadata?.name || 'download'; link.click();
      URL.revokeObjectURL(url);
    } catch (cause) { setFailedAction('download'); setActionError(cause instanceof Error ? cause.message : 'Download failed.'); }
    finally { setBusy(''); }
  }

  async function share() {
    const url = `${window.location.origin}/files/${encodeURIComponent(id)}`;
    try { await navigator.clipboard.writeText(url); setCopied(true); window.setTimeout(() => setCopied(false), 2200); }
    catch { window.prompt('Copy this secure SRUXHUB link:', url); }
  }

  async function remove() {
    if (!session || !metadata || !window.confirm(`Delete “${metadata.name}”? This cannot be undone.`)) return;
    setBusy('delete'); setActionError('');
    try { await storageProvider.delete(id, session.access_token); onDeleted(); navigate('/files', { replace: true }); }
    catch (cause) { setActionError(cause instanceof Error ? cause.message : 'Delete failed.'); }
    finally { setBusy(''); }
  }

  return <section className="file-viewer" aria-label="File details">
    <header className="file-viewer-header"><button className="viewer-icon" onClick={() => navigate(returnTo)} aria-label="Back to files"><ArrowLeft/></button><div className="viewer-title"><strong>{metadata?.name || 'File details'}</strong><small>{metadata ? `${fileType} · ${formatSize(metadata.size)}` : 'Secure file information'}</small></div></header>
    <div className="file-details">
      {!metadata && !error && <div className="viewer-state" role="status"><span className="viewer-spinner"/><strong>Loading file details…</strong></div>}
      {error && <div className="viewer-state" role="alert"><FileText/><strong>File access unavailable</strong><p>{error}</p><button className="secondary" onClick={() => navigate('/files')}>Return to files</button></div>}
      {metadata && <>
        <div className="file-detail-heading"><span className="file-icon"><FileText/></span><div><div className="eyebrow">FILE DETAILS</div><h1>{metadata.name}</h1><p>{fileType} · {formatSize(metadata.size)}</p></div></div>
        <dl className="file-detail-grid">
          <div><dt>Uploader</dt><dd>{metadata.uploaderName || 'SRU student'}{metadata.uploaderUsername ? ` · @${metadata.uploaderUsername}` : ''}</dd></div>
          <div><dt>Uploaded</dt><dd>{metadata.uploadedAt ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(metadata.uploadedAt)) : 'Unavailable'}</dd></div>
          <div><dt>Community</dt><dd>{metadata.communityName || 'Community'}</dd></div>
          {metadata.status && <div><dt>Status</dt><dd>{metadata.status}</dd></div>}
        </dl>
        <div className="file-detail-actions">
          <button className="primary" onClick={() => void openInNewTab()} disabled={Boolean(busy)}><ExternalLink size={16}/>{busy === 'open' ? 'Preparing…' : 'Open in New Tab'}</button>
          <button className="secondary" onClick={() => void download()} disabled={Boolean(busy)}><ArrowDownToLine size={16}/>{busy === 'download' ? 'Preparing download…' : 'Download'}</button>
          <button className="secondary" onClick={() => void share()}><Share2 size={16}/>{copied ? 'Link copied' : 'Share link'}</button>
          {metadata.canDelete && <button className="quiet-danger file-delete-action" onClick={() => void remove()} disabled={Boolean(busy)}><Trash2 size={16}/>{busy === 'delete' ? 'Deleting…' : 'Delete'}</button>}
        </div>
        {actionError && <p className="form-message" role="alert">{actionError} <button className="text-button" onClick={() => void (failedAction === 'download' ? download() : openInNewTab())}>Retry</button></p>}
      </>}
    </div>
  </section>;
}

async function apiError(response: Response) { try { return ((await response.json()) as { error?: string }).error || `Request failed (HTTP ${response.status}).`; } catch { return `Request failed (HTTP ${response.status}).`; } }

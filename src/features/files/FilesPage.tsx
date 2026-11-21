import { useCallback, useEffect, useRef, useState } from 'react';
import { FileText, Search } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import type { Community } from '../communities/service';
import { FILE_PAGE_SIZE, findExactFilename, listFiles } from './service';
import { FileCard, formatSize } from './FileCard';
import { MAX_UPLOAD_BYTES, storageProvider, type StoredFile } from '../../storage/provider';
import { useParams } from 'react-router-dom';

type PendingDuplicate = { file: File; existing: StoredFile; contentDuplicate: boolean; remaining: File[] };

export function FileOpenPage() {
  const { id = '' } = useParams();
  const { session, canParticipate, loading, profileLoading } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  useEffect(() => {
    if (loading || profileLoading) return;
    const target = `${window.location.pathname}${window.location.search}`;
    if (!canParticipate || !session) {
      sessionStorage.setItem('sruxhub-return-to', target);
      navigate(`/auth?next=${encodeURIComponent(target)}`, { replace: true });
      return;
    }
    let active = true;
    void fetch(`/api/files/${encodeURIComponent(id)}`, { method: 'POST', headers: { Authorization: `Bearer ${session.access_token}` } })
      .then(async response => {
        if (!response.ok) throw new Error(await fileApiError(response));
        const download = new URLSearchParams(window.location.search).get('download') === '1';
        const inline = new URLSearchParams(window.location.search).get('inline') !== '0';
        window.location.replace(`/api/files/${encodeURIComponent(id)}?${download ? 'download=1' : inline ? 'inline=1' : 'download=1'}`);
      }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : 'This file is unavailable.'); });
    return () => { active = false; };
  }, [id, session, canParticipate, loading, profileLoading, navigate]);
  return <div className="empty" role={error ? 'alert' : 'status'}><FileText/><h2>{error ? 'File access unavailable' : 'Preparing secure file access'}</h2><p>{error || 'Checking your SRUXHUB account and community membership…'}</p>{error && <Link to="/files">Return to files</Link>}</div>;
}

async function fileApiError(response: Response) { try { const body = await response.json() as { error?: string }; return body.error || `File unavailable (HTTP ${response.status}).`; } catch { return `File unavailable (HTTP ${response.status}).`; } }

export default function FilesPage({ communities }: { communities: Community[] }) {
  const { session, user, profile, canParticipate } = useAuth();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [files, setFiles] = useState<StoredFile[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [community, setCommunity] = useState('');
  const [sort, setSort] = useState<'newest' | 'upvotes'>('newest');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentName, setCurrentName] = useState('');
  const [currentSize, setCurrentSize] = useState(0);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [error, setError] = useState('');
  const [pendingDuplicate, setPendingDuplicate] = useState<PendingDuplicate | null>(null);
  const [failedFile, setFailedFile] = useState<File | null>(null);

  const load = useCallback(async (offset = 0) => {
    if (!canParticipate) {
      setFiles([]);
      setHasMore(false);
      return;
    }
    if (offset > 0) setLoadingMore(true);
    try {
      const rows = await listFiles(community || undefined, sort, offset);
      setFiles(current => offset === 0 ? rows : [...current, ...rows]);
      setHasMore(rows.length === FILE_PAGE_SIZE);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load shared files.');
    } finally {
      if (offset > 0) setLoadingMore(false);
    }
  }, [canParticipate, community, sort]);

  useEffect(() => { void load(); }, [load]);

  async function uploadFiles(event?: { preventDefault(): void }, action?: 'filename' | 'remaining' | 'retry') {
    event?.preventDefault();
    const duplicate = action === 'filename' || action === 'remaining' ? pendingDuplicate : null;
    const selectedFiles = action === 'filename' && duplicate
      ? [duplicate.file, ...duplicate.remaining]
      : action === 'remaining' && duplicate
        ? duplicate.remaining
        : action === 'retry' && failedFile
          ? [failedFile]
          : inputRef.current?.files ? Array.from(inputRef.current.files) : [];
    if (!selectedFiles.length) return;
    if (!canParticipate || !session) {
      navigate('/auth');
      return;
    }
    if (!community) {
      setError('Choose a community first.');
      return;
    }

    setBusy(true);
    setError('');
    setPendingDuplicate(null);
    setFailedFile(null);
    let pausedForDuplicate = false;
    for (let index = 0; index < selectedFiles.length; index++) {
      const file = selectedFiles[index];
      if (file.size > MAX_UPLOAD_BYTES) {
        setError(`${file.name} is larger than the 300 MB limit.`);
        setFailedFile(file);
        break;
      }
      setCurrentName(file.name);
      setCurrentSize(file.size);
      setProgress(0);
      try {
        if (!(action === 'filename' && index === 0)) {
          const existing = await findExactFilename(community, file.name);
          if (existing) {
            setPendingDuplicate({ file, existing, contentDuplicate: false, remaining: selectedFiles.slice(index + 1) });
            pausedForDuplicate = true;
            setBusy(false);
            setCurrentName('');
            return;
          }
        }
        abortRef.current = new AbortController();
        const uploaded = await storageProvider.upload(
          file,
          community,
          session.access_token,
          setProgress,
          abortRef.current.signal,
        );
        setFiles(current => [{
          ...uploaded,
          communityId: community,
          communityName: communities.find(item => item.id === community)?.name,
          uploaderId: user?.id,
          uploaderName: profile?.display_name || 'You',
          uploaderUsername: profile?.username,
          uploadedAt: new Date().toISOString(),
          upvotes: 0,
          hasVoted: false,
        }, ...current]);
        abortRef.current = null;
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : 'Upload failed.';
        const duplicate = (cause as { existingFile?: StoredFile })?.existingFile;
        if (duplicate) {
          setError('This exact file has already been shared in this community.');
          setPendingDuplicate({ file, existing: duplicate, contentDuplicate: true, remaining: selectedFiles.slice(index + 1) });
          pausedForDuplicate = true;
        } else {
          setError(message);
          if (!message.includes('cancelled')) setFailedFile(file);
        }
        abortRef.current = null;
        break;
      }
    }
    if (inputRef.current && !pausedForDuplicate) inputRef.current.value = '';
    if (!pausedForDuplicate) setSelectedFiles([]);
    setBusy(false);
    setCurrentName('');
    await load(0);
  }

  function cancelUpload() {
    abortRef.current?.abort();
  }

  async function removeFile(file: StoredFile) {
    if (!session) return navigate('/auth');
    if (!window.confirm(`Delete “${file.name}” from this community? This cannot be undone.`)) return;
    try {
      await storageProvider.delete(file.id, session.access_token);
      setFiles(current => current.filter(item => item.id !== file.id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Delete failed.');
    }
  }

  const visibleFiles = files.filter(file => file.name.toLowerCase().includes(search.trim().toLowerCase()));

  return <section className="files-page">
    <header className="page-heading">
      <div><div className="eyebrow">CAMPUS LIBRARY</div><h1>Files & resources</h1><p>Study notes and useful resources shared by your communities.</p></div>
    </header>

    {canParticipate ? <form className="upload-panel" onSubmit={event => void uploadFiles(event)}>
      <div className="upload-panel-head"><span className="upload-symbol"><FileText size={20}/></span><div><strong>Share a resource</strong><p>Files are available to members of the selected community.</p></div></div>
      <div className="upload-fields">
        <label>Community<select required value={community} onChange={event => setCommunity(event.target.value)}>
          <option value="">Choose a community</option>
          {communities.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select></label>
        <label className="file-picker">Choose files<input ref={inputRef} type="file" name="files" required multiple onChange={event => setSelectedFiles(Array.from(event.target.files || []))}
          accept=".jpg,.jpeg,.png,.webp,.gif,.pdf,.ppt,.pptx,.doc,.docx,.xls,.xlsx,.zip,.txt,.md,.csv"/>
          <small>Images, PDF, PowerPoint, Word or ZIP · 300 MB max per file</small></label>
      </div>
      {selectedFiles.length > 0 && !busy && <ul className="selected-upload-files" aria-label="Selected files">{selectedFiles.map((file, index) => <li key={`${file.name}-${file.size}-${index}`}><span>{file.name}</span><small>{formatSize(file.size)}</small></li>)}</ul>}
      {busy && <div className="upload-progress" aria-live="polite">
        <div className="progress-caption"><span>Uploading {currentName} · {formatSize(currentSize)} · {progress}%</span><button type="button" className="text-button" onClick={cancelUpload}>Cancel</button></div>
        <progress max="100" value={progress}>{progress}%</progress>
      </div>}
      {pendingDuplicate && <div className={pendingDuplicate.contentDuplicate ? 'duplicate-warning content-duplicate' : 'duplicate-warning'} role="alert">
        <div><strong>{pendingDuplicate.contentDuplicate ? 'This exact file has already been shared in this community.' : `A file named “${pendingDuplicate.file.name}” is already in this community.`}</strong><p>{pendingDuplicate.contentDuplicate ? 'The existing file is available below.' : 'Names match exactly, including letter case. Different content is allowed; an identical file will be blocked.'}</p></div>
        <FileCard file={pendingDuplicate.existing}/>
        {!pendingDuplicate.contentDuplicate ? <button type="button" className="secondary" onClick={event => void uploadFiles(event, 'filename')}>Upload this different file</button> : pendingDuplicate.remaining.length > 0 && <button type="button" className="secondary" onClick={event => void uploadFiles(event, 'remaining')}>Continue with remaining files</button>}
      </div>}
      {error && <p className="form-message" role="alert">{error}</p>}
      <div className="upload-panel-footer">
        <span>Maximum file size: 300 MiB</span>
        <div className="button-row">
          {failedFile && <button type="button" className="secondary" onClick={() => void uploadFiles(undefined, 'retry')}>Retry {failedFile.name}</button>}
          <button className="primary" disabled={busy || !community}>{busy ? 'Uploading…' : 'Upload files'}</button>
        </div>
      </div>
    </form> : <div className="notice files-signin">Sign in with your SRU Google account and join a community to share files. <Link to="/auth">Sign in</Link></div>}

    <div className="library-toolbar">
      <div className="library-search"><Search size={17}/><input aria-label="Search files" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search shared files"/></div>
      <label className="sort-select"><span>Sort</span><select value={sort} onChange={event => setSort(event.target.value as 'newest' | 'upvotes')}><option value="newest">Newest</option><option value="upvotes">Most upvoted</option></select></label>
    </div>
    {error && !canParticipate && <div className="empty"><FileText/><h2>Community files</h2><p>Sign in and join a community to browse its shared files.</p><Link className="primary" to="/auth">Sign in with Google</Link></div>}
    <div className="file-list">{visibleFiles.map(file => <FileCard key={file.id} file={file} onDelete={removeFile}/>)}</div>
    {canParticipate && hasMore && <button className="secondary load-more-files" disabled={loadingMore} onClick={() => void load(files.length)}>{loadingMore ? 'Loading…' : 'Load more files'}</button>}
    {canParticipate && !visibleFiles.length && <div className="empty"><FileText/><h2>{search ? 'No matching files' : 'Your library is waiting'}</h2><p>{search ? 'Try a different search.' : 'Share a helpful file with your community.'}</p></div>}
  </section>;
}

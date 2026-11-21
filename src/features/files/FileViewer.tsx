import { useEffect, useState } from 'react';
import { ArrowDownToLine, ArrowLeft, Copy, ExternalLink, FileText, Share2, ZoomIn, ZoomOut } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';

type Metadata = { name: string; mimeType: string; size: number };
export function FileViewer({ id, metadata, error }: { id: string; metadata: Metadata | null; error: string }) {
  const navigate = useNavigate();
  const location = useLocation();
  const returnTo = (location.state as { from?: string } | null)?.from || '/files';
  const [copied, setCopied] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [zoom, setZoom] = useState(1);
  useEffect(() => { setLoaded(false); setZoom(1); }, [id]);
  const mime = metadata?.mimeType.split(';', 1)[0].toLowerCase() || '';
  const path = `/api/files/${encodeURIComponent(id)}`;
  const source = `${path}?inline=1`;
  const image = mime.startsWith('image/');
  const supported = mime === 'application/pdf' || mime.startsWith('image/') || mime === 'text/plain' || mime === 'text/markdown' || mime.startsWith('video/') || mime.startsWith('audio/');
  async function share(native: boolean) {
    const url = `${window.location.origin}/files/${encodeURIComponent(id)}`;
    if (native && navigator.share) { try { await navigator.share({ title: metadata?.name, url }); return; } catch (cause) { if ((cause as DOMException)?.name === 'AbortError') return; } }
    try { await navigator.clipboard.writeText(url); setCopied(true); window.setTimeout(() => setCopied(false), 2200); }
    catch { window.prompt('Copy this secure SRUXHUB link:', url); }
  }
  return <section className="file-viewer" aria-label="File viewer">
    <header className="file-viewer-header"><button className="viewer-icon" onClick={() => navigate(returnTo)} aria-label="Back"><ArrowLeft/></button><div className="viewer-title"><strong>{metadata?.name || 'File viewer'}</strong>{metadata && <small>{metadata.mimeType} · {formatSize(metadata.size)}</small>}</div><div className="viewer-actions"><button className="viewer-icon" onClick={() => void share(true)} disabled={!metadata} aria-label="Share">{copied ? 'Copied' : <Share2/>}</button><button className="viewer-icon" onClick={() => void share(false)} disabled={!metadata} aria-label="Copy link"><Copy/></button><a className="viewer-icon" href={source} target="_blank" rel="noreferrer" aria-label="Open in new tab"><ExternalLink/></a><a className="viewer-icon" href={`${path}?download=1`} aria-label="Download"><ArrowDownToLine/></a></div></header>
    <div className="file-viewer-canvas">
      {!metadata && !error && <div className="viewer-state" role="status"><span className="viewer-spinner"/><strong>Checking secure access…</strong><p>Verifying your account and file permissions.</p></div>}
      {error && <div className="viewer-state" role="alert"><FileText/><strong>File access unavailable</strong><p>{error}</p><button className="secondary" onClick={() => navigate('/files')}>Return to files</button></div>}
      {metadata && !supported && <div className="viewer-state"><FileText/><strong>Preview isn’t available for this file</strong><p>This format can’t be displayed safely inside SRUXHUB. Download it to open it with a compatible app.</p><a className="primary" href={`${path}?download=1`}>Download {metadata.name}</a><small>{metadata.mimeType} · {formatSize(metadata.size)}</small></div>}
      {metadata && supported && !loaded && <div className="viewer-loading" role="status"><span className="viewer-spinner"/>Loading file…</div>}
      {metadata && image && <div className="viewer-image-wrap"><div className="image-zoom"><button className="viewer-icon" onClick={() => setZoom(z => Math.max(.5, z - .25))} aria-label="Zoom out"><ZoomOut/></button><button className="viewer-icon" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button><button className="viewer-icon" onClick={() => setZoom(z => Math.min(4, z + .25))} aria-label="Zoom in"><ZoomIn/></button></div><img className="viewer-image" src={source} alt={metadata.name} onLoad={() => setLoaded(true)} onError={() => setLoaded(true)} style={{ transform: `scale(${zoom})` }}/></div>}
      {metadata && supported && !image && mime === 'application/pdf' && <iframe className="viewer-frame" src={source} title={metadata.name} onLoad={() => setLoaded(true)}/>}
      {metadata && supported && !image && mime.startsWith('video/') && <video className="viewer-media" controls src={source} onLoadedData={() => setLoaded(true)}/>}
      {metadata && supported && !image && mime.startsWith('audio/') && <audio className="viewer-audio" controls src={source} onLoadedData={() => setLoaded(true)}/>}
      {metadata && supported && !image && (mime === 'text/plain' || mime === 'text/markdown') && <iframe className="viewer-frame text-view" src={source} title={metadata.name} onLoad={() => setLoaded(true)}/>}
    </div>
  </section>;
}
function formatSize(size: number) { return size < 1048576 ? `${Math.max(1, Math.round(size / 1024))} KB` : `${(size / 1048576).toFixed(1)} MB`; }

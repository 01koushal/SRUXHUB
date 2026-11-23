import { useEffect, useRef, useState } from 'react';
import { MoreHorizontal, Trash2 } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { canDeletePost, deletePost, type Post } from './service';
import { useDismissibleMenu } from '../navigation/useDismissibleMenu';

export function PostMenu({ post, onDeleted }: { post: Post; onDeleted?: () => void }) {
  const { user, canParticipate } = useAuth();
  const [allowed, setAllowed] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const deleteLock = useRef(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  useDismissibleMenu(open, () => setOpen(false), menuRef, triggerRef);

  useEffect(() => {
    let active = true;
    setAllowed(false);
    void canDeletePost(post, canParticipate ? user?.id ?? null : null)
      .then(value => { if (active) setAllowed(value); })
      .catch(() => { if (active) setAllowed(false); });
    return () => { active = false; };
  }, [post.author_id, post.community_id, user?.id, canParticipate]);

  async function remove() {
    if (deleteLock.current) return;
    if (!window.confirm('Delete this post? Its comments and all nested replies will also be permanently deleted.')) return;
    deleteLock.current = true;
    setBusy(true);
    setError('');
    try { await deletePost(post.id); setOpen(false); onDeleted?.(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not delete this post.'); }
    finally { deleteLock.current = false; setBusy(false); }
  }

  return <div className="content-menu-wrap" ref={menuRef}>
    <button ref={triggerRef} className="icon-btn content-menu-trigger" type="button" aria-label="Post options" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(value => !value)}><MoreHorizontal size={19}/></button>
    {open && <div className="content-menu" role="menu">{allowed ? <button type="button" role="menuitem" disabled={busy} onClick={() => { setOpen(false); void remove(); }}><Trash2 size={15}/>{busy ? 'Deleting…' : 'Delete post'}</button> : <span className="menu-hint">No post actions available.</span>}{error && <p role="alert">{error}</p>}</div>}
  </div>;
}

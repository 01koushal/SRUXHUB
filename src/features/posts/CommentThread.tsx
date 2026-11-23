import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { MoreHorizontal, MessageCircle, Send, X } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { addComment, deleteComment, getComments, isCurrentUserAdmin, type Comment } from './service';
import { buildCommentTree, commentDescendantIds, type CommentNodeData } from './commentTree';
import { useDismissibleMenu } from '../navigation/useDismissibleMenu';

export function CommentThread({ postId, commentCount, onChanged }: { postId: string; commentCount: number; onChanged?: () => void }) {
  const { user, canParticipate } = useAuth();
  const [comments, setComments] = useState<Comment[]>([]);
  const [admin, setAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [newText, setNewText] = useState('');
  const [replyTarget, setReplyTarget] = useState<Comment | null>(null);
  const [replyText, setReplyText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const submitLock = useRef(false);
  const deleteLocks = useRef(new Set<string>());
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const roots = useMemo(() => buildCommentTree(comments), [comments]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [rows, isAdmin] = await Promise.all([getComments(postId), canParticipate ? isCurrentUserAdmin() : false]);
      setComments(rows);
      setAdmin(isAdmin);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load comments.'); }
    finally { setLoading(false); }
  }, [postId, canParticipate, user?.id]);

  useEffect(() => { void load(); }, [load]);

  async function submit(event: FormEvent<HTMLFormElement>, parentCommentId?: string) {
    event.preventDefault();
    if (!canParticipate) { window.location.assign('/auth'); return; }
    if (submitLock.current) return;
    const content = (parentCommentId ? replyText : newText).trim();
    if (!content) return;
    submitLock.current = true;
    setSubmitting(true);
    setError('');
    try {
      const created = await addComment(postId, content, parentCommentId);
      setComments(current => [...current, created].sort((a, b) => a.created_at.localeCompare(b.created_at)));
      if (parentCommentId) { setReplyText(''); setReplyTarget(null); }
      else setNewText('');
      onChanged?.();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not publish your comment.'); }
    finally { submitLock.current = false; setSubmitting(false); }
  }

  async function remove(comment: Comment) {
    const descendantIds = commentDescendantIds(comment.id, comments);
    const warning = 'Delete this comment? All replies and nested replies beneath it will also be permanently deleted.';
    if (!window.confirm(warning)) return;
    if (deleteLocks.current.has(comment.id)) return;
    deleteLocks.current.add(comment.id);
    setDeletingIds(current => new Set(current).add(comment.id));
    setError('');
    try {
      await deleteComment(comment.id);
      const removed = new Set([comment.id, ...descendantIds]);
      setComments(current => current.filter(row => !removed.has(row.id)));
      if (replyTarget && removed.has(replyTarget.id)) { setReplyTarget(null); setReplyText(''); }
      onChanged?.();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not delete this comment.'); }
    finally { deleteLocks.current.delete(comment.id); setDeletingIds(current => { const next = new Set(current); next.delete(comment.id); return next; }); }
  }

  return <section className="comments" aria-label="Post discussion">
    <h2>Conversation <span>{commentCount}</span></h2>
    <form className="comment-form" onSubmit={event => void submit(event)}>
      <textarea value={newText} onChange={event => setNewText(event.target.value)} maxLength={10000} required placeholder={canParticipate ? 'Add a thoughtful comment…' : 'Sign in to join the conversation'} aria-label="Write a comment" disabled={!canParticipate || submitting}/>
      <button className="primary" disabled={!canParticipate || submitting || !newText.trim()}><Send size={15}/>{submitting ? 'Posting…' : 'Comment'}</button>
    </form>
    {error && <p className="form-message" role="alert">{error}</p>}
    {loading ? <div className="loading comment-loading" role="status">Loading discussion…</div> : roots.length ? <div className="comment-tree">{roots.map(node => <CommentNode key={node.id} node={node} depth={0} admin={admin} userId={user?.id} replyTarget={replyTarget} replyText={replyText} submitting={submitting} deletingIds={deletingIds} onReply={comment => { setReplyTarget(comment); setReplyText(''); }} onCancelReply={() => { setReplyTarget(null); setReplyText(''); }} onReplyText={setReplyText} onSubmit={event => void submit(event, replyTarget?.id)} onDelete={comment => void remove(comment)}/>)}</div> : <div className="empty comment-empty"><MessageCircle/><h3>No comments yet</h3><p>Start the conversation.</p></div>}
  </section>;
}

type CommentNodeProps = {
  node: CommentNodeData; depth: number; admin: boolean; userId?: string; deletingIds: Set<string>;
  replyTarget: Comment | null; replyText: string; submitting: boolean;
  onReply: (comment: Comment) => void; onCancelReply: () => void; onReplyText: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void; onDelete: (comment: Comment) => void;
};

function CommentNode(props: CommentNodeProps) {
  const { node, depth, admin, userId, replyTarget, replyText, submitting, deletingIds, onReply, onCancelReply, onReplyText, onSubmit, onDelete } = props;
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  useDismissibleMenu(menuOpen, () => setMenuOpen(false), menuRef, triggerRef);
  const canDelete = Boolean(userId && (node.author_id === userId || admin));
  const name = node.profiles?.display_name || node.profiles?.username || 'SRU student';
  const isReplying = replyTarget?.id === node.id;
  return <article id={`comment-${node.id}`} className="comment-node" style={{ '--thread-depth': Math.min(depth, 3) } as React.CSSProperties}>
    <div className="comment-content">
      <header><div><b>{name}</b>{node.profiles?.username && <small>@{node.profiles.username}</small>}<time dateTime={node.created_at}>{formatCommentDate(node.created_at)}</time></div>
        <div className="comment-menu-wrap" ref={menuRef}><button ref={triggerRef} type="button" className="icon-btn comment-menu-trigger" aria-label={`Options for comment by ${name}`} aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(value => !value)}><MoreHorizontal size={17}/></button>{menuOpen && <div className="content-menu" role="menu">{canDelete ? <button type="button" role="menuitem" disabled={deletingIds.has(node.id)} onClick={() => { setMenuOpen(false); onDelete(node); }}>{deletingIds.has(node.id) ? 'Deleting…' : 'Delete comment'}</button> : <span className="menu-hint">Only the author or an admin can delete this comment.</span>}</div>}</div>
      </header>
      <p>{node.content}</p>
      <button className="text-button comment-reply-action" type="button" onClick={() => onReply(node)}><MessageCircle size={14}/>Reply</button>
      {isReplying && <form className="comment-reply-form" onSubmit={onSubmit}><div className="replying-to">Replying to <b>{name}</b><button type="button" className="text-button" onClick={onCancelReply} aria-label="Cancel reply"><X size={14}/>Cancel</button></div><textarea autoFocus value={replyText} onChange={event => onReplyText(event.target.value)} maxLength={10000} required placeholder="Write a reply…" aria-label={`Reply to ${name}`} disabled={submitting}/><button className="primary" disabled={submitting || !replyText.trim()}><Send size={14}/>{submitting ? 'Posting…' : 'Reply'}</button></form>}
    </div>
    {node.children.length > 0 && <div className={depth < 3 ? 'comment-children indented' : 'comment-children'}>{node.children.map(child => <CommentNode key={child.id} {...props} node={child} depth={depth + 1}/>)}</div>}
  </article>;
}

function formatCommentDate(value: string) { return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)); }

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { FileText, MessageCircle, Users, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../../lib/supabase';
import { validateUsername } from '../auth/validation';
import type { Community } from '../communities/service';
import { FileCard } from '../files/FileCard';
import type { StoredFile } from '../../storage/provider';
import { deleteComment, type Comment, type Post } from '../posts/service';
import { PostMenu } from '../posts/PostMenu';

type ProfileForm = { username: string; display_name: string; bio: string };
type Tab = 'Overview' | 'My Posts' | 'My Comments' | 'My Files' | 'My Communities';
type ProfileComment = Comment & { posts: { id: string; title: string; communities: { name: string; slug: string } | null } | null };

export default function ProfilePage() {
  const { user, profile: authProfile, canParticipate } = useAuth();
  const [profile, setProfile] = useState<ProfileForm>({ username: '', display_name: '', bio: '' });
  const [communities, setCommunities] = useState<Community[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [files, setFiles] = useState<StoredFile[]>([]);
  const [myComments, setMyComments] = useState<ProfileComment[]>([]);
  const [stats, setStats] = useState({ communities: 0, posts: 0, files: 0 });
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<Tab>('Overview');
  const [deletingCommentId, setDeletingCommentId] = useState('');
  const commentDeleteLocks = useRef(new Set<string>());
  const googleName = String(user?.user_metadata.full_name ?? user?.user_metadata.name ?? '');
  const avatar = typeof user?.user_metadata.avatar_url === 'string' ? user.user_metadata.avatar_url : '';

  const load = useCallback(async () => {
    if (!supabase || !user || !canParticipate) { setLoading(false); return; }
    setLoading(true);
    const [profileResult, memberResult, postResult, fileResult, commentResult] = await Promise.all([
      supabase.from('profiles').select('username,display_name,bio').eq('user_id', user.id).single(),
      supabase.from('community_members').select(`communities!community_members_community_id_fkey(id,name,slug,description,icon,member_count,created_at,rules)`, { count: 'exact' }).eq('user_id', user.id).range(0, 999),
      supabase.from('posts').select('id,community_id,author_id,title,content,post_type,created_at,vote_score,comment_count,profiles!posts_author_id_fkey(username,display_name,avatar_file_id),communities!posts_community_id_fkey(name,slug),post_attachments(files!post_attachments_file_id_fkey(original_filename))', { count: 'exact' }).eq('author_id', user.id).order('created_at', { ascending: false }).range(0, 999),
      supabase.from('files').select('id,original_filename,mime_type,file_size,storage_provider,community_id,owner_id,created_at,communities!files_community_id_fkey(name)', { count: 'exact' }).eq('owner_id', user.id).eq('status', 'published').order('created_at', { ascending: false }).range(0, 999),
      supabase.from('comments').select('id,post_id,parent_comment_id,content,created_at,author_id,profiles!comments_author_id_fkey(username,display_name),posts!comments_post_id_fkey(id,title,communities!posts_community_id_fkey(name,slug))', { count: 'exact' }).eq('author_id', user.id).order('created_at', { ascending: false }).range(0, 999),
    ]);
    const errors = [profileResult.error, memberResult.error, postResult.error, fileResult.error, commentResult.error].filter(Boolean);
    let memberRows = [...(memberResult.data ?? [])];
    let postRows = [...(postResult.data ?? [])];
    let fileRows = [...(fileResult.data ?? [])];
    let commentRows = [...(commentResult.data ?? [])];
    if (!errors.length) {
      for (const [kind, initialLength] of [['members', memberRows.length], ['posts', postRows.length], ['files', fileRows.length], ['comments', commentRows.length]] as const) {
        let offset = 1000;
        let length = initialLength;
        while (length === 1000) {
          if (kind === 'members') {
            const { data, error } = await supabase.from('community_members').select('communities!community_members_community_id_fkey(id,name,slug,description,icon,member_count,created_at,rules)').eq('user_id', user.id).range(offset, offset + 999);
            if (error) throw error; memberRows = memberRows.concat(data ?? []); length = data?.length ?? 0;
          } else if (kind === 'posts') {
            const { data, error } = await supabase.from('posts').select('id,community_id,author_id,title,content,post_type,created_at,vote_score,comment_count,profiles!posts_author_id_fkey(username,display_name,avatar_file_id),communities!posts_community_id_fkey(name,slug),post_attachments(files!post_attachments_file_id_fkey(original_filename))').eq('author_id', user.id).order('created_at', { ascending: false }).range(offset, offset + 999);
            if (error) throw error; postRows = postRows.concat(data ?? []); length = data?.length ?? 0;
          } else if (kind === 'files') {
            const { data, error } = await supabase.from('files').select('id,original_filename,mime_type,file_size,storage_provider,community_id,owner_id,created_at,communities!files_community_id_fkey(name)').eq('owner_id', user.id).eq('status', 'published').order('created_at', { ascending: false }).range(offset, offset + 999);
            if (error) throw error; fileRows = fileRows.concat(data ?? []); length = data?.length ?? 0;
          } else {
            const { data, error } = await supabase.from('comments').select('id,post_id,parent_comment_id,content,created_at,author_id,profiles!comments_author_id_fkey(username,display_name),posts!comments_post_id_fkey(id,title,communities!posts_community_id_fkey(name,slug))').eq('author_id', user.id).order('created_at', { ascending: false }).range(offset, offset + 999);
            if (error) throw error; commentRows = commentRows.concat(data ?? []); length = data?.length ?? 0;
          }
          offset += 1000;
        }
      }
    }
    if (profileResult.data) setProfile(profileResult.data);
    const joined = memberRows.map(row => row.communities as unknown as Community).filter(Boolean);
    setCommunities(joined);
    const ownedPosts = postRows.map(row => ({
      ...row,
      attachment_names: ((row.post_attachments as unknown as { files: { original_filename: string } | null }[] | null) ?? []).map(item => item.files?.original_filename).filter((name): name is string => Boolean(name)),
    })) as unknown as Post[];
    setPosts(ownedPosts);
    setFiles(fileRows.map(row => {
      const c = row.communities as unknown as { name: string } | null;
      return { id: row.id, name: row.original_filename, mimeType: row.mime_type, size: Number(row.file_size), provider: row.storage_provider, communityId: row.community_id, communityName: c?.name, uploaderId: row.owner_id, uploadedAt: row.created_at, upvotes: 0, hasVoted: false } as StoredFile;
    }));
    setMyComments(commentRows as unknown as ProfileComment[]);
    setStats({ communities: memberResult.count ?? joined.length, posts: postResult.count ?? ownedPosts.length, files: fileResult.count ?? fileRows.length });
    setMessage(errors.length ? errors.map(error => error?.message).join(' · ') : '');
    setLoading(false);
  }, [user, canParticipate]);

  useEffect(() => { void load().catch(cause => { setMessage(cause instanceof Error ? cause.message : 'Could not load your profile.'); setLoading(false); }); }, [load]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !user) return;
    if (!validateUsername(profile.username)) { setMessage('Username must be 3–24 letters, numbers or underscores.'); return; }
    setSaving(true);
    const { error } = await supabase.from('profiles').update({ username: profile.username.trim(), bio: profile.bio.trim() }).eq('user_id', user.id);
    setMessage(error?.code === '23505' ? 'That username is already taken.' : error?.message ?? 'Profile saved.');
    setSaving(false);
  }

  async function deleteFile(file: StoredFile) {
    setFiles(current => current.filter(item => item.id !== file.id));
    setStats(current => ({ ...current, files: Math.max(0, current.files - 1) }));
    setMessage('File deleted.');
  }

  async function removeMyComment(comment: ProfileComment) {
    if (!window.confirm('Delete this comment? Any replies beneath it will also be permanently deleted.')) return;
    if (commentDeleteLocks.current.has(comment.id)) return;
    commentDeleteLocks.current.add(comment.id);
    setDeletingCommentId(comment.id);
    try {
      await deleteComment(comment.id);
      await load();
      setMessage('Comment deleted.');
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Could not delete comment.'); }
    finally { commentDeleteLocks.current.delete(comment.id); setDeletingCommentId(''); }
  }

  if (!canParticipate) return <><PageHeading title="Your profile" subtitle="Sign in with your SRU Google account to view your profile."/><div className="empty"><Link className="primary" to="/auth">Sign in</Link></div></>;
  if (loading) return <div className="loading" aria-live="polite">Loading your profile…</div>;

  return <section className="profile-page">
    <PageHeading title="Your profile" subtitle="Your identity and activity across SRUXHUB."/>
    <header className="profile-hero">{avatar ? <img className="profile-photo" src={avatar} alt="" referrerPolicy="no-referrer"/> : <span className="profile-photo avatar-fallback">{(profile.display_name || googleName || '?')[0]}</span>}<div><span className="eyebrow">SRU GOOGLE ACCOUNT</span><h2>{profile.display_name || googleName || authProfile?.display_name}</h2><p>@{profile.username} · {user?.email}</p></div></header>
    <div className="profile-stats"><div><Users/><strong>{stats.communities}</strong><span>Communities joined</span></div><div><MessageCircle/><strong>{stats.posts}</strong><span>Posts created</span></div><div><FileText/><strong>{stats.files}</strong><span>Files shared</span></div></div>
    <nav className="tabs profile-tabs" aria-label="Profile sections">{(['Overview','My Posts','My Comments','My Files','My Communities'] as Tab[]).map(item => <button key={item} className={tab === item ? 'selected' : ''} aria-current={tab === item ? 'page' : undefined} onClick={() => setTab(item)}>{item}</button>)}</nav>
    {message && <p className="form-message" role="status">{message}</p>}
    {tab === 'Overview' && <div className="profile-columns">
      <form className="profile-form" onSubmit={event => void save(event)}><div className="eyebrow">PROFILE DETAILS</div><h3>Account information</h3><label>Google display name<input value={profile.display_name || googleName} readOnly/></label><small className="field-note">This name comes from Google and cannot be changed here.</small><label>Username<input value={profile.username} minLength={3} maxLength={24} onChange={event => setProfile(value => ({ ...value, username: event.target.value }))}/></label><label>Bio<textarea rows={4} maxLength={500} value={profile.bio} onChange={event => setProfile(value => ({ ...value, bio: event.target.value }))}/></label><button className="primary" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button></form>
      <section className="joined-communities"><div className="eyebrow">YOUR CAMPUS</div><h3>Communities joined</h3>{communities.slice(0, 5).map(community => <Link key={community.id} to={`/c/${community.slug}`}><span className="community-dot">{community.name[0]}</span>{community.name}</Link>)}{!communities.length && <p className="muted">Join a community to see it here.</p>}<button className="text-button" onClick={() => setTab('My Communities')}>View all communities</button></section>
    </div>}
    {tab === 'My Posts' && <section className="profile-content-list">{posts.map(post => <article className="profile-content-row" key={post.id}><div><h3>{post.title}</h3><p>{post.content}</p><small>{post.communities?.name ?? 'Community'} · {formatDate(post.created_at)} · Score {post.vote_score} · {post.comment_count} comments{post.attachment_names?.length ? ` · Attachments: ${post.attachment_names.join(', ')}` : ''}</small></div><div className="button-row"><Link className="secondary" to={`/p/${post.id}`}>View Post</Link><a className="secondary" href={`/p/${post.id}`} target="_blank" rel="noreferrer">Open Original Post</a><PostMenu post={post} onDeleted={() => { setPosts(current => current.filter(item => item.id !== post.id)); setMyComments(current => current.filter(comment => comment.post_id !== post.id)); setStats(current => ({ ...current, posts: Math.max(0, current.posts - 1) })); setMessage('Post deleted.'); }}/></div></article>)}{!posts.length && <div className="empty"><MessageCircle/><h2>No posts yet</h2><p>Your posts will appear here.</p></div>}</section>}
    {tab === 'My Comments' && <section className="profile-content-list">{myComments.map(comment => <article className="profile-content-row" key={comment.id}><div><small>{comment.parent_comment_id ? 'Reply' : 'Comment'}{comment.posts?.communities?.name ? ` · ${comment.posts.communities.name}` : ''}</small><h3>{comment.posts?.title ?? 'Original post is no longer available'}</h3><p>{comment.content}</p><small>{formatDate(comment.created_at)}</small></div><div className="button-row">{comment.posts && <Link className="secondary" to={`/p/${comment.posts.id}#comment-${comment.id}`}>Open discussion</Link>}<button className="quiet-danger" disabled={deletingCommentId === comment.id} onClick={() => void removeMyComment(comment)} aria-label={`Delete your ${comment.parent_comment_id ? 'reply' : 'comment'}`}>{deletingCommentId === comment.id ? 'Deleting…' : <><Trash2 size={16}/> Delete</>}</button></div></article>)}{!myComments.length && <div className="empty"><MessageCircle/><h2>No comments yet</h2><p>Your comments and replies will appear here.</p></div>}</section>}
    {tab === 'My Files' && <section className="profile-content-list">{files.map(file => <FileCard key={file.id} file={file} onDelete={deleteFile}/>)}{!files.length && <div className="empty"><FileText/><h2>No files yet</h2><p>Your uploaded files will appear here.</p></div>}</section>}
    {tab === 'My Communities' && <section className="community-grid">{communities.map(community => <Link key={community.id} to={`/c/${community.slug}`} className="community-card"><i className="community-badge">{community.icon ? <img src={community.icon} alt=""/> : community.name[0]}</i><h3>{community.name}</h3><p>{community.description}</p><small>{community.member_count ?? 0} members</small></Link>)}{!communities.length && <div className="empty"><Users/><h2>No communities joined</h2><Link to="/discover">Explore communities</Link></div>}</section>}
  </section>;
}

function formatDate(value: string) { return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value)); }
function PageHeading({ title, subtitle }: { title: string; subtitle: string }) { return <header className="page-heading"><div><div className="eyebrow">YOUR ACCOUNT</div><h1>{title}</h1><p>{subtitle}</p></div></header>; }

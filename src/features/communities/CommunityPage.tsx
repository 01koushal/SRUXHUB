import { useEffect, useState, type ReactNode } from 'react';
import { CalendarDays, FileText, Info, MessageCircle, Users } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { getCommunityPosts, getMembershipRole, getUserIsAdmin, joinCommunity, leaveCommunity, listCommunities, type Community } from './service';
import { listFiles } from '../files/service';
import { FileCard } from '../files/FileCard';
import type { Post } from '../posts/service';
import type { StoredFile } from '../../storage/provider';

type Tab = 'posts' | 'files' | 'about';

export default function CommunityPage({ renderPost }: { renderPost: (post: Post, onDeleted?: () => void) => ReactNode }) {
  const navigate = useNavigate();
  const { canParticipate, user } = useAuth();
  const slug = decodeURIComponent(location.pathname.split('/').pop() || '');
  const [community, setCommunity] = useState<Community | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [files, setFiles] = useState<StoredFile[]>([]);
  const [joined, setJoined] = useState(false);
  const [memberRole, setMemberRole] = useState<string | null>(null);
  const [globalAdmin, setGlobalAdmin] = useState(false);
  const [tab, setTab] = useState<Tab>('posts');
  const [sort, setSort] = useState<'newest' | 'upvotes'>('newest');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    void listCommunities().then(async all => {
      const result = all.find(item => item.slug === slug);
      if (!result) throw new Error('Community not found.');
      const [communityPosts, isMember, isAdmin] = await Promise.all([
        getCommunityPosts(result.id),
        getMembershipRole(result.id),
        getUserIsAdmin(),
      ]);
      if (!active) return;
      setCommunity(result);
      setPosts(communityPosts as unknown as Post[]);
      setMemberRole(typeof isMember === 'string' ? isMember : null);
      setGlobalAdmin(isAdmin);
      setJoined(Boolean(isMember));
      setError('');
    }).catch(cause => {
      if (active) setError(cause instanceof Error ? cause.message : 'Could not load this community.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [slug]);

  useEffect(() => {
    if (tab !== 'files' || !community || !joined) return;
    let active = true;
    void listFiles(community.id, sort).then(data => { if (active) setFiles(data); })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : 'Could not load community files.'); });
    return () => { active = false; };
  }, [tab, community, joined, sort]);

  async function toggleMembership() {
    if (!canParticipate) return navigate('/auth');
    if (!community) return;
    try {
      if (joined) await leaveCommunity(community.id);
      else await joinCommunity(community.id);
      setJoined(value => !value);
      setMemberRole(joined ? null : 'member');
      setCommunity(current => current ? { ...current, member_count: Math.max(0, (current.member_count || 0) + (joined ? -1 : 1)) } : current);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update membership.');
    }
  }

  if (loading) return <div className="loading">Loading community…</div>;
  if (error && !community) return <div className="empty"><h2>Community unavailable</h2><p>{error}</p><Link className="primary" to="/discover">Browse communities</Link></div>;
  if (!community) return null;

  return <section className="community-page">
    <header className="community-banner">
      <i className="community-badge">{community.icon || community.name[0]}</i>
      <div className="community-banner-copy"><div className="eyebrow">SRUXHUB COMMUNITY</div><h1>{community.name}</h1><p>{community.description || 'A place for SRU students to connect and share.'}</p>
        <small><Users size={14}/> {community.member_count ?? 0} members</small></div>
      <button className={joined ? 'secondary' : 'primary'} onClick={() => void toggleMembership()}>{joined ? 'Joined · Leave' : 'Join community'}</button>
    </header>

    <nav className="community-tabs" aria-label="Community sections">
      <button className={tab === 'posts' ? 'selected' : ''} onClick={() => setTab('posts')}><MessageCircle size={17}/>Posts</button>
      <button className={tab === 'files' ? 'selected' : ''} onClick={() => setTab('files')}><FileText size={17}/>Files</button>
      <button className={tab === 'about' ? 'selected' : ''} onClick={() => setTab('about')}><Info size={17}/>About</button>
      {tab === 'posts' && joined && <Link className="primary" to={`/create?community=${community.id}`}>Create post</Link>}
    </nav>

    {error && <div className="form-message" role="alert">{error}</div>}
    {tab === 'posts' && <div className="post-list">
      {posts.map(post => renderPost(post, () => setPosts(current => current.filter(item => item.id !== post.id))))}
      {posts.length === 0 && <div className="empty"><MessageCircle/><h2>No posts here yet</h2><p>Join the community and start the first conversation.</p></div>}
    </div>}
    {tab === 'files' && <section className="community-files">
      <div className="community-files-head"><div><h2>Shared files</h2><p>Resources available to community members.</p></div><label className="sort-select"><span>Sort</span><select value={sort} onChange={event => setSort(event.target.value as 'newest' | 'upvotes')}><option value="newest">Newest</option><option value="upvotes">Most upvoted</option></select></label></div>
      {!joined ? <div className="empty"><FileText/><h2>Join to access community files</h2><p>Membership keeps shared resources within this community.</p><button className="primary" onClick={() => void toggleMembership()}>Join community</button></div> : files.length ? <div className="file-list">{files.map(file => <FileCard key={file.id} file={file} canDelete={file.uploaderId === user?.id || globalAdmin || ['moderator','admin'].includes(memberRole || '')}/>)}</div> : <div className="empty"><FileText/><h2>No files shared yet</h2><p>Useful resources uploaded for this community will appear here.</p><Link className="secondary" to="/files">Share a file</Link></div>}
    </section>}
    {tab === 'about' && <section className="about-panel">
      <div className="about-description"><div className="eyebrow">ABOUT THIS COMMUNITY</div><h2>{community.name}</h2><p>{community.description || 'No community description has been added yet.'}</p></div>
      <div className="about-facts"><div><Users size={18}/><span><b>{community.member_count ?? 0}</b><small>Members</small></span></div>{community.created_at && <div><CalendarDays size={18}/><span><b>{new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(community.created_at))}</b><small>Created</small></span></div>}</div>
      {Array.isArray(community.rules) && community.rules.length > 0 && <div className="community-rules"><h3>Community guidelines</h3><ol>{community.rules.map((rule, index) => <li key={`${index}-${String(rule)}`}>{String(rule)}</li>)}</ol></div>}
    </section>}
  </section>;
}

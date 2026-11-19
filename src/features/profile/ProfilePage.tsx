import { useEffect, useState, type FormEvent } from 'react';
import { FileText, MessageCircle, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../../lib/supabase';
import { validateUsername } from '../auth/validation';
import type { Community } from '../communities/service';

type ProfileForm = { username: string; display_name: string; bio: string };

export default function ProfilePage() {
  const { user, profile: authProfile, canParticipate } = useAuth();
  const [profile, setProfile] = useState<ProfileForm>({ username: '', display_name: '', bio: '' });
  const [communities, setCommunities] = useState<Community[]>([]);
  const [stats, setStats] = useState({ communities: 0, posts: 0, files: 0 });
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const googleName = String(user?.user_metadata.full_name ?? user?.user_metadata.name ?? '');
  const avatar = typeof user?.user_metadata.avatar_url === 'string' ? user.user_metadata.avatar_url : '';

  useEffect(() => {
    if (!supabase || !user || !canParticipate) {
      setLoading(false);
      return;
    }
    let active = true;
    async function load() {
      const [profileResult, memberResult, postResult, fileResult] = await Promise.all([
        supabase!.from('profiles').select('username,display_name,bio').eq('user_id', user!.id).single(),
        supabase!.from('community_members').select('communities!community_members_community_id_fkey(id,name,slug)')
          .eq('user_id', user!.id).limit(100),
        supabase!.from('posts').select('id', { count: 'exact', head: true }).eq('author_id', user!.id),
        supabase!.from('files').select('id', { count: 'exact', head: true }).eq('owner_id', user!.id).eq('status', 'published'),
      ]);
      if (!active) return;
      if (profileResult.error) setMessage(profileResult.error.message);
      else if (profileResult.data) setProfile(profileResult.data);
      if (memberResult.error) setMessage(memberResult.error.message);
      else setCommunities((memberResult.data ?? []).map(row => row.communities as unknown as Community).filter(Boolean));
      setStats({
        communities: memberResult.count ?? memberResult.data?.length ?? 0,
        posts: postResult.count ?? 0,
        files: fileResult.count ?? 0,
      });
      setLoading(false);
    }
    void load().catch(cause => {
      if (active) {
        setMessage(cause instanceof Error ? cause.message : 'Could not load your profile.');
        setLoading(false);
      }
    });
    return () => { active = false; };
  }, [user, canParticipate]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !user) return;
    if (!validateUsername(profile.username)) {
      setMessage('Username must be 3–24 letters, numbers or underscores.');
      return;
    }
    setSaving(true);
    const { error } = await supabase.from('profiles').update({ username: profile.username.trim(), bio: profile.bio.trim() }).eq('user_id', user.id);
    setMessage(error?.code === '23505' ? 'That username is already taken.' : error?.message ?? 'Profile saved.');
    setSaving(false);
  }

  if (!canParticipate) return <><PageHeading title="Your profile" subtitle="Sign in with your SRU Google account to view your profile."/><div className="empty"><Link className="primary" to="/auth">Sign in</Link></div></>;
  if (loading) return <div className="loading">Loading your profile…</div>;

  return <section className="profile-page">
    <PageHeading title="Your profile" subtitle="Your identity and activity across SRUXHUB."/>
    <header className="profile-hero">
      {avatar ? <img className="profile-photo" src={avatar} alt="" referrerPolicy="no-referrer"/> : <span className="profile-photo avatar-fallback">{(profile.display_name || googleName || '?')[0]}</span>}
      <div><span className="eyebrow">SRU GOOGLE ACCOUNT</span><h2>{profile.display_name || googleName || authProfile?.display_name}</h2><p>@{profile.username} · {user?.email}</p></div>
    </header>
    <div className="profile-stats">
      <div><Users/><strong>{stats.communities}</strong><span>Communities joined</span></div>
      <div><MessageCircle/><strong>{stats.posts}</strong><span>Posts created</span></div>
      <div><FileText/><strong>{stats.files}</strong><span>Files shared</span></div>
    </div>
    <div className="profile-columns">
      <form className="profile-form" onSubmit={event => void save(event)}>
        <div className="eyebrow">PROFILE DETAILS</div><h3>Account information</h3>
        <label>Google display name<input value={profile.display_name || googleName} readOnly aria-describedby="google-name-note"/></label>
        <small id="google-name-note" className="field-note">This name comes from Google and cannot be changed here.</small>
        <label>Username<input value={profile.username} minLength={3} maxLength={24} onChange={event => setProfile(value => ({ ...value, username: event.target.value }))}/></label>
        <label>Bio<textarea rows={4} maxLength={500} value={profile.bio} onChange={event => setProfile(value => ({ ...value, bio: event.target.value }))}/></label>
        {message && <p className="form-message" role="status">{message}</p>}
        <button className="primary" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
      </form>
      <section className="joined-communities">
        <div className="eyebrow">YOUR CAMPUS</div><h3>Communities joined</h3>
        {communities.length ? communities.map(community => <Link key={community.id} to={`/c/${community.slug}`}><span className="community-dot">{community.name[0]}</span>{community.name}</Link>) : <p className="muted">Join a community to see it here.</p>}
      </section>
    </div>
  </section>;
}

function PageHeading({ title, subtitle }: { title: string; subtitle: string }) {
  return <header className="page-heading"><div><div className="eyebrow">YOUR ACCOUNT</div><h1>{title}</h1><p>{subtitle}</p></div></header>;
}

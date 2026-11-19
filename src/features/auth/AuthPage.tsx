import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from './AuthProvider';

export default function AuthPage() {
  const {
    user, profile, loading, profileLoading, needsOnboarding, canParticipate,
    configured, authError, signInWithGoogle, signOut, completeOnboarding,
  } = useAuth();
  const [username, setUsername] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const googleName = String(user?.user_metadata.full_name ?? user?.user_metadata.name ?? user?.email?.split('@')[0] ?? 'SRU Student').trim().slice(0, 60);

  useEffect(() => { setUsername(''); }, [user?.id]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    const error = await completeOnboarding(username, googleName);
    setMessage(error ?? 'Your profile is ready.');
    setBusy(false);
  }

  return <main className="auth-page">
    <section className="auth-box">
      <img className="auth-logo" src="/srux-logo.png" alt="SRUX Student Community Website"/>
      <div className="eyebrow">SR UNIVERSITY COMMUNITY</div>
      {loading || profileLoading ? <><h1>Checking your account…</h1><p>Loading your SRUXHUB profile.</p></> : null}
      {!loading && !profileLoading && needsOnboarding && <>
        <h1>Make this space yours.</h1><p>Choose a unique username. Your Google name stays connected to your university account.</p>
        <div className="google-name-card"><span className="avatar">{googleName[0]?.toUpperCase()}</span><span><small>GOOGLE DISPLAY NAME</small><strong>{googleName}</strong></span></div>
        <form onSubmit={event => void submit(event)} className="auth-form">
          <label>Username<input value={username} onChange={event => setUsername(event.target.value)} required minLength={3} maxLength={24} pattern="[A-Za-z0-9_]+" autoComplete="username"/><small>3–24 letters, numbers, or underscores. Usernames are unique and case-insensitive.</small></label>
          <button className="primary full" disabled={busy}>{busy ? 'Saving profile…' : 'Continue to SRUXHUB'}</button>
        </form>
        <button className="text-button" onClick={() => void signOut()}>Sign out</button>
      </>}
      {!loading && !profileLoading && canParticipate && <>
        <h1>You’re signed in.</h1><p>{profile?.display_name}, your @sru.edu.in account can now participate.</p>
        <Link className="primary full" to="/">Go to your community</Link><button className="text-button" onClick={() => void signOut()}>Sign out</button>
      </>}
      {!loading && !profileLoading && !canParticipate && !needsOnboarding && <>
        <h1>Welcome to SRUXHUB.</h1>
        <p>Browse freely. Sign in with your verified SR University Google account to post, vote, comment or join communities.</p>
        {authError && <div className="notice">{authError}</div>}
        <button className="primary full google-sign-in" type="button" disabled={!configured} onClick={() => void signInWithGoogle()}><GoogleMark/>Continue with Google</button>
        {!configured && <div className="notice">Add your Supabase project URL and publishable key to enable Google sign-in.</div>}
        <Link className="text-button browse-link" to="/">Keep browsing</Link>
      </>}
      {message && <p className="form-message" role="status">{message}</p>}
    </section>
  </main>;
}

function GoogleMark() {
  return <svg aria-hidden="true" viewBox="0 0 48 48" width="19" height="19"><path fill="#4285F4" d="M43.6 24.5c0-1.4-.1-2.8-.4-4.1H24v7.8h11a9.4 9.4 0 0 1-4.1 6.2v5.1h6.7c3.9-3.6 6-8.9 6-15Z"/><path fill="#34A853" d="M24 44c5.5 0 10.1-1.8 13.5-4.8l-6.7-5.1c-1.8 1.2-4.1 1.9-6.8 1.9-5.2 0-9.6-3.5-11.2-8.2H5.9v5.2A20 20 0 0 0 24 44Z"/><path fill="#FBBC05" d="M12.8 27.8a12 12 0 0 1 0-7.6V15H5.9a20 20 0 0 0 0 17.9l6.9-5.1Z"/><path fill="#EA4335" d="M24 12c3 0 5.7 1 7.8 3.1l5.9-5.9A19.8 19.8 0 0 0 24 4 20 20 0 0 0 5.9 15l6.9 5.2C14.4 15.5 18.8 12 24 12Z"/></svg>;
}

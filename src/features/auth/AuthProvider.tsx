import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabase } from '../../lib/supabase';
import { canParticipate as participationAllowed, isEligibleGoogleAccount } from './eligibility';
import { endSession, startGoogleSignIn } from './service';
import { buildOnboardingProfile, onboardingInsertError } from './onboarding';

export type UserProfile = {
  user_id: string;
  username: string;
  display_name: string;
  avatar_file_id: string | null;
  bio: string;
  onboarding_complete: boolean;
};

type AuthValue = {
  session: Session | null;
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  profileLoading: boolean;
  configured: boolean;
  authError: string;
  isUniversityEmail: boolean;
  canParticipate: boolean;
  needsOnboarding: boolean;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  completeOnboarding: (username: string, displayName: string) => Promise<string | null>;
  clearAuthError: () => void;
};

const C = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(isSupabaseConfigured);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [authError, setAuthError] = useState('');

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    let active = true;
    void supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      if (error) setAuthError(error.message);
      setSession(data.session);
      setLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setLoading(false);
    });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    const user = session?.user;
    if (!user) {
      setProfile(null);
      setProfileLoading(false);
      return;
    }
    if (!isEligibleGoogleAccount(user)) {
      setProfile(null);
      setProfileLoading(false);
      setAuthError('Use a verified Google account ending in @sru.edu.in. You can continue browsing without signing in.');
      void supabase?.auth.signOut();
      return;
    }
    let active = true;
    setProfileLoading(true);
    void supabase!.from('profiles')
      .select('user_id,username,display_name,avatar_file_id,bio,onboarding_complete')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!active) return;
        if (error) setAuthError(error.message);
        setProfile((data as UserProfile | null) ?? null);
        setProfileLoading(false);
      }, (error: unknown) => {
        if (!active) return;
        setAuthError(error instanceof Error ? error.message : 'Unable to load your profile.');
        setProfile(null);
        setProfileLoading(false);
      });
    return () => { active = false; };
  }, [session]);

  const signInWithGoogle = useCallback(async () => {
    setAuthError('');
    if (!supabase) {
      setAuthError('Supabase is not configured.');
      return;
    }
    try {
      const { error } = await startGoogleSignIn(supabase, window.location.origin);
      if (error) setAuthError(error.message);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Google sign-in could not be started.');
    }
  }, []);

  const signOut = useCallback(async () => {
    if (supabase) {
      const { error } = await endSession(supabase);
      if (error) setAuthError(error.message);
    }
    setProfile(null);
  }, []);

  const completeOnboarding = useCallback(async (username: string, displayName: string) => {
    const user = session?.user;
    if (!supabase || !user || !isEligibleGoogleAccount(user)) {
      return 'Continue with an eligible @sru.edu.in Google account first.';
    }
    const result = buildOnboardingProfile(user.id, username, displayName);
    if (!result.profile) return result.error ?? 'Check your profile details.';
    const columns = 'user_id,username,display_name,avatar_file_id,bio,onboarding_complete';
    let saved;
    if (profile?.user_id === user.id) {
      // The OAuth name is immutable; onboarding updates only username/state.
      saved = await supabase.from('profiles')
        .update({ username: result.profile.username, onboarding_complete: true })
        .eq('user_id', user.id).select(columns).single();
    } else {
      saved = await supabase.from('profiles').insert({
        user_id: user.id,
        username: result.profile.username,
        display_name: result.profile.display_name,
        onboarding_complete: true,
      }).select(columns).single();
    }
    const { data, error } = saved;
    if (error) return onboardingInsertError(error.code, error.message);
    setProfile(data as UserProfile);
    setAuthError('');
    return null;
  }, [session, profile]);

  const user = session?.user ?? null;
  const allowed = participationAllowed(user, profile);
  const value = useMemo<AuthValue>(() => ({
    session,
    user,
    profile,
    loading,
    profileLoading,
    configured: isSupabaseConfigured,
    authError,
    isUniversityEmail: isEligibleGoogleAccount(user),
    canParticipate: allowed,
    needsOnboarding: isEligibleGoogleAccount(user) && !profileLoading && !profile?.onboarding_complete,
    signInWithGoogle,
    signOut,
    completeOnboarding,
    clearAuthError: () => setAuthError(''),
  }), [session, user, profile, loading, profileLoading, authError, allowed, signInWithGoogle, signOut, completeOnboarding]);

  return <C.Provider value={value}>{children}</C.Provider>;
}

export function useAuth() {
  const value = useContext(C);
  if (!value) throw new Error('useAuth must be inside AuthProvider');
  return value;
}

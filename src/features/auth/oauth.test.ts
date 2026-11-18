import{describe,expect,it,vi}from'vitest';
import{endSession,startGoogleSignIn}from'./service';
import{supabaseAuthOptions}from'../../lib/supabase';
import{canParticipate,isEligibleGoogleAccount,isSruEmail}from'./eligibility';
import{buildOnboardingProfile,onboardingInsertError}from'./onboarding';

const sruGoogle={email:'student@sru.edu.in',email_confirmed_at:'2026-11-18T00:00:00Z',app_metadata:{provider:'google'}};
describe('Google OAuth lifecycle',()=>{
 it('requests Google OAuth with the current application redirect and account chooser',async()=>{const signInWithOAuth=vi.fn().mockResolvedValue({error:null});const client={auth:{signInWithOAuth,signOut:vi.fn()}};await startGoogleSignIn(client,'https://hub.srux.in');expect(signInWithOAuth).toHaveBeenCalledWith({provider:'google',options:{redirectTo:'https://hub.srux.in',queryParams:{prompt:'select_account'}}})});
 it('persists and detects sessions returned through the OAuth redirect',()=>{expect(supabaseAuthOptions.auth).toEqual({persistSession:true,autoRefreshToken:true,detectSessionInUrl:true})});
 it('logs out through Supabase Auth',async()=>{const signOut=vi.fn().mockResolvedValue({error:null});await endSession({auth:{signInWithOAuth:vi.fn(),signOut}});expect(signOut).toHaveBeenCalledOnce()});
 it('allows participation only after a verified SRU Google account completes onboarding',()=>{expect(isSruEmail('STUDENT@sru.edu.in')).toBe(true);expect(isSruEmail('student@sru.edu.in.attacker.test')).toBe(false);expect(isEligibleGoogleAccount(sruGoogle)).toBe(true);expect(isEligibleGoogleAccount({...sruGoogle,email:'student@gmail.com'})).toBe(false);expect(isEligibleGoogleAccount({...sruGoogle,app_metadata:{provider:'email'}})).toBe(false);expect(isEligibleGoogleAccount({...sruGoogle,email_confirmed_at:null})).toBe(false);expect(canParticipate(sruGoogle,{onboarding_complete:false})).toBe(false);expect(canParticipate(sruGoogle,{onboarding_complete:true})).toBe(true)});
 it('creates a profile only from an explicitly chosen username and display name',()=>{expect(buildOnboardingProfile('user-id','chosen_name','Chosen Name')).toEqual({profile:{user_id:'user-id',username:'chosen_name',display_name:'Chosen Name',onboarding_complete:true}});expect(buildOnboardingProfile('user-id','','Student').profile).toBeUndefined()});
 it('returns a username collision so onboarding can ask the student to choose again',()=>{expect(onboardingInsertError('23505','duplicate key')).toMatch(/username is already taken/i);expect(onboardingInsertError('XX000','database unavailable')).toBe('database unavailable')});
});

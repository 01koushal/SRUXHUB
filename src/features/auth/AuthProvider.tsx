import {createContext,useContext,useEffect,useMemo,useState,type ReactNode} from 'react';
import type {Session,User} from '@supabase/supabase-js';
import {isSupabaseConfigured,supabase} from '../../lib/supabase';
import {validateDisplayName,validateUsername} from './validation';

type AuthValue={session:Session|null;user:User|null;loading:boolean;configured:boolean;signUp:(email:string,password:string,username:string,displayName:string)=>Promise<string|null>;signIn:(email:string,password:string)=>Promise<string|null>;signOut:()=>Promise<void>;resetPassword:(email:string)=>Promise<string|null>;updatePassword:(password:string)=>Promise<string|null>};
const C=createContext<AuthValue|null>(null);
export function AuthProvider({children}:{children:ReactNode}){
 const[session,setSession]=useState<Session|null>(null);const[loading,setLoading]=useState(isSupabaseConfigured);
 useEffect(()=>{if(!supabase){setLoading(false);return}supabase.auth.getSession().then(({data})=>{setSession(data.session);setLoading(false)});const{data:{subscription}}=supabase.auth.onAuthStateChange((_e,s)=>{setSession(s);setLoading(false)});return()=>subscription.unsubscribe()},[]);
 const value=useMemo<AuthValue>(()=>({session,user:session?.user??null,loading,configured:isSupabaseConfigured,
  signUp:async(email,password,username,displayName)=>{if(!supabase)return'Supabase is not configured.';if(!validateUsername(username))return'Username must be 3–24 letters, numbers or underscores.';if(!validateDisplayName(displayName))return'Display name must be 1–60 characters.';const{error}=await supabase.auth.signUp({email,password,options:{data:{username:username.trim(),display_name:displayName.trim()},emailRedirectTo:`${location.origin}/`}});return error?.message??null},
  signIn:async(email,password)=>{if(!supabase)return'Supabase is not configured.';const{error}=await supabase.auth.signInWithPassword({email,password});return error?.message??null},
  signOut:async()=>{if(supabase)await supabase.auth.signOut()},
  resetPassword:async(email)=>{if(!supabase)return'Supabase is not configured.';const{error}=await supabase.auth.resetPasswordForEmail(email,{redirectTo:`${location.origin}/reset-password`});return error?.message??null},
  updatePassword:async(password)=>{if(!supabase)return'Supabase is not configured.';const{error}=await supabase.auth.updateUser({password});return error?.message??null}
 }),[session,loading]);return <C.Provider value={value}>{children}</C.Provider>
}
export function useAuth(){const v=useContext(C);if(!v)throw new Error('useAuth must be inside AuthProvider');return v}

import { supabase } from '../../lib/supabase';
import { withUserVotes } from '../posts/service';

export type Community = {
  id: string;
  name: string;
  slug: string;
  description: string;
  icon: string | null;
  member_count?: number;
  created_at?: string;
  rules?: unknown;
};

const communityFields = 'id,name,slug,description,icon,member_count,created_at,rules';

export async function listCommunities() {
  if (!supabase) throw new Error('Connect Supabase to load communities.');
  const { data, error } = await supabase.from('communities').select(communityFields).order('name').limit(50);
  if (error) throw error;
  return (data ?? []) as Community[];
}

export async function joinCommunity(id: string) {
  if (!supabase) throw new Error('Sign in to join.');
  const { error } = await supabase.from('community_members').insert({ community_id: id });
  if (error) throw error;
}

export async function leaveCommunity(id: string) {
  if (!supabase) throw new Error('Sign in to leave.');
  const { error } = await supabase.from('community_members').delete().eq('community_id', id);
  if (error) throw error;
}

export async function getMembership(id: string) {
  return Boolean(await getMembershipRole(id));
}

export async function getMembershipRole(id: string) {
  if (!supabase) return false;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { data, error } = await supabase.from('community_members').select('role')
    .eq('community_id', id).eq('user_id', user.id).maybeSingle();
  if (error) throw error;
  return data?.role || null;
}

export async function getUserIsAdmin() {
  if (!supabase) return false;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { data, error } = await supabase.from('community_members').select('community_id')
    .eq('user_id', user.id).eq('role', 'admin').limit(1);
  if (error) throw error;
  return Boolean(data?.length);
}

export async function getCommunityPosts(id: string) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.from('posts')
    .select('id,community_id,author_id,title,content,post_type,created_at,vote_score,comment_count,profiles!posts_author_id_fkey(username,display_name,avatar_file_id),communities!posts_community_id_fkey(name,slug)')
    .eq('community_id', id).eq('status', 'published')
    .order('created_at', { ascending: false }).range(0, 19);
  if (error) throw error;
  return withUserVotes((data ?? []) as unknown as import('../posts/service').Post[]);
}

export async function listJoinedCommunities() {
  if (!supabase) return [];
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await supabase.from('community_members')
    .select(`communities!community_members_community_id_fkey(${communityFields})`)
    .eq('user_id', user.id).limit(20);
  if (error) throw error;
  return (data ?? []).map(row => row.communities as unknown as Community).filter(Boolean);
}

export async function searchCommunities(term: string) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const safe = term.trim().slice(0, 100).replace(/[,%_().]/g, ' ');
  if (!safe) return [];
  const pattern = `%${safe}%`;
  const { data, error } = await supabase.from('communities').select(communityFields)
    .or(`name.ilike.${pattern},description.ilike.${pattern}`)
    .order('name').limit(30);
  if (error) throw error;
  return (data ?? []) as Community[];
}

export async function getJoinedCommunityIds(ids: string[]) {
  if (!supabase || !ids.length) return new Set<string>();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Set<string>();
  const { data, error } = await supabase.from('community_members').select('community_id')
    .eq('user_id', user.id).in('community_id', ids);
  if (error) throw error;
  return new Set((data ?? []).map(row => row.community_id));
}

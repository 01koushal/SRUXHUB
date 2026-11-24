import { supabase } from '../../lib/supabase';
import type { StoredFile } from '../../storage/provider';

type FileSort = 'newest' | 'upvotes';
export const FILE_PAGE_SIZE = 30;
type FileRow = {
  id: string;
  original_filename: string;
  mime_type: string;
  file_size: number;
  storage_provider: 'appwrite';
  community_id: string;
  community_name: string;
  owner_id: string;
  uploader_name: string;
  uploader_username: string;
  created_at: string;
  upvote_count: number;
  has_voted: boolean;
};

export async function listFiles(
  communityId?: string,
  sort: FileSort = 'newest',
  offset = 0,
  limit = FILE_PAGE_SIZE,
) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.rpc('list_community_files', {
    p_community_id: communityId ?? null,
    p_sort: sort,
    p_limit: limit,
    p_offset: offset,
  });
  if (error) {
    console.error('[files] list_community_files failed:', {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
    });
    if (error.code === 'PGRST202') {
      throw new Error('File listing is not enabled in this database yet. Apply migrations 006, 007, and 012, then refresh the Supabase schema cache.');
    }
    throw error;
  }
  return ((data ?? []) as FileRow[]).map(row => ({
    id: row.id,
    name: row.original_filename,
    mimeType: row.mime_type,
    size: Number(row.file_size),
    provider: row.storage_provider,
    communityId: row.community_id,
    communityName: row.community_name,
    uploaderId: row.owner_id,
    uploaderName: row.uploader_name,
    uploaderUsername: row.uploader_username,
    uploadedAt: row.created_at,
    upvotes: Number(row.upvote_count),
    hasVoted: row.has_voted,
  })) as StoredFile[];
}

export async function findExactFilename(communityId: string, filename: string) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.from('files')
    .select('id,original_filename,mime_type,file_size,storage_provider,community_id,created_at')
    .eq('community_id', communityId)
    .eq('original_filename', filename)
    .eq('status', 'published')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    id: data.id,
    name: data.original_filename,
    mimeType: data.mime_type,
    size: Number(data.file_size),
    provider: data.storage_provider,
    communityId: data.community_id,
    uploadedAt: data.created_at,
  } as StoredFile;
}

export async function toggleFileVote(fileId: string) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.rpc('toggle_file_vote', { p_file_id: fileId });
  if (error) throw error;
  return Boolean(data);
}

import { createClient } from '@supabase/supabase-js';
import { Readable } from 'node:stream';

function reply(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function developmentError(action, error) {
  return process.env.NODE_ENV === 'production' ? action : `${action}: ${error.message}`;
}

export default async function handler(req, res) {
  if (!['GET', 'POST', 'DELETE'].includes(req.method)) return reply(res, 405, { error: 'Method not allowed' });

  try {
    const cookieToken = String(req.headers.cookie || '').split(';').map(value => value.trim())
      .find(value => value.startsWith('sruxhub_file_session='))?.slice('sruxhub_file_session='.length);
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || cookieToken || '';
    if (!token) return reply(res, 401, { error: 'Sign in required' });

    const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });
    const { data: { user }, error: authError } = await db.auth.getUser(token);
    if (authError || !user) return reply(res, 401, { error: 'Invalid session' });
    if (user.app_metadata?.provider !== 'google' || !user.email_confirmed_at ||
        !/^[^@]+@sru\.edu\.in$/i.test(user.email || '')) {
      return reply(res, 403, { error: 'A verified @sru.edu.in Google account is required' });
    }

    const { data: profile, error: profileError } = await db.from('profiles')
      .select('onboarding_complete').eq('user_id', user.id).maybeSingle();
    if (profileError) return reply(res, 500, { error: developmentError('Could not verify your profile', profileError) });
    if (!profile?.onboarding_complete) return reply(res, 403, { error: 'Complete your SRUXHUB profile first' });

    const id = String(req.query.id || '');
    if (!id) return reply(res, 400, { error: 'File ID is required' });
    const { data: file, error: fileError } = await db.from('files')
      .select('*').eq('id', id).eq('status', 'published').maybeSingle();
    if (fileError) return reply(res, 500, { error: developmentError('Could not load file metadata', fileError) });
    if (!file) return reply(res, 404, { error: 'File unavailable' });

    let membership = null;
    if (file.community_id) {
      const { data: member, error } = await db.from('community_members')
        .select('role').eq('community_id', file.community_id).eq('user_id', user.id).maybeSingle();
      if (error) return reply(res, 500, { error: developmentError('Could not verify community membership', error) });
      membership = member;
    }
    let allowed = file.community_id
      ? file.visibility === 'community'
        ? Boolean(membership)
        : file.owner_id === user.id
      : file.owner_id === user.id;
    if (!allowed && file.visibility === 'community') {
      const { data: links, error } = await db.from('post_attachments')
        .select('posts!post_attachments_post_id_fkey!inner(status)')
        .eq('file_id', file.id).eq('posts.status', 'published').limit(1);
      if (error) return reply(res, 500, { error: developmentError('Could not verify file attachment access', error) });
      allowed = Boolean(links?.length);
    }
    if (!allowed) return reply(res, 403, { error: 'You cannot access this file' });

    if (req.method === 'POST') {
      if (!req.headers.authorization) return reply(res, 401, { error: 'Sign in again to open this file' });
      const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
      res.setHeader('Set-Cookie', `sruxhub_file_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/api/files; Max-Age=1800${secure}`);
      res.statusCode = 204;
      return res.end();
    }

    if (req.method === 'DELETE') {
      if (file.community_id && !membership) return reply(res, 403, { error: 'Join this community before deleting its files' });
      if (file.owner_id !== user.id && !['moderator', 'admin'].includes(membership?.role)) {
        const { data: admin, error } = await isAdmin(db, user.id);
        if (error) return reply(res, 500, { error: developmentError('Could not verify admin access', error) });
        if (!admin) return reply(res, 403, { error: 'Only the owner or a community moderator/admin can delete this file' });
      }
    }

    const safe = {
      id: file.id,
      name: file.original_filename,
      mimeType: file.mime_type,
      size: file.file_size,
      provider: file.storage_provider,
    };
    if (req.method === 'GET' && req.query.metadata) return reply(res, 200, safe);

    const endpoint = process.env.APPWRITE_ENDPOINT;
    const project = process.env.APPWRITE_PROJECT_ID;
    const key = process.env.APPWRITE_API_KEY;
    if (file.storage_provider !== 'appwrite' || !endpoint || !project || !key) {
      return reply(res, 503, { error: 'Storage provider unavailable' });
    }

    const fileUrl = `${endpoint.replace(/\/$/, '')}/storage/buckets/${encodeURIComponent(file.storage_bucket_id)}/files/${encodeURIComponent(file.storage_file_id)}`;
    const storageUrl = req.method === 'GET' ? `${fileUrl}/download` : fileUrl;
    const streamAbort = new AbortController();
    res.once('close', () => { if (!res.writableEnded) streamAbort.abort(); });
    const upstreamHeaders = { 'X-Appwrite-Project': project, 'X-Appwrite-Key': key };
    if (req.method === 'GET' && req.headers.range) upstreamHeaders.Range = req.headers.range;
    const result = await fetch(storageUrl, {
      method: req.method,
      headers: upstreamHeaders,
      signal: streamAbort.signal,
    });
    if (!result.ok && result.status !== 416 && !(req.method === 'DELETE' && result.status === 404)) {
      let providerMessage = '';
      try {
        const providerError = await result.json();
        providerMessage = typeof providerError.message === 'string' ? providerError.message : '';
      } catch { /* A provider error may have an empty or non-JSON body. */ }
      const error = providerMessage || `Appwrite request failed (HTTP ${result.status})`;
      return reply(res, 502, { error: process.env.NODE_ENV === 'production' ? 'Storage provider request failed' : error });
    }

    if (req.method === 'DELETE') {
      const { error } = await db.from('files').update({ status: 'removed' }).eq('id', file.id);
      if (error) return reply(res, 500, { error: developmentError('File was removed from storage but metadata could not be updated', error) });
      res.statusCode = 204;
      return res.end();
    }

    if (result.status === 416) {
      if (result.headers.get('content-range')) res.setHeader('Content-Range', result.headers.get('content-range'));
      res.statusCode = 416;
      return res.end();
    }
    if (!result.body) return reply(res, 502, { error: 'Storage provider returned an empty download' });
    res.statusCode = result.status === 206 ? 206 : 200;
    const inlineTypes = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'text/plain', 'text/csv', 'text/markdown']);
    const safeMime = String(file.mime_type || '').split(';')[0].trim().toLowerCase();
    const inline = req.query.inline === '1' && inlineTypes.has(safeMime);
    res.setHeader('Content-Type', inline ? safeMime : 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.original_filename)}`);
    res.setHeader('Accept-Ranges', result.headers.get('accept-ranges') || (result.status === 206 ? 'bytes' : 'none'));
    for (const header of ['content-length', 'content-range']) {
      const value = result.headers.get(header);
      if (value) res.setHeader(header === 'content-length' ? 'Content-Length' : 'Content-Range', value);
    }
    if (result.status === 200 && !result.headers.get('content-length')) res.setHeader('Content-Length', String(file.file_size));
    res.setHeader('Cache-Control', 'private, no-store');
    const upstream = Readable.fromWeb(result.body);
    res.once('close', () => { if (!res.writableEnded) upstream.destroy(); });
    upstream.on('error', error => {
      console.error('[api/files/download] stream failed:', error instanceof Error ? error.message : 'Unknown stream error');
      if (!res.headersSent) reply(res, 502, { error: 'Storage provider download failed' });
      else res.destroy(error instanceof Error ? error : undefined);
    }).pipe(res);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'File request failed';
    console.error(`[api/files/${req.method === 'DELETE' ? 'delete' : 'download'}] request failed:`, message);
    return reply(res, 500, { error: process.env.NODE_ENV === 'production' ? 'File request failed' : message });
  }
}

async function isAdmin(db, userId) {
  const { data, error } = await db.from('community_members')
    .select('community_id').eq('user_id', userId).eq('role', 'admin').limit(1);
  return { data: Boolean(data?.length), error };
}

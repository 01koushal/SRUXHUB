import { createClient } from '@supabase/supabase-js';

function reply(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function developmentError(action, error) {
  return process.env.NODE_ENV === 'production' ? action : `${action}: ${error.message}`;
}

export default async function handler(req, res) {
  if (!['GET', 'DELETE'].includes(req.method)) return reply(res, 405, { error: 'Method not allowed' });

  try {
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
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

    let allowed = file.owner_id === user.id;
    if (!allowed && file.visibility === 'community' && file.community_id) {
      const { data: member, error } = await db.from('community_members')
        .select('community_id').eq('community_id', file.community_id).eq('user_id', user.id).maybeSingle();
      if (error) return reply(res, 500, { error: developmentError('Could not verify community membership', error) });
      allowed = Boolean(member);
    }
    if (!allowed && file.visibility === 'community') {
      const { data: links, error } = await db.from('post_attachments')
        .select('posts!post_attachments_post_id_fkey!inner(status)')
        .eq('file_id', file.id).eq('posts.status', 'published').limit(1);
      if (error) return reply(res, 500, { error: developmentError('Could not verify file attachment access', error) });
      allowed = Boolean(links?.length);
    }
    if (!allowed) return reply(res, 403, { error: 'You cannot access this file' });

    if (req.method === 'DELETE' && file.owner_id !== user.id) {
      const { data: admin, error } = await isAdmin(db, user.id);
      if (error) return reply(res, 500, { error: developmentError('Could not verify admin access', error) });
      if (!admin) return reply(res, 403, { error: 'Only the owner or an admin can delete this file' });
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
    const result = await fetch(storageUrl, {
      method: req.method,
      headers: { 'X-Appwrite-Project': project, 'X-Appwrite-Key': key },
    });
    if (!result.ok) {
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

    res.statusCode = 200;
    res.setHeader('Content-Type', file.mime_type);
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.original_filename)}`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.end(Buffer.from(await result.arrayBuffer()));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'File request failed';
    return reply(res, 500, { error: process.env.NODE_ENV === 'production' ? 'File request failed' : message });
  }
}

async function isAdmin(db, userId) {
  const { data, error } = await db.from('community_members')
    .select('community_id').eq('user_id', userId).eq('role', 'admin').limit(1);
  return { data: Boolean(data?.length), error };
}

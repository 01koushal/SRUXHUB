import { createHash, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const MAX_FILE_SIZE = 300 * 1024 * 1024;
const TOKEN_EXPIRY_SECONDS = 10 * 60;
export const APPWRITE_CUSTOM_TOKEN_EXPIRY_SECONDS = 3600;
const allowedTypes = new Map([
  ['image/jpeg', 'jpg'], ['image/png', 'png'], ['image/webp', 'webp'], ['image/gif', 'gif'],
  ['application/pdf', 'pdf'], ['application/vnd.ms-powerpoint', 'ppt'],
  ['application/vnd.openxmlformats-officedocument.presentationml.presentation', 'pptx'],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'docx'],
  ['application/zip', 'zip'], ['application/x-zip-compressed', 'zip'],
]);

function reply(res, status, body) { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)); }
function fail(status, message, extra = {}) { return Object.assign(new Error(message), { status, extra }); }
function admin() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw fail(503, 'Supabase server access is not configured.');
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}
function appwrite() {
  const { APPWRITE_ENDPOINT: endpoint, APPWRITE_PROJECT_ID: project, APPWRITE_API_KEY: key, APPWRITE_BUCKET_ID: bucket } = process.env;
  if (!endpoint || !project || !key || !bucket) throw fail(503, 'Appwrite storage is not configured.');
  return { endpoint: endpoint.replace(/\/$/, ''), project, key, bucket };
}
async function body(req) {
  const parts = []; let size = 0;
  for await (const part of req) { size += part.length; if (size > 65536) throw fail(413, 'Upload authorization requests are too large.'); parts.push(part); }
  try { return JSON.parse(Buffer.concat(parts).toString('utf8') || '{}'); } catch { throw fail(400, 'Invalid request body.'); }
}
function nameOf(value) {
  const name = String(value || '').replace(/[\\/\0-\x1f]/g, '_').trim().slice(0, 180);
  if (!name || name === '.' || name === '..') throw fail(400, 'A filename is required.');
  return name;
}
function validate(name, mime, size) {
  if (!Number.isInteger(size) || size < 1 || size > MAX_FILE_SIZE) throw fail(413, 'Maximum file size is 300 MB.');
  if (allowedTypes.get(mime) === undefined || !name.toLowerCase().endsWith(`.${allowedTypes.get(mime)}`)) throw fail(415, 'File type and extension are not allowed.');
}
async function userFrom(req, db) {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) throw fail(401, 'Sign in required.');
  const { data: { user }, error } = await db.auth.getUser(token);
  if (error || !user) throw fail(401, 'Invalid session.');
  if (user.app_metadata?.provider !== 'google' || !user.email_confirmed_at || !/^[^@]+@sru\.edu\.in$/i.test(user.email || '')) throw fail(403, 'A verified @sru.edu.in Google account is required.');
  const { data: profile, error: profileError } = await db.from('profiles').select('onboarding_complete').eq('user_id', user.id).maybeSingle();
  if (profileError || !profile?.onboarding_complete) throw fail(403, 'Complete your SRUXHUB profile first.');
  return user;
}
async function member(db, communityId, userId) {
  const { data, error } = await db.from('community_members').select('community_id').eq('community_id', communityId).eq('user_id', userId).maybeSingle();
  if (error) throw fail(500, 'Could not verify community membership.');
  if (!data) throw fail(403, 'Join this community before uploading.');
}
async function appwriteJson(config, path, init = {}) {
  const response = await fetch(`${config.endpoint}${path}`, { ...init, headers: { 'X-Appwrite-Project': config.project, 'X-Appwrite-Key': config.key, ...(init.headers || {}) } });
  let result = {}; try { result = await response.json(); } catch { /* HTTP status is logged by caller. */ }
  if (!response.ok) {
    console.error('[api/files/direct] Appwrite request failed:', { path, status: response.status, message: result.message || null, type: result.type || null });
    throw Object.assign(fail(502, result.message || `Appwrite request failed (HTTP ${response.status}).`), {
      providerStatus: response.status,
      providerType: result.type || null,
    });
  }
  return result;
}
function appwriteUserId(supabaseId) { return `sru_${supabaseId.replaceAll('-', '')}`; }
async function ensureAppwriteUser(config, user) {
  const id = appwriteUserId(user.id);
  try { await appwriteJson(config, `/users/${encodeURIComponent(id)}`); } catch (error) {
    if (error.providerStatus === 401 || error.providerStatus === 403) {
      throw fail(503, 'The Appwrite API key needs the users.read and users.write scopes for direct uploads.');
    }
    if (error.providerStatus !== 404) throw error;
    try {
      await appwriteJson(config, '/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: id, email: user.email, name: String(user.user_metadata?.full_name || user.user_metadata?.name || user.email).slice(0, 128) }) });
    } catch (createError) {
      // A concurrent first request may have created the deterministic user.
      if (createError.providerStatus !== 409) throw createError;
    }
  }
  return id;
}
async function hashStored(config, fileId) {
  const response = await fetch(`${config.endpoint}/storage/buckets/${encodeURIComponent(config.bucket)}/files/${encodeURIComponent(fileId)}/download`, { headers: { 'X-Appwrite-Project': config.project, 'X-Appwrite-Key': config.key } });
  if (!response.ok || !response.body) throw fail(502, 'Could not verify the uploaded file.');
  const hash = createHash('sha256'); let size = 0;
  for await (const chunk of response.body) { size += chunk.length; hash.update(chunk); }
  return { sha256: hash.digest('hex'), size };
}
async function deleteStored(config, fileId) {
  await fetch(`${config.endpoint}/storage/buckets/${encodeURIComponent(config.bucket)}/files/${encodeURIComponent(fileId)}`, { method: 'DELETE', headers: { 'X-Appwrite-Project': config.project, 'X-Appwrite-Key': config.key } });
}
async function cleanupExpired(db, config) {
  const { data, error } = await db.from('direct_upload_sessions').select('id,storage_file_id').eq('status', 'authorized').lt('expires_at', new Date().toISOString()).limit(20);
  if (error) { console.error('[api/files/direct] expired-session lookup failed:', error.message); return; }
  for (const session of data || []) {
    await deleteStored(config, session.storage_file_id);
    await db.from('direct_upload_sessions').update({ status: 'expired', updated_at: new Date().toISOString() }).eq('id', session.id);
  }
}
async function authorize(req, db, config, user, input) {
  const communityId = String(input.communityId || ''); const name = nameOf(input.name); const mime = String(input.mime || '').split(';')[0].toLowerCase(); const size = Number(input.size);
  validate(name, mime, size); await member(db, communityId, user.id); await cleanupExpired(db, config);
  const bucket = await appwriteJson(config, `/storage/buckets/${encodeURIComponent(config.bucket)}`);
  if (!bucket.fileSecurity || !Array.isArray(bucket.$permissions) || !bucket.$permissions.includes('create("users")')) {
    throw fail(503, 'Direct uploads require Appwrite File Security and Create permission for authenticated users. See docs/APPWRITE_SETUP.md.');
  }
  const appwriteUserId = await ensureAppwriteUser(config, user);
  const storageFileId = randomUUID(); const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_SECONDS * 1000).toISOString();
  const { data: session, error } = await db.from('direct_upload_sessions').insert({ owner_id: user.id, community_id: communityId, storage_file_id: storageFileId, appwrite_user_id: appwriteUserId, original_filename: name, mime_type: mime, total_size: size, expires_at: expiresAt }).select('*').single();
  if (error) throw fail(500, 'Could not authorize this upload. Apply migration 009 before retrying.');
  const token = await appwriteJson(config, `/users/${encodeURIComponent(appwriteUserId)}/tokens`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ length: 32, expire: APPWRITE_CUSTOM_TOKEN_EXPIRY_SECONDS }) });
  if (!token.secret) throw fail(502, 'Appwrite did not issue an upload token.');
  return { uploadId: session.id, userId: appwriteUserId, secret: token.secret, fileId: storageFileId, endpoint: config.endpoint, projectId: config.project, bucketId: config.bucket, expiresAt };
}
async function finalize(db, config, user, input) {
  const id = String(input.uploadId || ''); const { data: session, error } = await db.from('direct_upload_sessions').select('*').eq('id', id).eq('owner_id', user.id).maybeSingle();
  if (error || !session || session.status !== 'authorized' || Date.parse(session.expires_at) < Date.now()) throw fail(410, 'Upload authorization expired. Start the upload again.');
  await member(db, session.community_id, user.id);
  const stored = await appwriteJson(config, `/storage/buckets/${encodeURIComponent(config.bucket)}/files/${encodeURIComponent(session.storage_file_id)}`);
  if (stored.$sizeOriginal !== Number(session.total_size) || stored.$sizeOriginal > MAX_FILE_SIZE || stored.name !== session.original_filename || stored.mimeType !== session.mime_type) throw fail(400, 'Uploaded file metadata does not match its authorization.');
  if (!Array.isArray(stored.$permissions) || !stored.$permissions.includes(`read("user:${session.appwrite_user_id}")`)) {
    throw fail(403, 'Uploaded file ownership could not be verified.');
  }
  const { sha256, size } = await hashStored(config, session.storage_file_id);
  const { data: duplicate } = await db.from('files').select('id,original_filename,mime_type,file_size,storage_provider,community_id,owner_id,created_at').eq('community_id', session.community_id).eq('sha256', sha256).eq('status', 'published').maybeSingle();
  if (duplicate) { await deleteStored(config, session.storage_file_id); await db.from('direct_upload_sessions').update({ status: 'cancelled' }).eq('id', id); throw fail(409, 'This exact file has already been shared in this community.', { existingFile: { id: duplicate.id, name: duplicate.original_filename, mimeType: duplicate.mime_type, size: Number(duplicate.file_size), provider: duplicate.storage_provider } }); }
  await appwriteJson(config, `/storage/buckets/${encodeURIComponent(config.bucket)}/files/${encodeURIComponent(session.storage_file_id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: session.original_filename, permissions: [] }) });
  const { data: file, error: insertError } = await db.from('files').insert({ owner_id: user.id, community_id: session.community_id, storage_provider: 'appwrite', storage_file_id: session.storage_file_id, storage_bucket_id: config.bucket, original_filename: session.original_filename, mime_type: session.mime_type, file_size: size, sha256, category: session.mime_type.startsWith('image/') ? 'image' : 'resource', visibility: 'community' }).select('id,original_filename,mime_type,file_size,storage_provider,community_id,owner_id,created_at').single();
  if (insertError) { await deleteStored(config, session.storage_file_id); throw fail(500, 'Could not save file metadata.'); }
  await db.from('direct_upload_sessions').update({ status: 'finalized' }).eq('id', id);
  return { id: file.id, name: file.original_filename, mimeType: file.mime_type, size: Number(file.file_size), provider: file.storage_provider, communityId: file.community_id, uploaderId: file.owner_id, uploadedAt: file.created_at };
}
async function cancel(db, config, user, input) {
  const id = String(input.uploadId || '');
  const { data: session, error } = await db.from('direct_upload_sessions').select('*').eq('id', id).eq('owner_id', user.id).maybeSingle();
  if (error) throw fail(500, 'Could not cancel this upload.');
  if (session?.status === 'authorized') {
    await deleteStored(config, session.storage_file_id);
    await db.from('direct_upload_sessions').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('id', id);
  }
  return { cancelled: true };
}
export default async function handler(req, res) {
  if (req.method !== 'POST') return reply(res, 405, { error: 'Method not allowed.' });
  try {
    const db = admin(); const config = appwrite(); const user = await userFrom(req, db); const input = await body(req);
    const result = input.action === 'authorize' ? await authorize(req, db, config, user, input) : input.action === 'finalize' ? await finalize(db, config, user, input) : input.action === 'cancel' ? await cancel(db, config, user, input) : (() => { throw fail(400, 'Unknown upload action.'); })();
    reply(res, 200, result);
  } catch (error) { const status = Number.isInteger(error?.status) ? error.status : 500; if (status >= 500) console.error('[api/files/direct] request failed:', error.message); reply(res, status, { error: error.message || 'Upload failed.', ...(error.extra || {}) }); }
}

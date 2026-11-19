import { createHash, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

export const config = { api: { bodyParser: false, sizeLimit: '4mb' } };

const MAX_FILE_SIZE = 300 * 1024 * 1024;
const MAX_CHUNK_SIZE = 3 * 1024 * 1024;
const APPWRITE_CHUNK_SIZE = 5 * 1024 * 1024;
const SESSION_MAX_AGE = 24 * 60 * 60 * 1000;
const allowedTypes = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['image/gif', 'gif'],
  ['application/pdf', 'pdf'],
  ['application/vnd.openxmlformats-officedocument.presentationml.presentation', 'pptx'],
  ['application/vnd.ms-powerpoint', 'ppt'],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'docx'],
  ['application/zip', 'zip'],
  ['application/x-zip-compressed', 'zip'],
]);

function reply(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function requestError(status, message, extra = {}) {
  return Object.assign(new Error(message), { status, extra });
}

function missingUploadSessionTable(error) {
  return error?.code === 'PGRST205' || error?.code === '42P01';
}

function missingUploadStaging(error) {
  return error?.code === 'PGRST204' || /received_offset|pending_bytes|upload_status/i.test(error?.message || '');
}

function asBytea(bytes) {
  return `\\x${bytes.toString('hex')}`;
}

function fromBytea(value) {
  if (typeof value !== 'string' || !value.startsWith('\\x')) {
    throw requestError(500, 'Upload session data is invalid. Start the upload again.');
  }
  return Buffer.from(value.slice(2), 'hex');
}

async function readChunk(req) {
  const chunks = [];
  let size = 0;
  for await (const part of req) {
    size += part.length;
    if (size > MAX_CHUNK_SIZE) throw requestError(413, 'Upload chunks cannot exceed 3 MB.');
    chunks.push(part);
  }
  if (!size) throw requestError(400, 'Upload chunk is empty.');
  return Buffer.concat(chunks);
}

function allowedFile(name, mime, bytes, isFirstChunk) {
  const extension = allowedTypes.get(mime);
  if (!extension || !name.toLowerCase().endsWith(`.${extension}`)) {
    throw requestError(415, 'File type and extension are not allowed.');
  }
  if (!isFirstChunk) return;
  if (mime === 'application/pdf' && bytes.subarray(0, 5).toString() !== '%PDF-') {
    throw requestError(415, 'File content does not match PDF type.');
  }
  if (mime === 'image/png' && bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
    throw requestError(415, 'File content does not match PNG type.');
  }
  if (mime === 'image/jpeg' && !(bytes[0] === 0xff && bytes[1] === 0xd8)) {
    throw requestError(415, 'File content does not match JPEG type.');
  }
  if (mime === 'application/zip' || mime === 'application/x-zip-compressed') {
    const signature = bytes.subarray(0, 4).toString('hex');
    if (!['504b0304', '504b0506', '504b0708'].includes(signature)) {
      throw requestError(415, 'File content does not match ZIP type.');
    }
  }
}

function readFilename(value) {
  let decoded;
  try {
    decoded = decodeURIComponent(String(value || ''));
  } catch {
    throw requestError(400, 'Invalid filename encoding.');
  }
  const name = decoded.replace(/[\\/\0-\x1f]/g, '_').trim().slice(0, 180);
  if (!name || name === '.' || name === '..') throw requestError(400, 'A filename is required.');
  return name;
}

function createAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw requestError(503, 'Supabase server access is not configured.');
  return createClient(url, key, { auth: { persistSession: false } });
}

async function authenticate(req, db) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) throw requestError(401, 'Sign in required.');
  const { data: { user }, error } = await db.auth.getUser(token);
  if (error || !user) throw requestError(401, 'Invalid session.');
  if (user.app_metadata?.provider !== 'google' || !user.email_confirmed_at ||
      !/^[^@]+@sru\.edu\.in$/i.test(user.email || '')) {
    throw requestError(403, 'A verified @sru.edu.in Google account is required.');
  }

  const { data: profile, error: profileError } = await db.from('profiles')
    .select('onboarding_complete').eq('user_id', user.id).maybeSingle();
  if (profileError) {
    console.error('[api/files/upload] profile lookup failed:', profileError.message);
    throw requestError(500, 'Could not verify your SRUXHUB profile.');
  }
  if (!profile?.onboarding_complete) throw requestError(403, 'Complete your SRUXHUB profile first.');
  return user;
}

async function assertCommunityMember(db, communityId, userId) {
  if (!communityId) throw requestError(400, 'Choose a community for this upload.');
  const { data, error } = await db.from('community_members')
    .select('community_id').eq('community_id', communityId).eq('user_id', userId).maybeSingle();
  if (error) {
    console.error('[api/files/upload] membership lookup failed:', error.message);
    throw requestError(500, 'Could not verify community membership.');
  }
  if (!data) throw requestError(403, 'Join this community before uploading.');
}

function storageConfig() {
  const endpoint = process.env.APPWRITE_ENDPOINT;
  const project = process.env.APPWRITE_PROJECT_ID;
  const key = process.env.APPWRITE_API_KEY;
  const bucket = process.env.APPWRITE_BUCKET_ID;
  if (!endpoint || !project || !key || !bucket) throw requestError(503, 'Appwrite storage is not configured.');
  return { endpoint: endpoint.replace(/\/$/, ''), project, key, bucket };
}

async function appwriteRequest(config, { fileId, bytes, range, name, mime, chunkNumber, start, end, totalSize, sessionOffsetBefore, isInitial }) {
  const form = new FormData();
  form.append('fileId', fileId);
  form.append('file', new Blob([bytes], { type: mime }), name);
  const headers = {
    'X-Appwrite-Project': config.project,
    'X-Appwrite-Key': config.key,
  };
  if (range) {
    // Appwrite uses Content-Range for every partial request. The initial
    // request creates the file; only later chunks identify that existing file.
    // Sending X-Appwrite-ID on chunk one asks Appwrite to append to an ID that
    // does not exist yet, which breaks uploads as soon as they need chunking.
    if (!isInitial) headers['X-Appwrite-ID'] = fileId;
    headers['Content-Range'] = range;
  }
  const result = await fetch(`${config.endpoint}/storage/buckets/${encodeURIComponent(config.bucket)}/files`, {
    method: 'POST',
    headers,
    body: form,
  });
  let body = {};
  try { body = await result.json(); } catch { /* Provider may return an empty response. */ }
  const message = typeof body.message === 'string' ? body.message : '';
  const returnedFileId = typeof body.$id === 'string' ? body.$id : '';
  const diagnostic = {
    chunkNumber,
    startOffset: start,
    endOffset: end,
    totalSize,
    receivedBytes: bytes.length,
    sessionOffsetBefore,
    appwriteStatus: result.status,
    appwriteFileId: returnedFileId || null,
    expectedFileId: fileId,
    appwriteError: message || null,
  };
  if (!result.ok) {
    console.error('[api/files/upload] Appwrite chunk rejected:', diagnostic);
    throw requestError(502, message || `Appwrite upload failed (HTTP ${result.status}).`);
  }
  console.info('[api/files/upload] Appwrite chunk accepted:', diagnostic);
  if (!returnedFileId) throw requestError(502, 'Appwrite accepted a chunk without returning its file ID.');
  if (returnedFileId !== fileId) {
    console.error('[api/files/upload] Appwrite returned an unexpected file ID:', diagnostic);
    throw requestError(502, 'Appwrite returned an unexpected file ID for this upload.');
  }
  return returnedFileId;
}

async function deleteStoredFile(config, fileId) {
  try {
    const result = await fetch(`${config.endpoint}/storage/buckets/${encodeURIComponent(config.bucket)}/files/${encodeURIComponent(fileId)}`, {
      method: 'DELETE',
      headers: { 'X-Appwrite-Project': config.project, 'X-Appwrite-Key': config.key },
    });
    if (result.ok || result.status === 404) return true;
    console.error('[api/files/upload] Appwrite cleanup failed:', { status: result.status, fileId });
  } catch (error) {
    console.error('[api/files/upload] Appwrite cleanup request failed:', error instanceof Error ? error.message : 'Unknown error');
  }
  return false;
}

async function cleanupSession(db, config, session) {
  const { data: published, error: lookupError } = await db.from('files')
    .select('id').eq('storage_file_id', session.storage_file_id).eq('status', 'published').maybeSingle();
  if (lookupError) {
    console.error('[api/files/upload] cleanup metadata lookup failed:', lookupError.message);
    return false;
  }
  if (published) {
    const { error } = await db.from('file_upload_sessions').delete().eq('id', session.id);
    if (error) console.error('[api/files/upload] completed session cleanup failed:', error.message);
    return !error;
  }
  if (!await deleteStoredFile(config, session.storage_file_id)) return false;
  const { error } = await db.from('file_upload_sessions').delete().eq('id', session.id);
  if (error) console.error('[api/files/upload] upload session cleanup failed:', error.message);
  return !error;
}

async function cleanupExpiredSessions(db, config) {
  const cutoff = new Date(Date.now() - SESSION_MAX_AGE).toISOString();
  const { data, error } = await db.from('file_upload_sessions')
    .select('id,storage_file_id').lt('created_at', cutoff).limit(20);
  if (error) {
    console.error('[api/files/upload] expired session lookup failed:', error.message);
    return;
  }
  for (const session of data || []) await cleanupSession(db, config, session);
}

async function hashStoredFile(config, fileId) {
  const response = await fetch(`${config.endpoint}/storage/buckets/${encodeURIComponent(config.bucket)}/files/${encodeURIComponent(fileId)}/download`, {
    headers: { 'X-Appwrite-Project': config.project, 'X-Appwrite-Key': config.key },
  });
  if (!response.ok || !response.body) {
    console.error('[api/files/upload] Appwrite checksum download failed:', { status: response.status, fileId });
    throw requestError(502, 'Could not verify the stored file.');
  }
  const hash = createHash('sha256');
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    hash.update(chunk);
  }
  return { sha256: hash.digest('hex'), size };
}

function clientFile(file) {
  return {
    id: file.id,
    name: file.original_filename,
    mimeType: file.mime_type,
    size: Number(file.file_size),
    provider: file.storage_provider,
    communityId: file.community_id,
    uploaderId: file.owner_id,
    uploadedAt: file.created_at,
  };
}

async function completeSession(db, config, session) {
  const { sha256, size } = await hashStoredFile(config, session.storage_file_id);
  if (size !== Number(session.total_size)) throw requestError(502, 'Stored file size does not match the upload.');

  const duplicateResult = await db.from('files')
    .select('id,original_filename,mime_type,file_size,storage_provider,community_id,owner_id,created_at')
    .eq('community_id', session.community_id).eq('sha256', sha256)
    .eq('status', 'published').maybeSingle();
  if (duplicateResult.error) throw requestError(500, 'Could not check for duplicate file content.');
  if (duplicateResult.data) {
    await cleanupSession(db, config, session);
    throw requestError(409, 'This exact file has already been shared in this community.', {
      existingFile: clientFile(duplicateResult.data),
    });
  }

  const { data: file, error } = await db.from('files').insert({
    owner_id: session.owner_id,
    community_id: session.community_id,
    storage_provider: 'appwrite',
    storage_file_id: session.storage_file_id,
    storage_bucket_id: config.bucket,
    original_filename: session.original_filename,
    mime_type: session.mime_type,
    file_size: size,
    sha256,
    category: session.mime_type.startsWith('image/') ? 'image' : 'resource',
    visibility: 'community',
  }).select('id,original_filename,mime_type,file_size,storage_provider,community_id,owner_id,created_at').single();

  if (error) {
    // The database index is the final guard when identical uploads finish together.
    if (error.code === '23505') {
      const duplicate = await db.from('files')
        .select('id,original_filename,mime_type,file_size,storage_provider,community_id,owner_id,created_at')
        .eq('community_id', session.community_id).eq('sha256', sha256)
        .eq('status', 'published').maybeSingle();
      await cleanupSession(db, config, session);
      if (duplicate.data) {
        throw requestError(409, 'This exact file has already been shared in this community.', {
          existingFile: clientFile(duplicate.data),
        });
      }
    }
    console.error('[api/files/upload] Supabase metadata insert failed:', error.message);
    await cleanupSession(db, config, session);
    throw requestError(500, 'Could not save file metadata.');
  }

  const { error: sessionError } = await db.from('file_upload_sessions').delete().eq('id', session.id);
  if (sessionError) console.error('[api/files/upload] completed session cleanup failed:', sessionError.message);
  return clientFile(file);
}

async function flushReadyAppwriteChunk(db, config, session) {
  const pending = fromBytea(session.pending_bytes);
  const receivedOffset = Number(session.received_offset);
  const committedOffset = Number(session.next_offset);
  const totalSize = Number(session.total_size);
  const isFinal = receivedOffset === totalSize;
  const readySize = isFinal ? pending.length : APPWRITE_CHUNK_SIZE;

  if (pending.length < readySize) return session;
  if (receivedOffset - pending.length !== committedOffset) {
    console.error('[api/files/upload] invalid staged upload offsets:', {
      sessionId: session.id,
      receivedOffset,
      committedOffset,
      pendingBytes: pending.length,
    });
    throw requestError(500, 'Upload session data is inconsistent. Start the upload again.');
  }

  const bytes = pending.subarray(0, readySize);
  const end = committedOffset + bytes.length;
  const isInitial = committedOffset === 0;
  const range = bytes.length < totalSize ? `bytes ${committedOffset}-${end - 1}/${totalSize}` : undefined;
  const chunkNumber = Math.floor(committedOffset / APPWRITE_CHUNK_SIZE) + 1;
  await appwriteRequest(config, {
    fileId: session.storage_file_id,
    bytes,
    range,
    name: session.original_filename,
    mime: session.mime_type,
    chunkNumber,
    start: committedOffset,
    end: end - 1,
    totalSize,
    sessionOffsetBefore: committedOffset,
    isInitial,
  });

  const remaining = pending.subarray(readySize);
  const { data: advanced, error } = await db.from('file_upload_sessions')
    .update({
      next_offset: end,
      pending_bytes: asBytea(remaining),
      upload_status: end === totalSize ? 'stored' : 'receiving',
      updated_at: new Date().toISOString(),
    })
    .eq('id', session.id)
    .eq('next_offset', committedOffset)
    .eq('received_offset', receivedOffset)
    .select('*')
    .single();
  if (error || !advanced) {
    console.error('[api/files/upload] Appwrite-confirmed session advance failed:', error?.message || 'Session changed concurrently');
    throw requestError(500, 'Could not record the uploaded chunk. Retry this file.');
  }
  console.info('[api/files/upload] session offset advanced:', {
    sessionId: session.id,
    chunkNumber,
    sessionOffsetBefore: committedOffset,
    sessionOffsetAfter: end,
    receivedOffset: Number(advanced.received_offset),
    stagedBytes: remaining.length,
  });
  return advanced;
}

async function startUpload(req, db, config, user) {
  const communityId = String(req.headers['x-community-id'] || '');
  await assertCommunityMember(db, communityId, user.id);
  const name = readFilename(req.headers['x-file-name']);
  const mime = String(req.headers['x-file-mime'] || '').split(';')[0].toLowerCase();
  const totalSize = Number(req.headers['x-file-size']);
  if (!Number.isInteger(totalSize) || totalSize <= 0 || totalSize > MAX_FILE_SIZE) {
    throw requestError(413, 'Maximum file size is 300 MB.');
  }
  const bytes = await readChunk(req);
  if (bytes.length > totalSize) throw requestError(400, 'Upload chunk exceeds the declared file size.');
  allowedFile(name, mime, bytes, true);
  console.info('[api/files/upload] chunk received:', {
    chunkNumber: 1,
    startOffset: 0,
    endOffset: bytes.length - 1,
    totalSize,
    receivedBytes: bytes.length,
    sessionOffsetBefore: 0,
  });

  const fileId = randomUUID();
  const { data: session, error } = await db.from('file_upload_sessions').insert({
    owner_id: user.id,
    community_id: communityId,
    storage_file_id: fileId,
    original_filename: name,
    mime_type: mime,
    total_size: totalSize,
    next_offset: 0,
    received_offset: bytes.length,
    pending_bytes: asBytea(bytes),
    upload_status: 'receiving',
  }).select('*').single();
  if (error) {
    console.error('[api/files/upload] upload session create failed:', error.message);
    if (missingUploadSessionTable(error)) {
      throw requestError(503, 'File uploads are not enabled in this database yet. Apply migrations 006 and 007, then retry.');
    }
    if (missingUploadStaging(error)) {
      throw requestError(503, 'Large-file uploads are not enabled in this database yet. Apply migration 008, then retry.');
    }
    throw requestError(500, 'Could not start the file upload.');
  }
  console.info('[api/files/upload] chunk staged:', {
    chunkNumber: 1,
    receivedOffsetBefore: 0,
    receivedOffsetAfter: bytes.length,
    sessionOffsetBefore: 0,
    sessionOffsetAfter: 0,
    appwriteStatus: bytes.length < totalSize && bytes.length < APPWRITE_CHUNK_SIZE ? 'waiting for 5 MiB provider chunk' : 'ready to send',
  });

  try {
    const advanced = await flushReadyAppwriteChunk(db, config, session);
    if (Number(advanced.next_offset) === totalSize) {
      const file = await completeSession(db, config, advanced);
      return { status: 201, body: file };
    }
    return { status: 200, body: { uploadSessionId: advanced.id, nextOffset: Number(advanced.received_offset), totalSize } };
  } catch (error) {
    await cleanupSession(db, config, session);
    throw error;
  }
}

async function continueUpload(req, db, config, user) {
  const id = String(req.headers['x-upload-session'] || '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw requestError(400, 'Upload session is invalid.');
  const { data: session, error } = await db.from('file_upload_sessions').select('*')
    .eq('id', id).eq('owner_id', user.id).maybeSingle();
  if (error) throw requestError(500, 'Could not load the upload session.');
  if (!session) throw requestError(404, 'Upload session expired. Start the upload again.');
  if (session.upload_status !== 'receiving') {
    await cleanupSession(db, config, session);
    throw requestError(410, 'This upload session cannot continue. Select the file again to restart.');
  }
  if (Date.now() - Date.parse(session.created_at) >= SESSION_MAX_AGE) {
    await cleanupSession(db, config, session);
    throw requestError(410, 'Upload session expired. Select the file again to restart.');
  }
  await assertCommunityMember(db, session.community_id, user.id);

  const declaredSize = Number(req.headers['x-file-size']);
  if (declaredSize !== Number(session.total_size) ||
      readFilename(req.headers['x-file-name']) !== session.original_filename ||
      String(req.headers['x-file-mime'] || '') !== session.mime_type) {
    throw requestError(400, 'Upload metadata changed during transfer.');
  }

  const bytes = await readChunk(req);
  const receivedStart = Number(session.received_offset);
  const receivedEnd = receivedStart + bytes.length;
  if (receivedEnd > Number(session.total_size)) throw requestError(400, 'Upload chunk exceeds the declared file size.');
  allowedFile(session.original_filename, session.mime_type, bytes, false);
  const chunkNumber = Math.floor(receivedStart / MAX_CHUNK_SIZE) + 1;
  console.info('[api/files/upload] chunk received:', {
    chunkNumber,
    startOffset: receivedStart,
    endOffset: receivedEnd - 1,
    totalSize: Number(session.total_size),
    receivedBytes: bytes.length,
    sessionOffsetBefore: Number(session.next_offset),
  });
  const pending = Buffer.concat([fromBytea(session.pending_bytes), bytes]);
  const { data: buffered, error: bufferError } = await db.from('file_upload_sessions')
    .update({
      received_offset: receivedEnd,
      pending_bytes: asBytea(pending),
      upload_status: 'receiving',
      updated_at: new Date().toISOString(),
    })
    .eq('id', session.id)
    .eq('received_offset', receivedStart)
    .select('*')
    .single();
  if (bufferError || !buffered) {
    console.error('[api/files/upload] session staging update failed:', bufferError?.message || 'Session changed concurrently');
    throw requestError(500, 'Could not store this upload chunk. Retry the chunk.');
  }
  console.info('[api/files/upload] chunk staged:', {
    chunkNumber,
    receivedOffsetBefore: receivedStart,
    receivedOffsetAfter: receivedEnd,
    sessionOffsetBefore: Number(session.next_offset),
    sessionOffsetAfter: Number(buffered.next_offset),
    appwriteStatus: receivedEnd < Number(session.total_size) && pending.length < APPWRITE_CHUNK_SIZE ? 'waiting for 5 MiB provider chunk' : 'ready to send',
  });

  const advanced = await flushReadyAppwriteChunk(db, config, buffered);
  if (Number(advanced.next_offset) === Number(session.total_size)) {
    const file = await completeSession(db, config, advanced);
    return { status: 201, body: file };
  }
  return {
    status: 200,
    body: { uploadSessionId: advanced.id, nextOffset: Number(advanced.received_offset), totalSize: Number(advanced.total_size) },
  };
}

async function cancelUpload(req, db, config, user) {
  const id = String(req.headers['x-upload-session'] || '');
  const { data: session, error } = await db.from('file_upload_sessions').select('*')
    .eq('id', id).eq('owner_id', user.id).maybeSingle();
  if (error) throw requestError(500, 'Could not load the upload session.');
  if (session) await cleanupSession(db, config, session);
  return { status: 200, body: { cancelled: true } };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return reply(res, 405, { error: 'Method not allowed.' });
  if (!(req.headers.authorization || '').replace(/^Bearer\s+/i, '')) {
    return reply(res, 401, { error: 'Sign in required.' });
  }
  let db;
  let config;
  let session;
  try {
    db = createAdmin();
    config = storageConfig();
    const user = await authenticate(req, db);
    const action = String(req.headers['x-upload-action'] || 'start');
    let result;
    if (action === 'start') {
      await cleanupExpiredSessions(db, config);
      result = await startUpload(req, db, config, user);
    } else if (action === 'chunk') {
      result = await continueUpload(req, db, config, user);
    } else if (action === 'cancel') {
      result = await cancelUpload(req, db, config, user);
    } else {
      throw requestError(400, 'Unknown upload action.');
    }
    return reply(res, result.status, result.body);
  } catch (error) {
    const status = Number.isInteger(error?.status) ? error.status : 500;
    const message = error instanceof Error ? error.message : 'Upload failed.';
    if (status >= 500) console.error('[api/files/upload] request failed:', message);
    return reply(res, status, { error: message, ...(error?.extra || {}) });
  }
}

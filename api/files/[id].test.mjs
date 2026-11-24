import { PassThrough } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  fetch: vi.fn(),
  file: null,
  onboardingComplete: true,
  membershipQueries: 0,
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { getUser: mocks.getUser },
    from(table) {
      if (table === 'community_members') mocks.membershipQueries += 1;
      const query = {};
      const builder = {
        select: () => builder,
        eq: (column, value) => { query[column] = value; return builder; },
        maybeSingle: async () => {
          if (table === 'profiles') return { data: { onboarding_complete: mocks.onboardingComplete }, error: null };
          if (table === 'files') return { data: mocks.file?.status === 'published' ? mocks.file : null, error: null };
          if (table === 'community_members') return { data: null, error: null };
          return { data: null, error: null };
        },
      };
      return builder;
    },
  }),
}));

import handler from './[id].mjs';

function makeResponse() {
  const response = new PassThrough();
  response.headers = {};
  response.setHeader = (name, value) => { response.headers[name.toLowerCase()] = value; };
  return response;
}

async function invoke(req) {
  const response = makeResponse();
  const chunks = [];
  response.on('data', chunk => chunks.push(chunk));
  const finished = new Promise(resolve => response.on('finish', resolve));
  await handler(req, response);
  if (!response.writableEnded) await finished;
  return { status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString() };
}

const eligibleUser = {
  id: 'student-id',
  email: 'student@sru.edu.in',
  email_confirmed_at: '2026-01-01T00:00:00.000Z',
  app_metadata: { provider: 'google' },
};

describe('authenticated community file reads', () => {
  beforeEach(() => {
    vi.stubEnv('SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'server-only-test-key');
    vi.stubEnv('APPWRITE_ENDPOINT', 'https://appwrite.example/v1');
    vi.stubEnv('APPWRITE_PROJECT_ID', 'project');
    vi.stubEnv('APPWRITE_API_KEY', 'server-only-test-key');
    vi.stubEnv('NODE_ENV', 'test');
    mocks.getUser.mockReset().mockResolvedValue({ data: { user: eligibleUser }, error: null });
    mocks.onboardingComplete = true;
    mocks.membershipQueries = 0;
    mocks.fetch.mockReset().mockResolvedValue(new Response(Buffer.from('academic-resource'), { status: 200 }));
    mocks.file = {
      id: 'file-id', status: 'published', visibility: 'community', community_id: 'dsa-id',
      owner_id: 'someone-else', original_filename: 'notes.pdf', mime_type: 'application/pdf',
      file_size: 17, storage_provider: 'appwrite', storage_bucket_id: 'private-bucket', storage_file_id: 'object-id',
    };
    vi.stubGlobal('fetch', mocks.fetch);
  });

  it.each([
    ['preview', { inline: '1' }, 'inline;'],
    ['download', {}, 'attachment;'],
  ])('serves a published community file to a nonmember for %s', async (_operation, query, disposition) => {
    const response = await invoke({
      method: 'GET',
      headers: { cookie: 'sruxhub_file_session=eligible-token' },
      query: { id: 'file-id', ...query },
    });

    expect(response.status).toBe(200);
    expect(response.body).toBe('academic-resource');
    expect(response.headers['content-disposition']).toContain(disposition);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.membershipQueries).toBe(0);
  });

  it('rejects requests without a signed-in session', async () => {
    const response = await invoke({ method: 'GET', headers: {}, query: { id: 'file-id' } });
    expect(response.status).toBe(401);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('rejects private files for nonowners even when the requester is eligible', async () => {
    mocks.file.visibility = 'private';
    const response = await invoke({
      method: 'GET',
      headers: { cookie: 'sruxhub_file_session=eligible-token' },
      query: { id: 'file-id' },
    });
    expect(response.status).toBe(403);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('rejects non-SRU Google accounts', async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { ...eligibleUser, email: 'student@gmail.com' } }, error: null,
    });
    const response = await invoke({
      method: 'GET',
      headers: { cookie: 'sruxhub_file_session=other-token' },
      query: { id: 'file-id' },
    });
    expect(response.status).toBe(403);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('rejects incomplete onboarding', async () => {
    mocks.onboardingComplete = false;
    const response = await invoke({
      method: 'GET',
      headers: { cookie: 'sruxhub_file_session=eligible-token' },
      query: { id: 'file-id' },
    });
    expect(response.status).toBe(403);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('does not serve unpublished files', async () => {
    mocks.file.status = 'pending';
    const response = await invoke({
      method: 'GET',
      headers: { cookie: 'sruxhub_file_session=eligible-token' },
      query: { id: 'file-id' },
    });
    expect(response.status).toBe(404);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});

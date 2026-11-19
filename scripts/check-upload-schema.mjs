const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
const missing = required.filter(key => !process.env[key]);
if (missing.length) {
  console.log(JSON.stringify({ configured: false, missing }));
  process.exitCode = 1;
} else {
  const base = process.env.SUPABASE_URL.replace(/\/$/, '');
  const headers = {
    apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
  };
  const response = await fetch(`${base}/rest/v1/file_upload_sessions?select=id,received_offset,pending_bytes,upload_status&limit=1`, { headers });
  let body = {};
  try { body = await response.json(); } catch { /* Report status without data. */ }
  const rpcResponse = await fetch(`${base}/rest/v1/rpc/list_community_files`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_limit: 1, p_offset: 0 }),
  });
  let rpcBody = {};
  try { rpcBody = await rpcResponse.json(); } catch { /* Report status without data. */ }
  console.log(JSON.stringify({
    configured: true,
    status: response.status,
    code: body.code ?? null,
    message: body.message ?? null,
    stagingSchemaAvailable: response.ok,
    fileListRpcStatus: rpcResponse.status,
    fileListRpcCode: rpcBody.code ?? null,
    fileListRpcMessage: rpcBody.message ?? null,
  }));
  if (!response.ok) process.exitCode = 1;
}

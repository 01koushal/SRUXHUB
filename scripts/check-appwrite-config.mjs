const required = ['APPWRITE_ENDPOINT', 'APPWRITE_PROJECT_ID', 'APPWRITE_API_KEY', 'APPWRITE_BUCKET_ID'];
const missing = required.filter(key => !process.env[key]);
if (missing.length) {
  console.log(JSON.stringify({ configured: false, missing }));
  process.exitCode = 1;
} else {
  const response = await fetch(`${process.env.APPWRITE_ENDPOINT.replace(/\/$/, '')}/storage/buckets/${encodeURIComponent(process.env.APPWRITE_BUCKET_ID)}`, {
    headers: {
      'X-Appwrite-Project': process.env.APPWRITE_PROJECT_ID,
      'X-Appwrite-Key': process.env.APPWRITE_API_KEY,
    },
  });
  const bucket = await response.json().catch(() => ({}));
  console.log(JSON.stringify({
    configured: true,
    status: response.status,
    bucketIdMatches: bucket.$id === process.env.APPWRITE_BUCKET_ID,
    maximumFileSize: bucket.maximumFileSize ?? null,
    fileSecurity: bucket.fileSecurity ?? null,
    createForUsers: Array.isArray(bucket.$permissions) && bucket.$permissions.includes('create("users")'),
  }));
  if (!response.ok) process.exitCode = 1;
}

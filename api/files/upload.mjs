// Legacy compatibility route. SRUXHUB no longer accepts file bytes through an
// application server; the browser uploads directly to Appwrite after obtaining
// a short-lived authorization from /api/files/direct.
export const config = { api: { bodyParser: false } };

export default function handler(_req, res) {
  res.statusCode = 410;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({
    error: 'This upload endpoint is retired. Use the direct Appwrite upload flow.',
  }));
}

export function requireLocalOrigin(req: Request): Response | null {
  const site = req.headers.get('sec-fetch-site');
  if (site === 'cross-site') return Response.json({ error: 'cross-site request rejected' }, { status: 403 });
  const origin = req.headers.get('origin');
  if (!origin) return null;
  try {
    if (new URL(origin).host === new URL(req.url).host) return null;
  } catch {}
  return Response.json({ error: 'invalid origin' }, { status: 403 });
}

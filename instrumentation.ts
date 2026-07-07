/**
 * Next.js instrumentation — runs once on server startup (nodejs runtime only).
 * Boots the headless producer WebSocket and configured backend daemons.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { getCore } = await import('@/lib/server/core');
    getCore();
  }
}

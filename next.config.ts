import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Run as a self-contained Node server (Docker runs it directly; the Electron
  // shell spawns .next/standalone/server.js). DESIGN §3.1 / §10.
  output: "standalone",
  // Parent lockfile above this project would otherwise misplace the standalone
  // output; pin the tracing root to this project.
  outputFileTracingRoot: path.join(import.meta.dirname),
  // `ws` is used for the local status bridge and the outbound producer channel.
};

export default nextConfig;

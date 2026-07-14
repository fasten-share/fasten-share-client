import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Run as a self-contained Node server (Docker runs it directly; the Electron
  // shell spawns the exported standalone server.js). DESIGN §3.1 / §10.
  output: "standalone",
  // Keep the standalone output self-contained when this open-source project is
  // cloned and built without the private repository around it.
  outputFileTracingRoot: path.join(import.meta.dirname),
  // The tool-config route intentionally inspects user-selected filesystem paths.
  // Prevent NFT from treating this build-time config file as a runtime asset.
  outputFileTracingExcludes: {
    '/api/tools/configure': ['./next.config.ts'],
  },
  // `ws` is used for the local status bridge and the outbound producer channel.
};

export default nextConfig;

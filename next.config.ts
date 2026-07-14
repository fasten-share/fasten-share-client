import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Run as a self-contained Node server (Docker runs it directly; the Electron
  // shell spawns the exported standalone server.js). DESIGN §3.1 / §10.
  output: "standalone",
  // Trace from the repository root so linked workspace contracts are resolved
  // and copied into the standalone artifact.
  outputFileTracingRoot: path.join(import.meta.dirname, ".."),
  // Turbopack must see both this app and linked workspace packages. The shared
  // contracts package is bundled, so the standalone trace remains app-scoped.
  turbopack: {
    root: path.join(import.meta.dirname, ".."),
  },
  transpilePackages: ["@fasten-share/contracts"],
  // The tool-config route intentionally inspects user-selected filesystem paths.
  // Prevent NFT from treating this build-time config file as a runtime asset.
  outputFileTracingExcludes: {
    '/api/tools/configure': ['./next.config.ts'],
  },
  // `ws` is used for the local status bridge and the outbound producer channel.
};

export default nextConfig;

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  agentRules: false,
  allowedDevOrigins: ["127.0.0.1"],
  experimental: {
    serverActions: { bodySizeLimit: "100mb" }
  },
  serverExternalPackages: ["postgres", "bullmq", "ioredis", "reductoai"]
};

export default nextConfig;

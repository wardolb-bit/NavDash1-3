/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    cpus: 1,
    workerThreads: true,
    webpackBuildWorker: false,
    serverComponentsExternalPackages: ["pdf-parse"],
  },
};

export default nextConfig;

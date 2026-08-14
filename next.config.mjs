/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The generate route shells out to python3 and reads the files it writes back
  // from a temp dir. Nothing there is bundleable, so keep it on the Node runtime.
  experimental: {
    serverActions: { bodySizeLimit: "20mb" },
  },
};

export default nextConfig;

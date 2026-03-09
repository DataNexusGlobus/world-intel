/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  webpack: (config, { isServer }) => {
    config.experiments = { ...config.experiments, asyncWebAssembly: true };
    // Don't try to bundle kokoro-js on the server side
    if (isServer) {
      config.externals = [...(config.externals || []), 'kokoro-js'];
    }
    // Handle WebGPU shader files inside kokoro-js
    config.module.rules.push({
      test: /\.wgsl$/i,
      type: 'asset/source',
    });
    return config;
  },
};

module.exports = nextConfig;

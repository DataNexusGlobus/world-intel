/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  experimental: {
    esmExternals: 'loose',
  },
  webpack: (config, { isServer }) => {
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
      layers: true,
    };

    // Keep kokoro-js out of server bundle completely
    if (isServer) {
      config.externals = [
        ...(config.externals || []),
        'kokoro-js',
        'onnxruntime-web',
      ];
    }

    // WGSL shader files — put first so it runs before default rules
    config.module.rules.unshift({
      test: /\.wgsl$/i,
      type: 'asset/source',
    });

    // WASM files
    config.module.rules.push({
      test: /\.wasm$/,
      type: 'webassembly/async',
    });

    return config;
  },
};

module.exports = nextConfig;

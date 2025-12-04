/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,

  // 开发服务器配置
  webpack: (config, { dev, isServer }) => {
    // 在开发模式下优化热更新
    if (dev && !isServer) {
      config.watchOptions = {
        poll: 1000,
        aggregateTimeout: 300,
        ignored: /node_modules/,
      };
      // 禁用热更新的某些功能以避免 404 错误
      config.infrastructureLogging = {
        level: 'error',
      };
    }
    return config;
  },

  // API 代理配置
  async rewrites() {
    return {
      fallback: [
        {
          source: '/api/:path*',
          destination: 'http://localhost:8000/api/:path*',
        },
      ],
    };
  },

  // 环境变量
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000',
  },

  // 忽略热更新错误
  onDemandEntries: {
    maxInactiveAge: 25 * 1000,
    pagesBufferLength: 2,
  },

  // 禁用 webpack 热更新的某些功能
  experimental: {
    // 禁用 webpack 的某些热更新功能
    webpackBuildWorker: false,
  },
};

module.exports = nextConfig;


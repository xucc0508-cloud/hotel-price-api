module.exports = {
  apps: [
    {
      name: 'hotel-price-api',
      script: 'src/index.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      kill_timeout: 10000,
      listen_timeout: 10000,
      time: true,
      merge_logs: true,
      out_file: 'logs/output.log',
      error_file: 'logs/error.log',
      env: {
        NODE_ENV: 'development',
        HOST: '0.0.0.0',
        PORT: 3000,
      },
      env_production: {
        NODE_ENV: 'production',
        HOST: '0.0.0.0',
        PORT: 3000,
      },
    },
  ],
};

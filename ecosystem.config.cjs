module.exports = {
  apps: [
    {
      name: "archivar",
      script: "src/server/index.ts",
      interpreter: "bun",
      cwd: __dirname,
      env: {
        NODE_ENV: "production",
      },
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "512M",
      min_uptime: "10s",
      max_restarts: 10,
      restart_delay: 3000,
      time: true,
      merge_logs: true,
      out_file: "logs/archivar-out.log",
      error_file: "logs/archivar-error.log",
    },
  ],
};

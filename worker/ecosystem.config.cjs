module.exports = {
  apps: [
    {
      name: "yandex-worker",
      script: "dist/index.js",
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      max_restarts: 20,
      restart_delay: 5000,
      max_memory_restart: "400M",
      env: { NODE_ENV: "production" },
      out_file: "logs/out.log",
      error_file: "logs/err.log",
      time: true,
    },
  ],
};

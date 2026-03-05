module.exports = {
  apps: [{
    name: "ai-front-desk",
    script: "server.js",
    cwd: "/home/nbuck/ai-front-desk-backend",
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: "500M",
    env: { NODE_ENV: "production" },
  }],
};

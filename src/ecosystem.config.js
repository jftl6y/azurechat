module.exports = {
    apps: [
      {
        name: "azurechatgov",
        script: "./node_modules/next/dist/bin/next",
        args: "start -p " + (process.env.PORT || 8080),
        watch: false,
        autorestart: true,
        env: {
          "NODE_ENV": "PRODUCTION"
        }
      },
    ],
  };

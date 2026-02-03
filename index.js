// index.js
const DiscordBot = require("./DiscordBot");
const KillFetcher = require("./KillFetcher");
const config = require("./config.json");

const discordBot = new DiscordBot(config);
const killFetcher = new KillFetcher(discordBot, config);

(async () => {
  try {
    await discordBot.initialize();

    // Start the single reliable polling loop (deep scan)
    killFetcher.start();

    console.log("KillFetcher started.");
  } catch (err) {
    console.error("Fatal startup error:", err?.message || err);
    process.exit(1);
  }
})();

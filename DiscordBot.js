const { Client, GatewayIntentBits } = require("discord.js");
const fs = require("fs");

const ImageGenerator = require("./ImageGenerator");
const StatsStore = require("./StatsStore");

function norm(s) {
  return String(s || "").trim().toLowerCase();
}

function fmtCompact(n) {
  const num = Number(n) || 0;
  const fmt = (v, suf) => `${v.toFixed(1)}${suf}`.replace(".0", "");
  if (num >= 1_000_000_000) return fmt(num / 1_000_000_000, "B");
  if (num >= 1_000_000) return fmt(num / 1_000_000, "M");
  if (num >= 1_000) return fmt(num / 1_000, "K");
  return String(Math.round(num));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class DiscordBot {
  constructor(config) {
    this.config = config;

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
    });

    this.channel = null;

    // Queue stores objects: { kill, tries, nextAt }
    this.sendQueue = [];
    this.isProcessingQueue = false;

    // Prevent duplicates / late-finishing sends
    this.inFlightEventIds = new Set();
    this.postedEventIds = new Set();
    this.maxPostedKeep = 1500;

    this.playerNames = Array.isArray(config.players)
      ? config.players.map((p) => norm(p)).filter(Boolean)
      : [];

    // Persistent stats of posted kills
    this.stats = new StatsStore();

    // Posting behavior
    this.POST_TIMEOUT_MS = 120_000;    // was 30s; Discord+prices can exceed 30s
    this.MAX_POST_RETRIES = 5;         // retries on timeout/network hiccups
    this.BASE_RETRY_DELAY_MS = 5_000;  // exponential backoff base
  }

  async initialize() {
    this.client.once("ready", async () => {
      console.log(`Logged in as ${this.client.user.tag}!`);

      if (this.config.playingGame) {
        this.client.user.setActivity(this.config.playingGame);
      }

      this.channel = await this.client.channels.fetch(this.config.botChannel).catch(() => null);
      if (!this.channel) {
        console.error(`Bot channel with ID ${this.config.botChannel} not found!`);
      } else {
        console.log(`Bot will post in channel: ${this.channel.name}`);
      }

      // If you want schedules, enable intentionally.
      // this.startSummarySchedules();
    });

    // Slash commands (unchanged from your version)
    this.client.on("interactionCreate", async (interaction) => {
      if (!interaction.isChatInputCommand()) return;

      try {
        if (interaction.commandName === "profile") {
          const player = interaction.options.getString("player", true);
          const days = interaction.options.getInteger("days") ?? 7;

          const p = this.stats.profile(player, days);

          const embed = {
            color: 0x3b82f6,
            title: `Profile: ${p.playerName}`,
            description: `Last ${p.days} day(s) from posted kills`,
            fields: [
              { name: "Kills", value: String(p.kills), inline: true },
              { name: "Deaths", value: String(p.deaths), inline: true },
              { name: "Net", value: String(p.kills - p.deaths), inline: true },
              { name: "Fame (kills)", value: p.fameGained.toLocaleString(), inline: true },
              { name: "Silver destroyed (est.)", value: `${fmtCompact(p.silverDestroyed)} s`, inline: true },
              { name: "Silver lost (est.)", value: `${fmtCompact(p.silverLost)} s`, inline: true },
            ],
            footer: { text: "Estimates are based on Albion Online Data Project prices." },
          };

          if (p.topWeapons.length) {
            embed.fields.push({
              name: "Top weapons",
              value: p.topWeapons.map(([w, c]) => `• ${w} (${c})`).join("\n"),
              inline: false,
            });
          }

          await interaction.reply({ embeds: [embed], ephemeral: false });
        }

        if (interaction.commandName === "summary") {
          const days = interaction.options.getInteger("days") ?? 1;
          const s = this.stats.summarize(days);

          const embed = {
            color: 0x22c55e,
            title: `Summary: Last ${days} day(s)`,
            fields: [
              { name: "Posted kills", value: String(s.postedKills), inline: true },
              { name: "Total fame", value: s.totalFame.toLocaleString(), inline: true },
              { name: "Total loss (est.)", value: `${fmtCompact(s.totalSilverLoss)} s`, inline: true },
            ],
            footer: { text: "Based on kills posted by this bot." },
          };

          await interaction.reply({ embeds: [embed] });
        }
      } catch (e) {
        console.error("Slash command error:", e?.message || e);
        if (!interaction.replied) {
          await interaction.reply({ content: "Something went wrong running that command.", ephemeral: true });
        }
      }
    });

    await this.client.login(this.config.token);
  }

  // ==========
  // Queue API
  // ==========

  queueKill(kill) {
    if (!kill?.EventId) return;

    // Avoid duplicates immediately
    if (this.postedEventIds.has(kill.EventId) || this.inFlightEventIds.has(kill.EventId)) {
      return;
    }

    this.sendQueue.push({ kill, tries: 0, nextAt: Date.now() });
    this.processQueue();
  }

  async processQueue() {
    if (this.isProcessingQueue) return;
    this.isProcessingQueue = true;

    try {
      while (this.sendQueue.length > 0) {
        // Find next item that is eligible to run (based on nextAt)
        const now = Date.now();
        let idx = this.sendQueue.findIndex((x) => x.nextAt <= now);

        if (idx === -1) {
          // nothing ready yet; sleep until earliest nextAt
          const soonest = Math.min(...this.sendQueue.map((x) => x.nextAt));
          await sleep(Math.max(250, soonest - now));
          continue;
        }

        const job = this.sendQueue.splice(idx, 1)[0];
        const kill = job.kill;

        // If it got posted/in-flight while waiting, skip
        if (this.postedEventIds.has(kill.EventId) || this.inFlightEventIds.has(kill.EventId)) {
          continue;
        }

        try {
          await this.postKillWithTimeoutAndRetry(job);
        } catch (err) {
          console.error(`Error posting kill ${kill.EventId}:`, err?.message || err);
          // NOTE: postKillWithTimeoutAndRetry handles requeue on retryable failures.
          // If it throws here, it’s non-retryable or out of retries.
        }
      }
    } finally {
      this.isProcessingQueue = false;
    }
  }

  async postKillWithTimeoutAndRetry(job) {
    const { kill } = job;

    // Don’t post knockdowns
    if (kill.TotalVictimKillFame === 0) return;

    // Mark in-flight to prevent duplicates if another queueKill happens
    this.inFlightEventIds.add(kill.EventId);

    try {
      await this._withTimeout(this.postKill(kill), this.POST_TIMEOUT_MS, kill.EventId);

      // Success — remember posted
      this._rememberPosted(kill.EventId);
    } catch (e) {
      // Timeout or transient error:
      const msg = (e?.message || "").toLowerCase();
      const retryable =
        msg.includes("timeout") ||
        msg.includes("rate") || // discord rate-limit delays
        msg.includes("network") ||
        msg.includes("econnreset") ||
        msg.includes("etimedout") ||
        msg.includes("503") ||
        msg.includes("502");

      if (retryable && job.tries < this.MAX_POST_RETRIES) {
        job.tries += 1;

        // exponential backoff with a little jitter
        const delay =
          this.BASE_RETRY_DELAY_MS * Math.pow(2, job.tries - 1) +
          Math.floor(Math.random() * 1000);

        console.warn(
          `Post retry ${job.tries}/${this.MAX_POST_RETRIES} for ${kill.EventId} in ${delay}ms (${e?.message || e})`
        );

        // Requeue for later
        job.nextAt = Date.now() + delay;
        this.sendQueue.push(job);
        return;
      }

      // Out of retries or not retryable
      throw e;
    } finally {
      // Remove in-flight marker *only if it wasn’t successfully posted*
      // If it was posted, it’s already in postedEventIds.
      this.inFlightEventIds.delete(kill.EventId);
    }
  }

  _rememberPosted(eventId) {
    this.postedEventIds.add(eventId);
    if (this.postedEventIds.size > this.maxPostedKeep) {
      const over = this.postedEventIds.size - this.maxPostedKeep;
      const it = this.postedEventIds.values();
      for (let i = 0; i < over; i++) {
        this.postedEventIds.delete(it.next().value);
      }
    }
  }

  _withTimeout(promise, ms, eventId) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        reject(new Error(`Timeout exceeded for posting kill ${eventId}`));
      }, ms);

      promise
        .then((v) => {
          clearTimeout(t);
          resolve(v);
        })
        .catch((e) => {
          clearTimeout(t);
          reject(e);
        });
    });
  }

  // =================
  // Actual posting
  // =================
  async postKill(kill) {
    if (!this.channel) return;

    const imageGenerator = new ImageGenerator();

    const result = await imageGenerator.generateKillImage(kill);
    const filePath = typeof result === "string" ? result : result.filePath;
    const estimates = typeof result === "string" ? null : result.estimates;

    // Color (red if victim matches your filters, green otherwise)
    let eventColor = 0x008000;

    const wantedGuild = norm(this.config.guildName);
    const wantedAlliance = norm(this.config.allianceName);

    const victim = kill?.Victim || {};
    const victimGuild = norm(victim.GuildName);
    const victimAlliance = norm(victim.AllianceName);
    const victimName = norm(victim.Name);

    const victimMatches =
      (wantedGuild && victimGuild === wantedGuild) ||
      (wantedAlliance && victimAlliance === wantedAlliance) ||
      (this.playerNames.length > 0 && this.playerNames.includes(victimName));

    if (victimMatches) eventColor = 0x880808;

    const embed = {
      color: eventColor,
      author: {
        name: `${kill.Killer.Name} killed ${kill.Victim.Name}`,
        url: `https://albiononline.com/killboard/kill/${kill.EventId}`,
      },
      image: { url: "attachment://kill.png" },
      timestamp: new Date(kill.TimeStamp).toISOString(),
      footer: { text: `Kill #${kill.EventId}` },
    };

    await this.channel.send({
      embeds: [embed],
      files: [{ attachment: filePath, name: "kill.png" }],
    });

    // Record stats (only after a successful send)
    this.stats.recordPostedKill(kill, estimates || {});

    // Cleanup image
    try {
      fs.unlinkSync(filePath);
    } catch {}
  }
}

module.exports = DiscordBot;

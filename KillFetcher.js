const axios = require("axios");

function norm(s) {
  return String(s || "").trim().toLowerCase();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

class KillFetcher {
  constructor(discordBot, config) {
    this.discordBot = discordBot;
    this.config = config;

    // Polling
    this.pollMs = 60_000;           // 60s between polls
    this.maxOffset = 1000;          // scan up to offset 1000
    this.pageSize = 51;

    // Networking
    this.httpTimeout = 35_000;      // bumped from 20s -> 35s
    this.maxRetries = 3;

    // State
    this.running = false;
    this.inFlight = false;
    this.lastSeenEventId = 0;       // highest EventId we’ve seen (stop point)
    this.publishedEventIds = new Set();
    this.maxPublishedKeep = 500;    // prevent unbounded memory growth
  }

  start() {
    if (this.running) return;
    this.running = true;
    this._loop().catch((e) => console.error("KillFetcher fatal loop error:", e?.message || e));
  }

  stop() {
    this.running = false;
  }

  // ----------------------------
  // Filter logic (single truth)
  // ----------------------------
  matchesFilters(kill) {
    const wantedGuild = norm(this.config.guildName);
    const wantedAlliance = norm(this.config.allianceName);

    const players = Array.isArray(this.discordBot.playerNames)
      ? this.discordBot.playerNames
      : [];

    const killer = kill?.Killer || {};
    const victim = kill?.Victim || {};

    const killerGuild = norm(killer.GuildName);
    const victimGuild = norm(victim.GuildName);

    const killerAlliance = norm(killer.AllianceName);
    const victimAlliance = norm(victim.AllianceName);

    const killerName = norm(killer.Name);
    const victimName = norm(victim.Name);

    // If config has NOTHING set, match nothing (avoid “post everything”)
    const hasAnyFilter =
      Boolean(wantedGuild) ||
      Boolean(wantedAlliance) ||
      (players.length > 0);

    if (!hasAnyFilter) {
      return { ok: false, reason: "no filters configured" };
    }

    if (wantedGuild && (killerGuild === wantedGuild || victimGuild === wantedGuild)) {
      return { ok: true, reason: "guild" };
    }

    if (wantedAlliance && (killerAlliance === wantedAlliance || victimAlliance === wantedAlliance)) {
      return { ok: true, reason: "alliance" };
    }

    if (players.length > 0 && (players.includes(killerName) || players.includes(victimName))) {
      return { ok: true, reason: "player" };
    }

    return { ok: false, reason: "no match" };
  }

  // ----------------------------
  // Main loop (no overlaps)
  // ----------------------------
  async _loop() {
    while (this.running) {
      if (this.inFlight) {
        // Shouldn’t happen, but safety guard
        await sleep(1000);
        continue;
      }

      this.inFlight = true;
      try {
        await this._pollOnce();
      } catch (e) {
        console.error("KillFetcher poll error:", e?.message || e);
      } finally {
        this.inFlight = false;
      }

      await sleep(this.pollMs);
    }
  }

  // ----------------------------
  // One poll: scan offsets until we hit lastSeenEventId
  // ----------------------------
  async _pollOnce() {
    let seen = 0;
    let fresh = 0;
    let matched = 0;
    let queued = 0;
    let skipped = 0;

    // Always start from offset 0 (newest)
    for (let offset = 0; offset <= this.maxOffset; offset += this.pageSize) {
      const page = await this._getEventsPage(offset);

      if (!Array.isArray(page) || page.length === 0) break;

      seen += page.length;

      // Track the newest event id we saw on offset 0
      if (offset === 0) {
        const newest = page[0]?.EventId || 0;
        if (newest > this.lastSeenEventId) {
          // we *don’t* set lastSeenEventId yet; we do it after processing to avoid skipping
        }
      }

      for (const kill of page) {
        const id = kill?.EventId || 0;
        if (!id) continue;

        // Stop condition: once we reach events we’ve already “covered”
        if (this.lastSeenEventId && id <= this.lastSeenEventId) {
          // We can stop scanning deeper offsets entirely.
          offset = this.maxOffset + this.pageSize; // break outer loop
          break;
        }

        fresh++;

        // Don’t republish same event
        if (this.publishedEventIds.has(id)) {
          skipped++;
          continue;
        }

        const match = this.matchesFilters(kill);
        if (!match.ok) {
          skipped++;
          continue;
        }

        matched++;
        this.discordBot.queueKill(kill);
        queued++;

        this._rememberPublished(id);
      }
    }

    // After successful scan, update lastSeenEventId to the newest EventId we saw at offset 0
    // (Do another quick fetch of offset 0, so our stop point is always correct even if earlier pages timed out)
    const head = await this._getEventsPage(0).catch(() => null);
    const newestNow = Array.isArray(head) && head[0]?.EventId ? head[0].EventId : 0;
    if (newestNow > this.lastSeenEventId) this.lastSeenEventId = newestNow;

    console.log(
      `KillFetcher: seen=${seen} fresh=${fresh} matched=${matched} queued=${queued} skipped=${skipped} lastSeen=${this.lastSeenEventId}`
    );
  }

  _rememberPublished(id) {
    this.publishedEventIds.add(id);

    // Trim the set to avoid growing forever
    if (this.publishedEventIds.size > this.maxPublishedKeep) {
      // delete oldest inserted items
      const over = this.publishedEventIds.size - this.maxPublishedKeep;
      const it = this.publishedEventIds.values();
      for (let i = 0; i < over; i++) {
        const v = it.next().value;
        this.publishedEventIds.delete(v);
      }
    }
  }

  // ----------------------------
  // HTTP with retries/backoff
  // ----------------------------
  async _getEventsPage(offset) {
    const url = `https://gameinfo.albiononline.com/api/gameinfo/events?limit=${this.pageSize}&offset=${offset}`;

    let lastErr = null;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const res = await axios.get(url, { timeout: this.httpTimeout });
        return res.data;
      } catch (e) {
        lastErr = e;
        const msg = e?.message || String(e);
        const isTimeout = msg.includes("timeout");

        // backoff: 0.5s, 1s, 2s
        const backoff = 500 * Math.pow(2, attempt);
        if (attempt < this.maxRetries) {
          if (isTimeout) {
            // Only log timeouts at low noise
            console.warn(`KillFetcher: timeout at offset=${offset}, retrying in ${backoff}ms...`);
          } else {
            console.warn(`KillFetcher: HTTP error at offset=${offset}: ${msg} (retry in ${backoff}ms)`);
          }
          await sleep(backoff);
          continue;
        }
      }
    }

    throw lastErr;
  }
}

module.exports = KillFetcher;

const { createCanvas, loadImage } = require("canvas");
const fs = require("fs");
const path = require("path");

class ImageGenerator {
  constructor() {
    // Canvas sizing
    this.width = 1200;
    this.topHeight = 800;

    // Price config (Americas)
    this.PRICE_HOST = "https://west.albion-online-data.com";
    // Price fallback order (Americas / West)
    this.PRICE_LOCATIONS = ["Caerleon", "Lymhurst"]; // add more if you want
    // Guardrail: ignore absurd sell_min when it's the only signal
    this.MIN_SELL_CAP = 500_000; // tune: 500k catches the 999,999 bag issue immediately

  }

  formatGuildName(allianceName, guildName) {
    return allianceName ? `[${allianceName}] ${guildName}` : guildName;
  }

  // -----------------------------
  // PUBLIC: single-image renderer
  // -----------------------------
  async generateKillImage(kill) {
    const killer = kill.Killer;
    const victim = kill.Victim;

    const inventoryItems = Array.isArray(victim.Inventory)
      ? victim.Inventory.filter(Boolean)
      : [];

    // ---- price estimate (gear + inventory) ----
    const killerEquipItems = Object.values(killer?.Equipment || {}).filter(Boolean);
    const victimEquipItems = Object.values(victim?.Equipment || {}).filter(Boolean);

    // Fetch all prices needed (one pass)
    const allPriceItems = [...killerEquipItems, ...victimEquipItems, ...inventoryItems];
    const priceMap = await this.fetchPriceMap(allPriceItems);

    // ? Gear/build: ignore stack counts (food/potion stacks, etc.)
    const killerGearValue = this.sumItemValue(killerEquipItems, priceMap, { ignoreCounts: true });
    const victimGearValue = this.sumItemValue(victimEquipItems, priceMap, { ignoreCounts: true });
    
    // Inventory: use real counts
    const victimInvValue = this.sumItemValue(inventoryItems, priceMap, { ignoreCounts: false });
    
    const victimTotalLoss = victimGearValue + victimInvValue;

    // Inventory layout
    const invIcon = 80;
    const invPad = 8;
    const invMarginX = 30;
    const invMarginY = 20;

    const itemsPerRow = Math.max(
      1,
      Math.floor((this.width - invMarginX * 2 + invPad) / (invIcon + invPad))
    );

    const invRows =
      inventoryItems.length > 0 ? Math.ceil(inventoryItems.length / itemsPerRow) : 0;

    const invHeight =
      inventoryItems.length > 0
        ? invMarginY * 2 + invRows * (invIcon + invPad) - invPad + 50
        : 0;

    // Final canvas size
    const height = this.topHeight + (invHeight > 0 ? invHeight + 20 : 0);
    const canvas = createCanvas(this.width, height);
    const ctx = canvas.getContext("2d");

    // Solid background
    this.drawSolidBackground(ctx, canvas.width, canvas.height);

    // Top “kill card”
    await this.drawKillCard(ctx, kill, killer, victim, {
      killerGearValue,
      victimGearValue,
      victimInvValue,
    });

    // Bottom inventory section
    if (inventoryItems.length > 0) {
      const invY = this.topHeight + 10;
      await this.drawInventory(ctx, inventoryItems, {
        x: invMarginX,
        y: invY + invMarginY,
        icon: invIcon,
        pad: invPad,
        itemsPerRow,
        titleY: invY + 28,
        inventoryValue: victimInvValue,
      });
    }

    // Save
    const filePath = path.join(__dirname, `kill-${Date.now()}.png`);
    fs.writeFileSync(filePath, canvas.toBuffer("image/png"));
    return {
      filePath,
      estimates: {
        killerBuild: killerGearValue,
        victimBuild: victimGearValue,
        victimInv: victimInvValue,
        victimTotalLoss,
      },
    };

  }

  // -----------------------------
  // BACKGROUND (solid only)
  // -----------------------------
  drawSolidBackground(ctx, w, h) {
    ctx.fillStyle = "#0b0f14";
    ctx.fillRect(0, 0, w, h);

    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, "rgba(255,255,255,0.06)");
    grad.addColorStop(1, "rgba(0,0,0,0.35)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.fillRect(0, 0, w, h);
  }

  // -----------------------------
  // TOP CARD (gear + stats)
  // -----------------------------
  async drawKillCard(ctx, kill, killer, victim, values) {
    const { killerGearValue = 0, victimGearValue = 0, victimInvValue = 0 } = values || {};
    const totalLoss = (Number(victimGearValue) || 0) + (Number(victimInvValue) || 0);

    // Header text
    ctx.fillStyle = "#FFF";
    ctx.textAlign = "center";

    ctx.font = "24px Arial";
    ctx.fillText(this.formatGuildName(killer.AllianceName, killer.GuildName), 250, 30);
    ctx.fillText(this.formatGuildName(victim.AllianceName, victim.GuildName), 950, 30);

    ctx.font = "36px Arial";
    ctx.fillText(killer.Name, 250, 70);
    ctx.fillText(victim.Name, 950, 70);

    ctx.font = "24px Arial";
    ctx.fillText(`IP: ${Math.round(killer.AverageItemPower)}`, 250, 100);
    ctx.fillText(`IP: ${Math.round(victim.AverageItemPower)}`, 950, 100);

    // Center info
    const centerX = 600;

    this.drawClockIcon(ctx, centerX - 35, 20, 70);
    ctx.font = "16px Arial";
    ctx.fillText(new Date(kill.TimeStamp).toLocaleString(), centerX, 105);

    if (Array.isArray(kill.Participants)) {
      const count = kill.Participants.length;
    
      if (count > 1) {
        // Group kill
        this.drawPeopleIcon(ctx, centerX - 35, 170, 70);
        ctx.font = "24px Arial";
        ctx.fillText(`${count} participants`, centerX, 265);
      } else if (count === 1) {
        // Solo kill
        this.drawPeopleIcon(ctx, centerX - 35, 170, 70);
        ctx.font = "24px Arial";
        ctx.fillText("Solo", centerX, 265);
      }
    }

    // Fame
    this.drawStarIcon(ctx, centerX - 25, 330, 50);
    ctx.font = "28px Arial";
    ctx.fillText(`${this.dFormatter(kill.TotalVictimKillFame)} Fame`, centerX, 410);

    // ? Total Loss: coin ABOVE + big number + small "s"
    this.drawLossBlock(ctx, centerX, 410, totalLoss); // coin top y

    // Equipment grids
    const equipmentTypes = [
      "Bag",
      "Head",
      "Cape",
      "MainHand",
      "Armor",
      "OffHand",
      "Potion",
      "Shoes",
      "Food",
      "Mount",
    ];

    const gridWidth = 0.42 * this.width;
    const iconSize = (gridWidth / 3) * 0.85;

    const positions = [
      { x: 45, y: 125 },
      { x: 45 + iconSize, y: 125 },
      { x: 45 + 2 * iconSize, y: 125 },
      { x: 45, y: 125 + iconSize },
      { x: 45 + iconSize, y: 125 + iconSize },
      { x: 45 + 2 * iconSize, y: 125 + iconSize },
      { x: 45, y: 125 + 2 * iconSize },
      { x: 45 + iconSize, y: 125 + 2 * iconSize },
      { x: 45 + 2 * iconSize, y: 125 + 2 * iconSize }, // Food slot index 8
      { x: 45 + iconSize, y: 125 + 3 * iconSize },
    ];

    const victimPositions = positions.map((pos) => ({
      x: this.width - 75 - iconSize * (3 - pos.x / iconSize),
      y: pos.y,
    }));

    for (let i = 0; i < equipmentTypes.length; i++) {
      const type = equipmentTypes[i];

      if (killer.Equipment?.[type]) {
        await this.drawItemIcon(ctx, killer.Equipment[type], positions[i].x, positions[i].y, iconSize);
      }

      if (victim.Equipment?.[type]) {
        await this.drawItemIcon(ctx, victim.Equipment[type], victimPositions[i].x, victimPositions[i].y, iconSize);
      }
    }

    // Build value under Food slot
    const foodIndex = 8;
    this.drawEstimateUnderSlot(ctx, positions[foodIndex], iconSize, killerGearValue);
    this.drawEstimateUnderSlot(ctx, victimPositions[foodIndex], iconSize, victimGearValue);

    // Damage bar
    await this.drawDamageBar(ctx, kill, positions[positions.length - 1].y + iconSize + 10);
  }

  // Loss block spaced like: participants -> fame
  // We pass fameBaselineY (the y where the "Fame" text is drawn, currently 410)
  drawLossBlock(ctx, centerX, fameBaselineY, totalLoss) {
    ctx.save();
    ctx.textAlign = "center";
  
    // Copy spacing pattern:
    // participants text baseline 265 -> fame icon top 330  ( +65 )
    const coinTopY = fameBaselineY + 65;
  
    // participants icon top 170 -> participants text baseline 265 ( +95 )
    const numberY = coinTopY + 70;
  
    const coinSize = 34;
  
    // Coin icon
    this.drawCoinIcon(ctx, centerX - coinSize / 2, coinTopY, coinSize);
  
    // Big number + smaller suffix "s"
    const value = this.formatSilver(totalLoss);
    const suffix = " ";
  
    ctx.font = "30px Arial";
    const valueW = ctx.measureText(value).width;
  
    ctx.font = "16px Arial";
    const suffixW = ctx.measureText(suffix).width;
  
    const totalW = valueW + suffixW;
    const startX = centerX - totalW / 2;
  
    ctx.fillStyle = "#FFFFFF";
  
    ctx.font = "30px Arial";
    ctx.fillText(value, startX + valueW / 2, numberY);
  
    ctx.font = "16px Arial";
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.fillText(suffix, startX + valueW + suffixW / 2, numberY);
  
    // Label under
    ctx.font = "16px Arial";
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fillText("Total Loss", centerX, numberY + 22);
  
    ctx.restore();
  }


  // Draw a simple coin icon (gold circle + inner ring + shine)
  drawCoinIcon(ctx, x, y, size) {
    const cx = x + size / 2;
    const cy = y + size / 2;
    const r = size / 2;

    ctx.save();

    ctx.fillStyle = "rgba(255, 210, 80, 0.95)";
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "rgba(120, 80, 20, 0.55)";
    ctx.lineWidth = Math.max(2, size * 0.08);
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.72, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.beginPath();
    ctx.arc(cx - r * 0.25, cy - r * 0.25, r * 0.35, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  drawEstimateUnderSlot(ctx, slotPos, iconSize, value) {
    const xCenter = slotPos.x + iconSize / 2;
    const y = slotPos.y + iconSize + 28;

    ctx.save();
    ctx.textAlign = "center";
    ctx.font = "18px Arial";

    const text = `Build: ${this.formatSilver(value)} s`;
    const w = ctx.measureText(text).width + 18;
    const h = 24;

    ctx.fillStyle = "rgba(0,0,0,0.55)";
    this._roundRect(ctx, xCenter - w / 2, y - 18, w, h, 8);
    ctx.fill();

    ctx.fillStyle = "#FFF";
    ctx.fillText(text, xCenter, y);
    ctx.restore();
  }

  async drawDamageBar(ctx, kill, barY) {
    const participants = Array.isArray(kill.Participants) ? kill.Participants : [];
    const totalDamage = participants.reduce((sum, p) => sum + (p.DamageDone || 0), 0);
    if (totalDamage <= 0) return;

    const barWidth = this.width - 60;
    const barHeight = 40;
    const barX = 30;
    let currentX = barX;

    ctx.font = "16px Arial";
    ctx.textAlign = "center";

    const participantColors = {};

    const roundRect = (x, y, w, h, r) => {
      const radius = Math.min(r, w / 2, h / 2);
      ctx.beginPath();
      ctx.moveTo(x + radius, y);
      ctx.lineTo(x + w - radius, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
      ctx.lineTo(x + w, y + h - radius);
      ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
      ctx.lineTo(x + radius, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
      ctx.lineTo(x, y + radius);
      ctx.quadraticCurveTo(x, y, x + radius, y);
      ctx.closePath();
    };

    for (const p of participants) {
      if (!p.DamageDone) continue;

      const pct = p.DamageDone / totalDamage;
      const w = barWidth * pct;

      const color = this.getStableColor(p.Name);
      participantColors[p.Name] = color;

      ctx.fillStyle = color;
      roundRect(currentX, barY, w, barHeight, 10);
      ctx.fill();

      ctx.fillStyle = "#FFF";
      ctx.fillText(`${Math.round(pct * 100)}%`, currentX + w / 2, barY + barHeight / 1.5);

      currentX += w;
    }

    // Legend
    let textX = barX;
    let textY = barY + barHeight + 25;

    const boxSize = 15;
    const textPadding = 6;

    ctx.textAlign = "left";
    ctx.font = "16px Arial";

    for (const p of participants) {
      if (!p.DamageDone) continue;

      const label = `${p.Name} [${Math.round(p.DamageDone)}]`;
      const labelW = ctx.measureText(label).width;

      ctx.fillStyle = participantColors[p.Name];
      ctx.fillRect(textX, textY - boxSize, boxSize, boxSize);

      ctx.fillStyle = "#FFF";
      ctx.fillText(label, textX + boxSize + textPadding, textY);

      textX += boxSize + textPadding + labelW + 18;

      if (textX > this.width - 200) {
        textX = barX;
        textY += 22;
      }
    }
  }

  // -----------------------------
  // INVENTORY (bottom)
  // -----------------------------
  async drawInventory(ctx, inventoryItems, layout) {
    const { x, y, icon, pad, itemsPerRow, titleY, inventoryValue } = layout;

    ctx.fillStyle = "#FFF";
    ctx.textAlign = "center";
    ctx.font = "22px Arial";

    const title = `Victim Inventory (${this.formatSilver(inventoryValue)} s)`;
    ctx.fillText(title, this.width / 2, titleY);

    let cx = x;
    let cy = y + 20;

    for (let i = 0; i < inventoryItems.length; i++) {
      const item = inventoryItems[i];
      await this.drawItemIcon(ctx, item, cx, cy, icon);

      cx += icon + pad;
      if ((i + 1) % itemsPerRow === 0) {
        cx = x;
        cy += icon + pad;
      }
    }
  }

  // -----------------------------
  // ITEM ICON DRAWING (render API)
  // -----------------------------
  async drawItemIcon(ctx, item, x, y, size) {
    const url = this.getEquipmentImageUrl(item);

    let img = null;
    try {
      img = await this.loadImageFromUrl(url);
    } catch {
      img = null;
    }

    if (img) {
      ctx.drawImage(img, x, y, size, size);
    } else {
      ctx.fillStyle = "rgba(255,255,255,0.08)";
      ctx.fillRect(x, y, size, size);
      ctx.strokeStyle = "rgba(255,255,255,0.20)";
      ctx.strokeRect(x + 0.5, y + 0.5, size - 1, size - 1);
    }

    const count = item?.Count ?? 0;
    if (count > 1) {
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      this._roundRect(ctx, x + size - 38, y + size - 28, 34, 22, 6);
      ctx.fill();

      ctx.fillStyle = "#FFF";
      ctx.font = "16px Arial";
      ctx.textAlign = "center";
      ctx.fillText(String(count), x + size - 21, y + size - 12);
    }
  }

  getEquipmentImageUrl(equipment) {
    return equipment?.Type
      ? `https://render.albiononline.com/v1/item/${equipment.Type}.png?count=${equipment.Count || 1}&quality=${equipment.Quality || 1}`
      : "";
  }

  // -----------------------------
  // PRICE ESTIMATION (AODP West) with fallbacks + outlier guard
  // -----------------------------
  async fetchPriceMap(items) {
    const norm = (s) => String(s || "").trim();
    const uniquePairs = new Set();
  
    const itemIds = [];
    const qualities = new Set();
  
    for (const it of items || []) {
      if (!it?.Type) continue;
      const type = norm(it.Type);
      const q = it.Quality || 1;
      qualities.add(q);
  
      const pairKey = `${type}|${q}`;
      if (!uniquePairs.has(pairKey)) {
        uniquePairs.add(pairKey);
        itemIds.push(type);
      }
    }
  
    if (itemIds.length === 0) return new Map();
  
    const batches = [];
    const batchSize = 50;
    for (let i = 0; i < itemIds.length; i += batchSize) {
      batches.push(itemIds.slice(i, i + batchSize));
    }
  
    const qList = [...qualities].sort((a, b) => a - b).join(",");
  
    // We store best-known row per (item_id|quality) after evaluating cities
    const map = new Map();
  
    // Helper: decide if a row is usable (has at least one non-junk signal)
    const isUsable = (row) => {
      if (!row) return false;
      const avg = Number(row.sell_price_avg) || 0;
      const buy = Number(row.buy_price_max) || 0;
      const min = Number(row.sell_price_min) || 0;
  
      if (avg > 0) return true;
      if (buy > 0) return true;
  
      // min is allowed only if not absurd
      if (min > 0 && min <= this.MIN_SELL_CAP) return true;
      return false;
    };
  
    // Iterate locations in priority order. First usable wins.
    for (const location of this.PRICE_LOCATIONS) {
      for (const batch of batches) {
        const url =
          `${this.PRICE_HOST}/api/v2/stats/prices/${batch.join(",")}.json` +
          `?locations=${encodeURIComponent(location)}` +
          `&qualities=${encodeURIComponent(qList)}`;
  
        const rows = await this.fetchJson(url);
  
        for (const row of rows || []) {
          const key = `${row.item_id}|${row.quality}`;
  
          // If we already have a usable row for this key, keep it (earlier city wins)
          const existing = map.get(key);
          if (existing && isUsable(existing)) continue;
  
          // Otherwise store this row (even if unusable; later cities may overwrite)
          map.set(key, row);
        }
  
        // Be nice to API
        await new Promise((r) => setTimeout(r, 120));
      }
  
      // If after this location, all keys have usable rows, we can stop early
      // (Optional optimization)
      let allDone = true;
      for (const key of uniquePairs) {
        // uniquePairs is type|q, but map keys are item_id|quality too, same idea.
        // We'll just skip this micro-optimization to keep it simple/robust.
        allDone = false;
        break;
      }
      // Keep going; city fallback matters most on missing data, not speed.
    }
  
    return map;
  }
  
  // B + A: prefer avg, then buy_max, then sell_min (capped)
  pickPrice(row) {
    if (!row) return 0;
  
    const sellAvg = Number(row.sell_price_avg) || 0;
    const buyMax  = Number(row.buy_price_max) || 0;
    const sellMin = Number(row.sell_price_min) || 0;
  
    if (sellAvg > 0) return sellAvg;
    if (buyMax > 0) return buyMax;
  
    // Outlier guard for low-volume / manipulated min listings
    if (sellMin > 0 && sellMin <= this.MIN_SELL_CAP) return sellMin;
  
    return 0;
  }
  
  sumItemValue(items, priceMap, opts = {}) {
    const { ignoreCounts = false } = opts;
  
    let total = 0;
  
    for (const it of items || []) {
      if (!it?.Type) continue;
  
      const q = it.Quality || 1;
  
      // Build should not multiply stack counts
      const count = ignoreCounts ? 1 : (it.Count || 1);
  
      const key = `${it.Type}|${q}`;
      const row = priceMap.get(key);
  
      total += this.pickPrice(row) * count;
    }
  
    return Math.round(total);
  }

  formatSilver(n) {
    const num = Number(n) || 0;
    const fmt = (value, suffix) => `${value.toFixed(1).replace(/\.0$/, "")}${suffix}`;
    if (num >= 1_000_000_000) return fmt(num / 1_000_000_000, "B");
    if (num >= 1_000_000) return fmt(num / 1_000_000, "M");
    if (num >= 1_000) return fmt(num / 1_000, "K");
    return num.toString();
  }

  async fetchJson(url) {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "AlbionKillbot/1.0",
        "Accept": "application/json",
      },
    });
    if (!res.ok) throw new Error(`price fetch failed ${res.status}`);
    return await res.json();
  }

  // -----------------------------
  // URL IMAGE LOADING
  // -----------------------------
  async loadImageFromUrl(url) {
    const buf = await this.fetchBuffer(url);
    return await loadImage(buf);
  }

  async fetchBuffer(url) {
    const res = await fetch(url, { headers: { "User-Agent": "AlbionKillbot/1.0" } });
    if (!res.ok) throw new Error(`fetch failed ${res.status} for ${url}`);
    const arr = await res.arrayBuffer();
    return Buffer.from(arr);
  }

  // -----------------------------
  // SIMPLE ICONS (drawn)
  // -----------------------------
  drawClockIcon(ctx, x, y, size) {
    const cx = x + size / 2;
    const cy = y + size / 2;
    const r = size * 0.42;

    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.lineWidth = 4;

    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();

    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx, cy - r * 0.45);
    ctx.stroke();

    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + r * 0.45, cy);
    ctx.stroke();

    ctx.restore();
  }

  drawPeopleIcon(ctx, x, y, size) {
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.lineWidth = 4;

    ctx.beginPath();
    ctx.arc(x + size * 0.38, y + size * 0.40, size * 0.12, 0, Math.PI * 2);
    ctx.arc(x + size * 0.62, y + size * 0.40, size * 0.12, 0, Math.PI * 2);
    ctx.stroke();

    ctx.beginPath();
    this._roundRect(ctx, x + size * 0.26, y + size * 0.52, size * 0.24, size * 0.22, 10);
    this._roundRect(ctx, x + size * 0.50, y + size * 0.52, size * 0.24, size * 0.22, 10);
    ctx.stroke();

    ctx.restore();
  }

  drawStarIcon(ctx, x, y, size) {
    const cx = x + size / 2;
    const cy = y + size / 2;
    const spikes = 5;
    const outerR = size * 0.45;
    const innerR = size * 0.20;

    ctx.save();
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.beginPath();

    let rot = (Math.PI / 2) * 3;
    const step = Math.PI / spikes;

    ctx.moveTo(cx, cy - outerR);
    for (let i = 0; i < spikes; i++) {
      ctx.lineTo(cx + Math.cos(rot) * outerR, cy + Math.sin(rot) * outerR);
      rot += step;
      ctx.lineTo(cx + Math.cos(rot) * innerR, cy + Math.sin(rot) * innerR);
      rot += step;
    }

    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // -----------------------------
  // UTIL
  // -----------------------------
  dFormatter(num) {
    const n = Number(num) || 0;
    return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  getStableColor(name) {
    const s = String(name || "");
    let hash = 0;
    for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
    const r = 80 + (hash & 0x7f);
    const g = 80 + ((hash >> 8) & 0x7f);
    const b = 80 + ((hash >> 16) & 0x7f);
    return `rgb(${r},${g},${b})`;
  }

  _roundRect(ctx, x, y, w, h, r) {
    const radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + w - radius, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
    ctx.lineTo(x + w, y + h - radius);
    ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    ctx.lineTo(x + radius, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }
}

module.exports = ImageGenerator;

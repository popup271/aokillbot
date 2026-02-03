const fs = require("fs");
const path = require("path");

class SummaryState {
  constructor(filePath = path.join(__dirname, "summary-state.json")) {
    this.filePath = filePath;
    this.state = {
      lastDailyKey: null,
      lastWeeklyKey: null,
      lastDailyPostedAt: 0,
      lastWeeklyPostedAt: 0,
    };
    this._load();
  }

  _load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
        if (parsed && typeof parsed === "object") {
          this.state = { ...this.state, ...parsed };
        }
      }
    } catch (e) {
      console.warn("SummaryState: failed to load summary-state.json:", e.message);
    }
  }

  _save() {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2));
    } catch (e) {
      console.warn("SummaryState: failed to save summary-state.json:", e.message);
    }
  }

  getDailyKey() {
    return this.state.lastDailyKey;
  }
  getWeeklyKey() {
    return this.state.lastWeeklyKey;
  }
  getDailyPostedAt() {
    return Number(this.state.lastDailyPostedAt) || 0;
  }
  getWeeklyPostedAt() {
    return Number(this.state.lastWeeklyPostedAt) || 0;
  }

  markDaily(dayKey) {
    this.state.lastDailyKey = dayKey;
    this.state.lastDailyPostedAt = Date.now();
    this._save();
  }

  markWeekly(dayKey) {
    this.state.lastWeeklyKey = dayKey;
    this.state.lastWeeklyPostedAt = Date.now();
    this._save();
  }
}

module.exports = SummaryState;

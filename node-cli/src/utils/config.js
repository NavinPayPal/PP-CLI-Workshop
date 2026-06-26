'use strict';

/**
 * config.js — workshop configuration
 *
 * Single place that resolves LEADERBOARD_URL for every command.
 * Priority order:
 *   1. LEADERBOARD_URL env var (explicit, always wins)
 *   2. ~/.paypal-workshop/config.json  (set once with: workshop:config --url ...)
 *   3. http://localhost:3002           (default for local dev)
 *
 * Quick-start for attendees:
 *   node cli/src/index.js workshop:config --url https://abc123.ngrok.io
 *   # Then all subsequent commands automatically use that URL
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');

const CONFIG_DIR  = path.join(os.homedir(), '.paypal-workshop');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

function readConfigFile() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function writeConfigFile(data) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  const existing = readConfigFile();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({ ...existing, ...data }, null, 2));
}

/**
 * Resolve the leaderboard URL from env → config file → default.
 */
function getLeaderboardUrl() {
  if (process.env.LEADERBOARD_URL) return process.env.LEADERBOARD_URL.replace(/\/$/, '');
  const cfg = readConfigFile();
  if (cfg.leaderboard_url) return cfg.leaderboard_url.replace(/\/$/, '');
  return 'http://localhost:3002';
}

/**
 * Test whether the leaderboard is reachable.
 * Returns { ok, url, latency_ms, error? }
 */
async function pingLeaderboard(url) {
  url = url || getLeaderboardUrl();
  const start = Date.now();
  try {
    const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(4000) });
    const data = await res.json();
    return { ok: res.ok, url, latency_ms: Date.now() - start, ...data };
  } catch (e) {
    return { ok: false, url, latency_ms: Date.now() - start, error: e.message };
  }
}

module.exports = { getLeaderboardUrl, pingLeaderboard, readConfigFile, writeConfigFile, CONFIG_FILE };

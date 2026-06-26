#!/usr/bin/env node
'use strict';

/**
 * preflight.js — Workshop setup health check
 *
 * Checks:
 *   1. Node version >= 20
 *   2. npm install has been run (node_modules present)
 *   3. Ports 3001 and 3002 are free (kills stale processes if asked)
 *
 * Run:
 *   node scripts/preflight.js          — check only
 *   node scripts/preflight.js --fix    — auto-kill port conflicts
 */

const { execSync, spawnSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

const FIX  = process.argv.includes('--fix');
const ROOT = path.join(__dirname, '..');

let allOk = true;

function ok(msg)   { console.log('  ✓', msg); }
function fail(msg) { console.log('  ✗', msg); allOk = false; }
function warn(msg) { console.log('  ⚠', msg); }
function section(title) { console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 50 - title.length))}`); }

// ── 1. Node version ────────────────────────────────────────────────────────
section('Node.js version');
const nodeVer = process.versions.node.split('.').map(Number);
if (nodeVer[0] >= 20) {
  ok(`Node ${process.versions.node} (>= 20 required)`);
} else {
  fail(`Node ${process.versions.node} is too old — need Node 20+. Install from https://nodejs.org`);
}

// ── 2. Dependencies installed ─────────────────────────────────────────────
// npm workspaces hoists everything into the root node_modules.
// Just check root node_modules exists and key packages are present.
section('Dependencies');
const rootNm = path.join(ROOT, 'node_modules');
if (!fs.existsSync(rootNm)) {
  fail('node_modules missing — run: npm install');
} else {
  ok('node_modules (root)');
  // Spot-check a few key packages
  const required = ['concurrently', '@clack/prompts', 'express', 'chalk'];
  for (const pkg of required) {
    const pkgPath = path.join(rootNm, pkg);
    if (fs.existsSync(pkgPath)) {
      ok(`  ${pkg}`);
    } else {
      fail(`  ${pkg} missing — run: npm install`);
    }
  }
}

// ── 3. Port availability ──────────────────────────────────────────────────
section('Ports');
function getPid(port) {
  try {
    const out = execSync(`lsof -tiTCP:${port} -sTCP:LISTEN 2>/dev/null`, { encoding: 'utf8' }).trim();
    return out || null;
  } catch { return null; }
}

for (const port of [3001, 3002]) {
  const pid = getPid(port);
  if (!pid) {
    ok(`Port ${port} is free`);
  } else if (FIX) {
    try {
      execSync(`kill ${pid}`);
      warn(`Port ${port} was in use (PID ${pid}) — killed`);
    } catch {
      fail(`Port ${port} is in use (PID ${pid}) — could not kill. Run: kill ${pid}`);
    }
  } else {
    fail(`Port ${port} is in use (PID ${pid}). Run: node scripts/preflight.js --fix  to clear it`);
  }
}

// ── Summary ───────────────────────────────────────────────────────────────
console.log('');
if (allOk) {
  console.log('  🎉  All checks passed — you are ready to start the workshop!');
  console.log('');
  console.log('  Next:  npm run workshop:start');
  console.log('');
} else {
  console.log('  Fix the issues above then re-run: node scripts/preflight.js');
  console.log('');
  process.exit(1);
}

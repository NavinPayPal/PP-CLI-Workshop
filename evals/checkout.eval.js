'use strict';

/**
 * Eval suite for the paypal:checkout exercise (Section 02).
 *
 * Requires PayPal sandbox credentials — set them first:
 *   node node-cli/src/index.js workshop:config --paypal-client-id <id> --paypal-secret <secret>
 *
 * Run:
 *   node evals/checkout.eval.js
 *   WORKSHOP_NAME="Alice" node evals/checkout.eval.js
 */

const path = require('path');
const { CliAgentSim } = require('../node-cli/src/utils/cli-agent-sim');
const { readConfigFile, getLeaderboardUrl } = require('../node-cli/src/utils/config');

const CLI             = `node ${path.join(__dirname, '../node-cli/src/index.js')}`;
const _cfg            = readConfigFile();
const WORKSHOP_NAME   = process.env.WORKSHOP_NAME || _cfg.workshop_name || null;
const LEADERBOARD_URL = process.env.LEADERBOARD_URL || getLeaderboardUrl();

// Check PayPal credentials are configured
const CLIENT_ID = process.env.PAYPAL_CLIENT_ID || _cfg.paypal_client_id;
const SECRET    = process.env.PAYPAL_SECRET    || _cfg.paypal_secret;
const HAVE_CREDS = !!(CLIENT_ID && SECRET);

// ── Task → eval mapping ───────────────────────────────────────────────────────
const TASK_MAP = {
  'broken: exits with error before completing':              null,
  'check: emits prompt events on stderr':                 'checkout_todo_1',
  'check: no ANSI codes in JSON events':                  'checkout_todo_1',
  'check: emits token_obtained event':                    'checkout_todo_1',
  'check: order_created event has real order ID':         'checkout_todo_2',
  'check: order_created event has approve_url':           'checkout_todo_2',
  'check: order_captured event fires':                    'checkout_todo_3',
  'check: order_captured status is COMPLETED':            'checkout_todo_3',
  'check: emits complete event (emitComplete called)':    'checkout_todo_4',
  'check: all API tests pass':                            'checkout_eval',
};

async function reportToLeaderboard(tasks, tokens, elapsed_ms) {
  if (!WORKSHOP_NAME) return;
  try {
    await fetch(`${LEADERBOARD_URL}/api/checkin/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: WORKSHOP_NAME, tasks, source: 'eval', tokens, elapsed_ms }),
    });
    console.log(`\n  ✓ Reported ${tasks.length} task(s) to leaderboard for ${WORKSHOP_NAME}`);
  } catch {
    console.log('\n  (Leaderboard not running — checkin skipped)');
  }
}

async function runEvals() {
  let passed = 0;
  let failed = 0;
  const passedTasks = new Set();
  const evalStart   = Date.now();
  let totalTokens   = 0;

  let skipped = 0;

  async function test(name, fn) {
    process.stdout.write(`  ${name} ... `);
    try {
      await fn();
      console.log('✓ pass');
      passed++;
      const taskId = TASK_MAP[name];
      if (taskId) passedTasks.add(taskId);
    } catch (e) {
      if (e.message === 'SKIP') {
        console.log('⊘ skip');
        skipped++;
      } else {
        console.log('✗ FAIL —', e.message);
        failed++;
      }
    }
  }

  function assert(cond, msg) { if (!cond) throw new Error(msg); }

  function skipIfNoCreds(name, fn) {
    return test(name, async () => {
      if (!HAVE_CREDS) throw new Error('SKIP');
      await fn();
    });
  }

  // ── Section: Broken exercise ──────────────────────────────────────────────
  console.log('\n── Broken exercise (paypal:checkout) ─────────────────────────────');
  console.log('   Expected: exits with error before completing (TODOs throw)\n');

  await test('broken: exits with error before completing', async () => {
    const sim = new CliAgentSim({ strategy: 'use-defaults', timeout_ms: 8000 });
    const result = await sim.run(
      `${CLI} paypal:checkout --eval`,
      { PAYPAL_CLIENT_ID: CLIENT_ID || 'dummy', PAYPAL_SECRET: SECRET || 'dummy' }
    );
    // Should error out (TODO throws) or if creds missing emit MISSING_CREDENTIALS
    const hasError = result.containsEvent({ event: 'error' }) || result.exit_code !== 0;
    assert(hasError, `Expected error event or non-zero exit, got exit ${result.exit_code}`);
  });

  // ── Section: Check instrumentation ──────────────────────────────────────────
  console.log('\n── Check instrumentation (paypal:checkout-check) ─────────────────');
  console.log('   Expected: emits clean prompt events, no ANSI, good structure\n');

  await test('check: emits prompt events on stderr', async () => {
    // Even without real creds, prompts fire before the API call
    const sim = new CliAgentSim({ strategy: 'use-defaults', timeout_ms: 8000 });
    const result = await sim.run(`${CLI} paypal:checkout-check --eval`,
      { PAYPAL_CLIENT_ID: 'dummy', PAYPAL_SECRET: 'dummy' });
    const prompts = result.eventsOfType('prompt');
    assert(prompts.length >= 2, `Expected ≥2 prompt events, got ${prompts.length}`);
    for (const p of prompts) {
      assert(p.field, `Prompt missing 'field': ${JSON.stringify(p)}`);
      assert(p.type,  `Prompt missing 'type': ${JSON.stringify(p)}`);
      assert(p.step,  `Prompt missing 'step': ${JSON.stringify(p)}`);
    }
  });

  await test('check: no ANSI codes in JSON events', async () => {
    const sim = new CliAgentSim({ strategy: 'use-defaults', timeout_ms: 8000 });
    const result = await sim.run(`${CLI} paypal:checkout-check --eval`,
      { PAYPAL_CLIENT_ID: 'dummy', PAYPAL_SECRET: 'dummy' });
    // eslint-disable-next-line no-control-regex
    const ansiRe = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><~]/;
    for (const evt of result.events) {
      const raw = JSON.stringify(evt);
      assert(!ansiRe.test(raw), `ANSI codes found in event: ${raw.slice(0, 120)}`);
    }
  });

  // ── Section: Real PayPal API (requires credentials) ───────────────────────
  console.log('\n── Real PayPal API ────────────────────────────────────────────────');
  if (!HAVE_CREDS) {
    console.log('   ⚠  SKIPPED — set PayPal credentials to run API tests:');
    console.log('   node node-cli/src/index.js workshop:config --paypal-client-id <id> --paypal-secret <secret>\n');
  } else {
    console.log('   Expected: full create → capture flow with sandbox credentials\n');
  }

  await skipIfNoCreds('check: emits token_obtained event', async () => {
    const sim = new CliAgentSim({ strategy: 'use-defaults', timeout_ms: 20000 });
    const result = await sim.run(`${CLI} paypal:checkout-check --eval --amount 1.00`);
    assert(!result.hung,    'Command hung');
    assert(result.containsEvent({ event: 'token_obtained' }), 'Missing token_obtained event');
  });

  await skipIfNoCreds('check: order_created event has real order ID', async () => {
    const sim = new CliAgentSim({ strategy: 'use-defaults', timeout_ms: 20000 });
    const result = await sim.run(`${CLI} paypal:checkout-check --eval --amount 1.00`);
    const created = result.eventsOfType('order_created');
    assert(created.length > 0, 'Missing order_created event');
    const orderId = created[0].order_id;
    // Real PayPal order IDs are 17 uppercase alphanumeric chars
    assert(/^[A-Z0-9]{17}$/.test(orderId),
      `order_id looks fake: "${orderId}" — expected 17-char PayPal format`);
    assert(!orderId.startsWith('MOCK'), 'order_id starts with MOCK — real API not called');
  });

  await skipIfNoCreds('check: order_created event has approve_url', async () => {
    const sim = new CliAgentSim({ strategy: 'use-defaults', timeout_ms: 20000 });
    const result = await sim.run(`${CLI} paypal:checkout-check --eval --amount 1.00`);
    const created = result.eventsOfType('order_created');
    assert(created.length > 0, 'Missing order_created event');
    // In eval mode with card, approve_url may be null (auto-captured) — that's fine
    // What matters is the field is present in the event
    assert('approve_url' in created[0], 'order_created event missing approve_url field');
  });

  await skipIfNoCreds('check: order_captured event fires', async () => {
    const sim = new CliAgentSim({ strategy: 'use-defaults', timeout_ms: 25000 });
    const result = await sim.run(`${CLI} paypal:checkout-check --eval --amount 1.00`);
    assert(!result.hung, 'Command hung during capture');
    assert(result.containsEvent({ event: 'order_captured' }),
      'Missing order_captured event — is TODO-3 implemented?');
  });

  await skipIfNoCreds('check: order_captured status is COMPLETED', async () => {
    const sim = new CliAgentSim({ strategy: 'use-defaults', timeout_ms: 25000 });
    const result = await sim.run(`${CLI} paypal:checkout-check --eval --amount 1.00`);
    const captured = result.eventsOfType('order_captured');
    assert(captured.length > 0, 'Missing order_captured event');
    assert(captured[0].status === 'COMPLETED',
      `Expected status COMPLETED, got "${captured[0].status}"`);
  });

  await skipIfNoCreds('check: emits complete event (emitComplete called)', async () => {
    const sim = new CliAgentSim({ strategy: 'use-defaults', timeout_ms: 25000 });
    const result = await sim.run(`${CLI} paypal:checkout-check --eval --amount 1.00`);
    if (result.tokens) totalTokens += result.tokens;
    assert(result.exit_code === 0, `Expected exit 0, got ${result.exit_code}`);
    assert(result.containsEvent({ event: 'complete' }),
      'Missing complete event — is TODO-4 (emitComplete) implemented?');
  });

  await skipIfNoCreds('check: all API tests pass', async () => {
    // Meta-test: passes only if all 5 API tests above passed
    const apiTests = [
      'check: emits token_obtained event',
      'check: order_created event has real order ID',
      'check: order_created event has approve_url',
      'check: order_captured event fires',
      'check: order_captured status is COMPLETED',
      'check: emits complete event (emitComplete called)',
    ];
    const allPassed = apiTests.every((t) => passedTasks.has(TASK_MAP[t]));
    assert(allPassed, 'Not all API tests passed — fix the failing tests above first');
  });

  // ── Summary ────────────────────────────────────────────────────────────────
  const elapsed_ms = Date.now() - evalStart;
  console.log(`\n  Results: ${passed} passed, ${failed} failed${skipped ? `, ${skipped} skipped` : ''}`);
  if (!HAVE_CREDS) {
    console.log('  ⚠  API tests skipped — add PayPal credentials to unlock Section 02 points');
  }
  if (totalTokens) console.log(`  TPOK: ${totalTokens} tokens  ⏱  ${(elapsed_ms / 1000).toFixed(1)}s`);

  // ── Leaderboard report ─────────────────────────────────────────────────────
  if (passedTasks.size > 0) {
    await reportToLeaderboard([...passedTasks], totalTokens || null, elapsed_ms);
  } else if (WORKSHOP_NAME) {
    console.log('\n  (No tasks passed — nothing reported to leaderboard)');
  } else {
    console.log('\n  Tip: set WORKSHOP_NAME="Your Name" to auto-report to the leaderboard');
  }

  process.exit(failed > 0 ? 1 : 0);
}

runEvals().catch((e) => { console.error(e); process.exit(1); });

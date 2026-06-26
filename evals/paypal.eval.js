'use strict';

/**
 * paypal.eval.js — Eval suite for the PayPal Checkout bonus mission.
 *
 * Tests:
 *   baseline     — exercise hangs without agent instrumentation
 *   bonus-1      — credential prompt events emitted on stderr
 *   bonus-2      — all prompt events have required fields
 *   bonus-3      — html file generated containing PayPal SDK script
 *   bonus-4      — emits a complete event
 *
 * Run:
 *   node evals/paypal.eval.js
 *   WORKSHOP_NAME="Alice" PAYPAL_CLIENT_ID=<id> PAYPAL_SECRET=<s> node evals/paypal.eval.js
 */

const path = require('path');
const fs   = require('fs');
const { CliAgentSim } = require('../node-cli/src/utils/cli-agent-sim');
const { getLeaderboardUrl, readConfigFile } = require('../node-cli/src/utils/config');

const CLI            = `node ${path.join(__dirname, '../node-cli/src/index.js')}`;
const LEADERBOARD_URL = process.env.LEADERBOARD_URL || getLeaderboardUrl();
const _cfg           = readConfigFile();
const WORKSHOP_NAME  = process.env.WORKSHOP_NAME || _cfg.workshop_name || null;
const HTML_OUT       = path.join(process.cwd(), 'paypal-checkout.html');

const TASK_MAP = {
  'baseline: paypal:setup hangs without instrumentation': null,
  'bonus-1: credential prompt events emitted on stderr':  'bonus_paypal_creds',
  'bonus-2: all prompt events have required fields':       'bonus_paypal_creds',
  'bonus-3: generates paypal-checkout.html with sdk':      'bonus_paypal_button',
  'bonus-4: emits a complete event':                       'bonus_paypal_button',
};

async function reportToLeaderboard(tasks, elapsed_ms) {
  if (!WORKSHOP_NAME) return;
  try {
    await fetch(`${LEADERBOARD_URL}/api/checkin/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: WORKSHOP_NAME, tasks, source: 'eval', elapsed_ms }),
    });
    console.log(`\n  ✓ Reported ${tasks.length} mission(s) to leaderboard for ${WORKSHOP_NAME}`);
  } catch {
    console.log('\n  (Leaderboard not running — checkin skipped)');
  }
}

async function runEvals() {
  let passed = 0;
  let failed = 0;
  const passedTasks = new Set();
  const start = Date.now();

  async function test(name, fn) {
    process.stdout.write(`  ${name} ... `);
    try {
      await fn();
      console.log('✓ pass');
      passed++;
      const taskId = TASK_MAP[name];
      if (taskId) passedTasks.add(taskId);
    } catch (e) {
      console.log('✗ FAIL —', e.message);
      failed++;
    }
  }

  function assert(cond, msg) { if (!cond) throw new Error(msg); }

  // Clean up HTML output before each run
  function cleanHtml() { try { fs.unlinkSync(HTML_OUT); } catch {} }

  // Use real credentials if available, otherwise use placeholders
  const clientId = process.env.PAYPAL_CLIENT_ID || 'SANDBOX_CLIENT_ID_PLACEHOLDER';
  const secret   = process.env.PAYPAL_SECRET    || 'SANDBOX_SECRET_PLACEHOLDER';
  const hasRealCreds = !!process.env.PAYPAL_CLIENT_ID;

  // ── Baseline ────────────────────────────────────────────────────────────────
  console.log('\n── Baseline (broken paypal:setup) ─────────────────────────────');
  console.log('   Expected: hangs without prompt events on stderr\n');

  await test('baseline: paypal:setup hangs without instrumentation', async () => {
    const sim = new CliAgentSim({ strategy: 'use-defaults', timeout_ms: 3000 });
    const result = await sim.run(`${CLI} paypal:setup`);
    assert(result.hung === true, 'Expected CLI to hang without emitPrompt() calls');
  });

  // ── Bonus Mission ───────────────────────────────────────────────────────────
  console.log('\n── Bonus Mission — PayPal Checkout ────────────────────────────');
  console.log('   Expected: prompts emitted, HTML generated, complete event\n');

  await test('bonus-1: credential prompt events emitted on stderr', async () => {
    cleanHtml();
    const sim = new CliAgentSim({ strategy: 'use-defaults', timeout_ms: 15000 });
    const result = await sim.run(
      `${CLI} paypal:setup-check --client-id ${clientId} --secret ${secret}`
    );
    // With flags, credential prompts are skipped — but complete event must fire
    // Test without flags to verify prompts are emitted
    const sim2 = new CliAgentSim({ strategy: 'use-defaults', timeout_ms: 15000 });
    const result2 = await sim2.run(`${CLI} paypal:setup-check`);
    const prompts = result2.eventsOfType('prompt');
    assert(prompts.length >= 2, `Expected ≥2 prompt events (client_id, secret), got ${prompts.length}`);
  });

  await test('bonus-2: all prompt events have required fields', async () => {
    const sim = new CliAgentSim({ strategy: 'use-defaults', timeout_ms: 15000 });
    const result = await sim.run(`${CLI} paypal:setup-check`);
    for (const p of result.eventsOfType('prompt')) {
      assert(p.field, `Prompt missing 'field': ${JSON.stringify(p)}`);
      assert(p.type,  `Prompt missing 'type': ${JSON.stringify(p)}`);
      assert(p.step,  `Prompt missing 'step': ${JSON.stringify(p)}`);
    }
  });

  await test('bonus-3: generates paypal-checkout.html with sdk', async () => {
    cleanHtml();
    const sim = new CliAgentSim({ strategy: 'use-defaults', timeout_ms: 15000 });
    await sim.run(`${CLI} paypal:setup-check --client-id ${clientId} --secret ${secret}`);
    assert(fs.existsSync(HTML_OUT), 'paypal-checkout.html was not generated');
    const html = fs.readFileSync(HTML_OUT, 'utf8');
    assert(html.includes('paypal.com/sdk/js'), 'HTML missing PayPal JS SDK script tag');
    assert(html.includes('paypal.Buttons'),    'HTML missing paypal.Buttons() call');
    assert(html.includes(clientId),             'HTML missing client ID in SDK URL');
  });

  await test('bonus-4: emits a complete event', async () => {
    cleanHtml();
    const sim = new CliAgentSim({ strategy: 'use-defaults', timeout_ms: 15000 });
    const result = await sim.run(
      `${CLI} paypal:setup-check --client-id ${clientId} --secret ${secret}`
    );
    assert(result.containsEvent({ event: 'complete' }), 'Missing complete event — add emitComplete()');
    const completeEvt = result.eventsOfType('complete')[0];
    assert(
      completeEvt?.outputs?.some((o) => o.endsWith('.html')),
      'complete event outputs should include the generated HTML file'
    );
  });

  // ── Summary ─────────────────────────────────────────────────────────────────
  const elapsed_ms = Date.now() - start;
  console.log(`\n  Results: ${passed} passed, ${failed} failed`);

  if (!hasRealCreds) {
    console.log('\n  Note: running with placeholder credentials — OAuth2 validation skipped.');
    console.log('  Set PAYPAL_CLIENT_ID and PAYPAL_SECRET to test live credential validation.');
  }

  if (failed === 0) {
    passedTasks.add('bonus_paypal_eval');
    console.log('  🎉 All PayPal bonus tests pass!');
  }

  if (passedTasks.size > 0) {
    await reportToLeaderboard([...passedTasks], elapsed_ms);
  } else if (WORKSHOP_NAME) {
    console.log('\n  No bonus tasks to report yet — keep going!');
  } else {
    console.log('\n  Tip: set WORKSHOP_NAME="Your Name" to auto-report to the leaderboard.');
  }

  console.log('');
  process.exit(failed > 0 ? 1 : 0);
}

runEvals();

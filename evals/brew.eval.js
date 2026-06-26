'use strict';

/**
 * brew.eval.js — Eval suite for the Barista 9000 brew command.
 *
 * Also auto-reports passing missions to the live leaderboard
 * (if WORKSHOP_NAME is set and leaderboard is running).
 *
 * Run:
 *   npm run check
 *   WORKSHOP_NAME="Alice" npm run check
 */

const path = require('path');
const { CliAgentSim } = require('../node-cli/src/utils/cli-agent-sim');

const CLI = `node ${path.join(__dirname, '../node-cli/src/index.js')}`;
const { getLeaderboardUrl, readConfigFile } = require('../node-cli/src/utils/config');
const LEADERBOARD_URL = process.env.LEADERBOARD_URL || getLeaderboardUrl();
const _cfg = readConfigFile();
const WORKSHOP_NAME = process.env.WORKSHOP_NAME || _cfg.workshop_name || null;

// ── Mission → eval mapping ────────────────────────────────────────────────────
// Each test name maps to the mission task ID it proves
const TASK_MAP = {
  'baseline: brew hangs without agent instrumentation': null,
  'mission-1: use-defaults completes without hanging':   'mission_1',
  'mission-1: prompt events emitted on stderr':          'mission_1',
  'mission-1: all prompt events have required fields':   'mission_1',
  'mission-2: state resumes after interrupt':            'mission_2',
  'mission-3: flags shortcut skips all prompts':         'mission_3',
  'mission-3: emits a complete event':                   'mission_3',
  'ansi: no color codes in any JSON event':              'mission_1',
  'ipc: channel completes cleanly':                      'ipc_channel',
  'ipc: TPOK under 500 ms':                              'ipc_channel',
};

async function reportToLeaderboard(tasks, tokens, elapsed_ms) {
  if (!WORKSHOP_NAME) return;
  try {
    await fetch(`${LEADERBOARD_URL}/api/checkin/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: WORKSHOP_NAME, tasks, source: 'eval', tokens, elapsed_ms }),
    });
    console.log(`\n  ✓ Reported ${tasks.length} mission(s) to leaderboard for ${WORKSHOP_NAME}`);
  } catch {
    console.log(`\n  (Leaderboard not running — checkin skipped. Start: cd leaderboard && node server.js)`);
  }
}

async function runEvals() {
  let passed = 0;
  let failed = 0;
  const passedTasks = new Set();
  const evalStart = Date.now();
  let totalTokens = 0;

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

  function assert(condition, message) {
    if (!condition) throw new Error(message);
  }

  // ── Baseline ────────────────────────────────────────────────────────────────
  console.log('\n── Baseline (broken brew) ─────────────────────────────────────');
  console.log('   Expected: hangs without Mission 1 instrumentation\n');

  await test('baseline: brew hangs without agent instrumentation', async () => {
    const sim = new CliAgentSim({ strategy: 'use-defaults', timeout_ms: 3000 });
    const result = await sim.run(`${CLI} brew`);
    assert(result.hung === true, 'Expected CLI to hang without prompt events on stderr');
  });

  // ── Mission 1: Make it speak ────────────────────────────────────────────────
  console.log('\n── Mission 1 — Make it speak ──────────────────────────────────');
  console.log('   Expected: prompt events on stderr, no more freezing\n');

  await test('mission-1: use-defaults completes without hanging', async () => {
    const sim = new CliAgentSim({ strategy: 'use-defaults', timeout_ms: 12000 });
    const result = await sim.run(`${CLI} brew-check`);
    assert(result.hung === false, 'CLI hung — add emitPrompt() before each prompt');
    assert(result.exit_code === 0, `Expected exit 0, got ${result.exit_code}`);
  });

  await test('mission-1: prompt events emitted on stderr', async () => {
    const sim = new CliAgentSim({ strategy: 'use-defaults', timeout_ms: 12000 });
    const result = await sim.run(`${CLI} brew-check`);
    const prompts = result.eventsOfType('prompt');
    assert(prompts.length >= 3, `Expected ≥3 prompt events (size, shots, milk), got ${prompts.length}`);
  });

  await test('mission-1: all prompt events have required fields', async () => {
    const sim = new CliAgentSim({ strategy: 'use-defaults', timeout_ms: 12000 });
    const result = await sim.run(`${CLI} brew-check`);
    for (const p of result.eventsOfType('prompt')) {
      assert(p.field,   `Prompt missing 'field': ${JSON.stringify(p)}`);
      assert(p.type,    `Prompt missing 'type': ${JSON.stringify(p)}`);
      assert(p.step,    `Prompt missing 'step': ${JSON.stringify(p)}`);
      assert(p.choices, `Prompt missing 'choices': ${JSON.stringify(p)}`);
    }
  });

  // ── Mission 2: Make it remember ─────────────────────────────────────────────
  console.log('\n── Mission 2 — Make it remember ───────────────────────────────');
  console.log('   Expected: interrupt mid-order, re-run, it continues\n');

  await test('mission-2: state resumes after interrupt', async () => {
    // Seed partial state directly via FlowState
    const r1 = await (new CliAgentSim({ strategy: 'use-defaults', timeout_ms: 4000 })).run(
      `node -e "
        process.env.WORKSHOP_AGENT_MODE='1';
        const { FlowState } = require('${path.join(__dirname, '../node-cli/src/utils/agent')}');
        (async () => {
          const s = new FlowState('brew');
          await s.init();
          await s.setStep('step_1', { size: 'medium' });
          await s.setStep('step_2', { shots: '2' });
          process.exit(0);
        })();
      "`
    );
    // Now run brew-check — it should detect saved state
    const sim = new CliAgentSim({ strategy: 'use-defaults', timeout_ms: 12000 });
    const result = await sim.run(`${CLI} brew-check`);
    assert(result.hung === false, 'CLI hung during resume test');
    assert(
      result.containsEvent({ event: 'flow_resume_available' }) ||
      result.containsEvent({ event: 'complete' }),
      'Expected flow_resume_available or complete event — add FlowState persistence'
    );
  });

  // ── Mission 3: Make it finish ───────────────────────────────────────────────
  console.log('\n── Mission 3 — Make it finish ─────────────────────────────────');
  console.log('   Expected: flags bypass all prompts, complete event on exit\n');

  await test('mission-3: flags shortcut skips all prompts', async () => {
    const sim = new CliAgentSim({ strategy: 'use-defaults', timeout_ms: 10000 });
    const result = await sim.run(`${CLI} brew-check --size large --shots 2 --milk oat`);
    assert(result.hung === false, 'CLI hung even with flags');
    assert(result.exit_code === 0, `Expected exit 0, got ${result.exit_code}`);
    // Should have no (or very few) prompts since flags were supplied
    const prompts = result.eventsOfType('prompt').filter((p) => ['size','shots','milk'].includes(p.field));
    assert(prompts.length === 0, `Flags should skip prompts, but got ${prompts.length} prompt(s)`);
  });

  await test('mission-3: emits a complete event', async () => {
    const sim = new CliAgentSim({ strategy: 'use-defaults', timeout_ms: 12000 });
    const result = await sim.run(`${CLI} brew-check`);
    assert(result.containsEvent({ event: 'complete' }), 'Missing complete event — add emitComplete()');
  });

  // ── ANSI hygiene ────────────────────────────────────────────────────────────
  console.log('\n── ANSI hygiene ───────────────────────────────────────────────');
  console.log('   Expected: all JSON events are clean — no color escape codes\n');

  await test('ansi: no color codes in any JSON event', async () => {
    const sim = new CliAgentSim({ strategy: 'use-defaults', timeout_ms: 12000 });
    const result = await sim.run(`${CLI} brew-check`);
    // eslint-disable-next-line no-control-regex
    const ansiRe = /[][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><~]/;
    for (const evt of result.events) {
      const raw = JSON.stringify(evt);
      assert(!ansiRe.test(raw), `ANSI codes found in event: ${raw.slice(0, 120)}`);
    }
  });

  // ── IPC side channel ─────────────────────────────────────────────────────────
  console.log('\n── IPC side channel (advanced) ────────────────────────────────');
  console.log('   Expected: answers via socket, TPOK < 500 ms\n');

  await test('ipc: channel completes cleanly', async () => {
    const sim = new CliAgentSim({ strategy: 'use-defaults', timeout_ms: 15000, ipc: true });
    const result = await sim.run(`${CLI} brew-check`);
    assert(result.hung === false, 'IPC mode hung');
    assert(result.exit_code === 0, `Expected exit 0, got ${result.exit_code}`);
    assert(result.containsEvent({ event: 'complete' }), 'Missing complete event over IPC');
    if (result.tokens) totalTokens += result.tokens;
  });

  await test('ipc: TPOK under 500 ms', async () => {
    const sim = new CliAgentSim({ strategy: 'use-defaults', timeout_ms: 15000, ipc: true });
    const result = await sim.run(`${CLI} brew-check`);
    assert(result.hung === false, 'Hung during TPOK test');
    assert(result.tokens < 500, `Token usage too high: ${result.tokens} (limit 500)`);
    if (result.tokens) totalTokens = Math.max(totalTokens, result.tokens);
  });

  // ── Summary ──────────────────────────────────────────────────────────────────
  const elapsed_ms = Date.now() - evalStart;
  console.log(`\n  Results: ${passed} passed, ${failed} failed`);
  if (totalTokens) console.log(`  TPOK: ${totalTokens} tokens  ⏱  ${(elapsed_ms / 1000).toFixed(1)}s`);

  const missionTests = passed - 1; // subtract the baseline hang test
  if (failed === 0 && missionTests >= 9) {
    passedTasks.add('eval_pass');
    console.log('  🎉 All tests pass!');
  }

  if (passedTasks.size > 0) {
    await reportToLeaderboard([...passedTasks], totalTokens || null, elapsed_ms);
  } else if (WORKSHOP_NAME) {
    console.log('\n  No missions to report yet — keep going!');
  } else {
    console.log('\n  Tip: set WORKSHOP_NAME="Your Name" to auto-report to the leaderboard.');
  }

  console.log('');
  process.exit(failed > 0 ? 1 : 0);
}

runEvals();

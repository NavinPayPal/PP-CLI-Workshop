'use strict';

/**
 * brew-check — Barista 9000, fully instrumented
 *
 * All three missions complete. Compare with brew.js to see what changed.
 *
 * Run (human):    node node-cli/src/index.js brew-check
 * Run (agent):    WORKSHOP_AGENT_MODE=1 node node-cli/src/index.js brew-check 2>events.jsonl
 * Flags shortcut: node node-cli/src/index.js brew-check --size large --shots 2 --milk oat
 */

const chalk = require('chalk');
const {
  isAgent,
  emitConfirm,
  emitComplete,
  getSpinner,
  FlowState,
  emitEvent,
} = require('../../utils/agent');
const { agentSelect, agentConfirm } = require('../../utils/prompt');

const SIZES = ['small', 'medium', 'large'];
const SHOTS = ['1', '2', '3'];
const MILKS = ['whole', 'oat', 'almond', 'none'];

const PRICE = {
  small: 3.50, medium: 4.00, large: 4.50,
  shot: 0.70,
  oat: 0.60, almond: 0.60, whole: 0.00, none: 0.00,
};

function buildReceipt(size, shots, milk) {
  const basePrice = PRICE[size];
  const shotPrice = (parseInt(shots, 10) - 1) * PRICE.shot;
  const milkPrice = PRICE[milk] || 0;
  const total = basePrice + shotPrice + milkPrice;
  return { size, shots: parseInt(shots, 10), milk, total: parseFloat(total.toFixed(2)) };
}

async function brewSolution(program) {
  program
    .command('brew-check')
    .description('Order a coffee — fully instrumented reference implementation')
    // ── Mission 3: flags let agents (and humans) skip all prompts ─────────────
    .option('--size <size>',  'Coffee size: small | medium | large', null)
    .option('--shots <n>',    'Number of espresso shots: 1 | 2 | 3', null)
    .option('--milk <type>',  'Milk type: whole | oat | almond | none', null)
    .action(async (opts) => {
      const agent = isAgent();

      // Load @clack lazily — avoids TTY hooks when running as a piped subprocess
      const { intro, outro, cancel } = agent
        ? { intro: () => {}, outro: () => {}, cancel: () => {} }
        : require('@clack/prompts');

      // ── Mission 2: resumable state ────────────────────────────────────────
      const state = new FlowState('brew');
      const existing = await state.load();
      if (existing?.current_step) {
        emitEvent({
          event: 'flow_resume_available',
          flow_name: 'brew',
          current_step: existing.current_step,
          data: existing.data,
        });
        const resume = await agentConfirm({
          message: 'Resume your previous order?',
          step: 0, of: 4, field: 'resume', initialValue: true,
        });
        if (!resume) await state.init();
      } else {
        await state.init();
      }

      if (!agent) intro(chalk.bold('☕  Barista 9000'));

      // ── STEP 1 — size ─────────────────────────────────────────────────────
      let size = opts.size || state.get('size');
      if (!size) {
        // Mission 1: emitPrompt is handled inside agentSelect
        size = await agentSelect({
          message: 'What size?',
          step: 1, of: 4, field: 'size',
          choices: SIZES, initialValue: 'medium',
          options: SIZES.map((s) => ({ value: s, label: s })),
        });
        if (!size) { cancel('Order cancelled'); return; }
        await state.setStep('step_1', { size });
      }

      // ── STEP 2 — shots ────────────────────────────────────────────────────
      let shots = opts.shots || state.get('shots');
      if (!shots) {
        shots = await agentSelect({
          message: 'How many shots?',
          step: 2, of: 4, field: 'shots',
          choices: SHOTS, initialValue: '2',
          options: SHOTS.map((n) => ({ value: n, label: `${n} shot${n > 1 ? 's' : ''}` })),
        });
        if (!shots) { cancel('Order cancelled'); return; }
        await state.setStep('step_2', { shots });
      }

      // ── STEP 3 — milk ─────────────────────────────────────────────────────
      let milk = opts.milk || state.get('milk');
      if (!milk) {
        milk = await agentSelect({
          message: 'Milk preference?',
          step: 3, of: 4, field: 'milk',
          choices: MILKS, initialValue: 'oat',
          options: MILKS.map((m) => ({ value: m, label: m })),
        });
        if (!milk) { cancel('Order cancelled'); return; }
        await state.setStep('step_3', { milk });
      }

      // ── STEP 4 — confirm ──────────────────────────────────────────────────
      const receipt = buildReceipt(size, shots, milk);
      const summary = `${receipt.size} · ${receipt.shots} shot(s) · ${receipt.milk} milk — $${receipt.total.toFixed(2)}`;
      emitConfirm('place_coffee_order', 'low', true);
      const ok = await agentConfirm({
        message: `Confirm order: ${summary}?`,
        step: 4, of: 4, field: 'confirm_order', initialValue: true,
      });
      if (!ok) { cancel('Order cancelled'); return; }

      // Pour…
      const sp = getSpinner('Brewing your coffee…').start();
      await new Promise((r) => setTimeout(r, 600));
      sp.succeed('Coffee ready!');

      const outputFile = `receipt-${Date.now()}.json`;
      if (!agent) {
        outro(chalk.green(`✓ Enjoy your ${receipt.size} coffee! Total: $${receipt.total.toFixed(2)}`));
      } else {
        // Print a clean receipt table to stdout for humans watching
        console.log(`\nLatte · ${receipt.size.charAt(0).toUpperCase() + receipt.size.slice(1)}`);
        if (receipt.shots > 1) console.log(`+ Extra shot ×${receipt.shots - 1}      $${((receipt.shots - 1) * PRICE.shot).toFixed(2)}`);
        if (receipt.milk !== 'none' && receipt.milk !== 'whole') console.log(`+ ${receipt.milk.charAt(0).toUpperCase() + receipt.milk.slice(1)} milk        $${PRICE[receipt.milk].toFixed(2)}`);
        console.log(`─────────────────────────`);
        console.log(`TOTAL                    $${receipt.total.toFixed(2)}`);
      }

      // ── Mission 3: completion signal ──────────────────────────────────────
      emitComplete([outputFile], ['node node-cli/src/index.js workshop:checkin', 'open paypal-checkout.html']);
      await state.complete([outputFile]);
    });
}

module.exports = { brewSolution };

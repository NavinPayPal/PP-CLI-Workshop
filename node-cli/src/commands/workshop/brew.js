'use strict';

/**
 * brew — Barista 9000 coffee ordering CLI
 *
 * This is the STARTING STATE for the hands-on exercise.
 * It works fine for humans but hangs when an agent drives it.
 *
 * THREE MISSIONS to complete (each marked with a TODO):
 *
 *   Mission 1 — Make it speak
 *     Add emitPrompt() before each prompt so the agent knows what to answer.
 *
 *   Mission 2 — Make it remember
 *     Add FlowState so an interrupted order resumes where it stopped.
 *
 *   Mission 3 — Make it finish
 *     Accept --size / --shots / --milk flags and emit emitComplete() on success.
 *
 * Run (human):
 *   npm run brew
 *
 * Run (agent sim — hangs until Mission 1 is done):
 *   npm run brew:as-agent
 *
 * Check your progress:
 *   npm run check
 *
 */

const { select, confirm, intro, outro, cancel } = require('@clack/prompts');
const chalk = require('chalk');
const {
  isAgent,
  emitPrompt,
  emitConfirm,
  emitComplete,
  getSpinner,
  FlowState,
} = require('../../utils/agent');

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

async function brew(program) {
  program
    .command('brew')
    .description('Order a coffee from Barista 9000 (exercise — needs agent instrumentation)')
    // ── Mission 3 TODO: add .option() flags so agents can skip all prompts ────
    // .option('--size <size>',  'Coffee size: small | medium | large')
    // .option('--shots <n>',    'Number of espresso shots: 1 | 2 | 3')
    // .option('--milk <type>',  'Milk type: whole | oat | almond | none')
    .action(async (opts) => {
      intro(chalk.bold('☕  Barista 9000'));

      // ── Mission 2 TODO: add FlowState so the order survives interruption ────
      // const state = new FlowState('brew');
      // await state.init();

      // ── STEP 1 — size ─────────────────────────────────────────────────────
      // Mission 1 TODO: add emitPrompt() here so the agent can answer "size"
      const size = await select({
        message: 'What size?',
        options: SIZES.map((s) => ({ value: s, label: s })),
      });
      if (!size) { cancel('Order cancelled'); return; }
      // Mission 2 TODO: await state.setStep('step_1', { size });

      // ── STEP 2 — shots ────────────────────────────────────────────────────
      // Mission 1 TODO: add emitPrompt() here so the agent can answer "shots"
      const shots = await select({
        message: 'How many shots?',
        options: SHOTS.map((n) => ({ value: n, label: `${n} shot${n > 1 ? 's' : ''}` })),
      });
      if (!shots) { cancel('Order cancelled'); return; }
      // Mission 2 TODO: await state.setStep('step_2', { shots });

      // ── STEP 3 — milk ─────────────────────────────────────────────────────
      // Mission 1 TODO: add emitPrompt() here so the agent can answer "milk"
      const milk = await select({
        message: 'Milk preference?',
        options: MILKS.map((m) => ({ value: m, label: m })),
      });
      if (!milk) { cancel('Order cancelled'); return; }
      // Mission 2 TODO: await state.setStep('step_3', { milk });

      // ── STEP 4 — confirm ──────────────────────────────────────────────────
      const receipt = buildReceipt(size, shots, milk);
      const summary = `${receipt.size} · ${receipt.shots} shot(s) · ${receipt.milk} milk — $${receipt.total.toFixed(2)}`;
      // Mission 1 TODO: add emitConfirm() + emitPrompt() here
      const ok = await confirm({ message: `Confirm order: ${summary}?` });
      if (!ok) { cancel('Order cancelled'); return; }

      // Pour…
      const sp = getSpinner('Brewing your coffee…').start();
      await new Promise((r) => setTimeout(r, 1000));
      sp.succeed('Coffee ready!');

      const agent = isAgent();
      if (!agent) outro(chalk.green(`✓ Enjoy your ${receipt.size} coffee! Total: $${receipt.total.toFixed(2)}`));

      // Mission 3 TODO: emit emitComplete() with the receipt file and next steps
      // emitComplete([`receipt-${Date.now()}.json`], ['node cli/src/index.js quest:play']);
      // await state.complete();
    });
}

module.exports = { brew };

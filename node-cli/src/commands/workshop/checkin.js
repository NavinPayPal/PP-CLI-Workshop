'use strict';

/**
 * workshop:checkin — report task completion to the live leaderboard
 *
 * Auto-called by the eval harness when tests pass.
 * Can also be run manually to check in for any task.
 *
 * Usage:
 *   node src/index.js workshop:checkin
 *   node src/index.js workshop:checkin --name "Alice" --task todo_1
 *   node src/index.js workshop:checkin --name "Alice" --task eval_pass --source eval
 */

const { intro, outro, cancel } = require('@clack/prompts');
const chalk = require('chalk');
const { isAgent, emitEvent, emitComplete, emitError } = require('../../utils/agent');
const { agentText, agentSelect } = require('../../utils/prompt');
const { getLeaderboardUrl } = require('../../utils/config');

const LEADERBOARD = getLeaderboardUrl();

const VALID_TASKS = [
  { id: 'mission_1',   label: 'Mission 1 — Make it speak'           },
  { id: 'mission_2',   label: 'Mission 2 — Make it remember'        },
  { id: 'mission_3',   label: 'Mission 3 — Make it finish'          },
  { id: 'eval_pass',   label: 'Evals ✓ — all tests passing'         },
  { id: 'ipc_channel', label: 'IPC ✓ — TPOK < 500 ms'              },
  { id: 'tmux_launch', label: 'Cockpit — launched via tmux'         },
  { id: 'bonus_cli',          label: 'Bonus CLI — drove a second CLI'              },
  { id: 'bonus_paypal_creds',  label: 'PAY-1 — credentials + prompt events'         },
  { id: 'bonus_paypal_button', label: 'PAY-2 — generated paypal-checkout.html'      },
  { id: 'bonus_paypal_eval',   label: 'PayPal Evals — all bonus tests pass'          },
];

async function workshopCheckin(program) {
  program
    .command('workshop:checkin')
    .description('Check in a completed task to the live leaderboard')
    .option('--name <name>',   'Your name (skips prompt)')
    .option('--task <task>',   'Task ID to check in (skips prompt)')
    .option('--source <src>',  'Source: manual | eval | cli', 'manual')
    .option('--batch <tasks>', 'Comma-separated task IDs for batch checkin')
    .action(async (opts) => {
      const agent = isAgent();
      // Pull saved name from config if not passed explicitly
      const cfg = require('../../utils/config').readConfigFile();
      if (!opts.name && cfg.workshop_name) opts.name = cfg.workshop_name;
      if (!agent) intro(chalk.bold.cyan('✓  Workshop Checkin'));

      // ── Name ──────────────────────────────────────────────────
      let name = opts.name;
      if (!name) {
        name = await agentText({
          message: 'Your name', defaultValue: 'Attendee',
          step: 1, of: 2, field: 'name',
        });
        if (!name) { cancel('Cancelled'); return; }
      }

      // ── Task ──────────────────────────────────────────────────
      // Batch mode (used by eval harness)
      if (opts.batch) {
        const tasks = opts.batch.split(',').map((t) => t.trim()).filter(Boolean);
        await batchCheckin(name, tasks, opts.source);
        if (!agent) outro(chalk.green(`✓ Checked in ${tasks.length} tasks for ${name}`));
        emitComplete([], ['node src/index.js workshop:checkin --name "' + name + '" --task eval_pass']);
        return;
      }

      let task = opts.task;
      if (!task) {
        // No --task flag: just register the name with no task (0 pts for joining).
        // Tasks are reported automatically by evals or with --task flag.
        await joinOnly(name, agent);
        if (!agent) outro(chalk.green(`✓ ${name} registered! Tasks are auto-reported when you run the eval.`));
        emitComplete([], ['node src/index.js workshop:checkin --name "' + name + '" --task eval_pass']);
        return;
      }

      await singleCheckin(name, task, opts.source, agent);
      if (!agent) outro(chalk.green(`✓ Checked in: ${task} for ${name}`));
      emitComplete([], []);
    });
}

async function joinOnly(name, agent) {
  try {
    // POST a batch with empty tasks array — this registers the attendee with 0 pts
    const res = await fetch(`${LEADERBOARD}/api/checkin/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, tasks: [], source: 'manual' }),
    });
    const data = await res.json();
    emitEvent({ event: 'checkin_result', name, task: null, score: data.score,
                total_tasks: data.total_tasks, joined: true });
    return data;
  } catch {
    emitError('LEADERBOARD_UNAVAILABLE',
      'Leaderboard not running. Start with: cd leaderboard && node server.js', false);
    if (!agent) console.log(chalk.yellow('\n  Leaderboard not running — your name was not registered.\n  Start it: cd leaderboard && node server.js'));
  }
}

async function singleCheckin(name, task, source, agent) {
  try {
    const res = await fetch(`${LEADERBOARD}/api/checkin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, task, source }),
    });
    const data = await res.json();
    emitEvent({ event: 'checkin_result', name, task, score: data.score,
                total_tasks: data.total_tasks, already: data.already });
    return data;
  } catch {
    emitError('LEADERBOARD_UNAVAILABLE',
      'Leaderboard not running. Start with: cd leaderboard && node server.js', false);
    if (!agent) console.log(chalk.yellow('\n  Leaderboard not running — checkin not recorded.\n  Start it: cd leaderboard && node server.js'));
  }
}

async function batchCheckin(name, tasks, source) {
  try {
    const res = await fetch(`${LEADERBOARD}/api/checkin/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, tasks, source }),
    });
    const data = await res.json();
    emitEvent({ event: 'batch_checkin_result', name, tasks, score: data.score,
                new_tasks: data.new_tasks, total_tasks: data.total_tasks });
    return data;
  } catch {
    emitError('LEADERBOARD_UNAVAILABLE',
      'Leaderboard not running. Start with: cd leaderboard && node server.js', false);
  }
}

// Export the helpers so the eval harness can call them directly
module.exports = { workshopCheckin, singleCheckin, batchCheckin };

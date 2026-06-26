'use strict';
/**
 * Leaderboard Server
 *
 *   /api/progress          — workshop attendee task completions
 *   /api/events            — SSE stream
 *   POST /api/checkin      — manual or auto checkin from CLI / eval harness
 */

const express  = require('express');
const cors     = require('cors');
const path     = require('path');
const app      = express();
const PORT     = process.env.PORT || 3002;

app.use(cors());
app.use(express.json());

// -- Task definitions ---------------------------------------------------------
const TASKS = [
  { id: 'mission_1',   label: 'Mission 1', desc: 'Make it speak — prompt events on stderr',   section: 'Exercise' },
  { id: 'mission_2',   label: 'Mission 2', desc: 'Make it remember — interrupt & resume',      section: 'Exercise' },
  { id: 'mission_3',   label: 'Mission 3', desc: 'Make it finish — flags + complete signal',   section: 'Exercise' },
  { id: 'eval_pass',   label: 'Evals ✓',  desc: 'All brew eval tests passing',                 section: 'Exercise' },
  { id: 'ipc_channel', label: 'IPC ✓',    desc: 'IPC side channel passes, TPOK < 500 ms',     section: 'Exercise' },
  { id: 'tmux_launch', label: 'Cockpit',  desc: 'Launched workshop cockpit via tmux',          section: 'Exercise' },
  { id: 'bonus_cli',          label: 'Bonus CLI',      desc: 'Drove a second CLI end-to-end',                   section: 'Bonus' },
  { id: 'bonus_paypal_creds',  label: 'PAY-1',          desc: 'Got credentials + emitted prompt events',          section: 'Bonus' },
  { id: 'bonus_paypal_button', label: 'PAY-2',          desc: 'Generated paypal-checkout.html with SDK button',   section: 'Bonus' },
  { id: 'bonus_paypal_eval',   label: 'PayPal Evals ✓', desc: 'All PayPal bonus eval tests pass',                 section: 'Bonus' },
];

// -- In-memory state ----------------------------------------------------------
const attendees = new Map();
const eventLog  = [];

// -- SSE clients --------------------------------------------------------------
const sseClients = new Set();

function broadcast(event, data) {
  const payload = JSON.stringify({ event, data, ts: Date.now() });
  eventLog.push(payload);
  sseClients.forEach((res) => res.write(`data: ${payload}\n\n`));
}

// -- Helpers ------------------------------------------------------------------
function scoreFor(tasks) {
  const pts = {
    mission_1: 30, mission_2: 30, mission_3: 30,
    eval_pass: 50, ipc_channel: 40, tmux_launch: 10,
    bonus_cli: 25,
    bonus_paypal_creds: 20, bonus_paypal_button: 20, bonus_paypal_eval: 10,
  };
  return [...tasks].reduce((s, t) => s + (pts[t] || 5), 0);
}

function serializeAttendees() {
  return [...attendees.values()]
    .map((a) => ({ ...a, tasks: [...a.tasks], score: scoreFor(a.tasks) }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const at = a.tokens ?? Infinity;
      const bt = b.tokens ?? Infinity;
      if (at !== bt) return at - bt;
      const ae = a.elapsed_ms ?? Infinity;
      const be = b.elapsed_ms ?? Infinity;
      return ae - be;
    })
    .map((a, i) => ({ rank: i + 1, ...a }));
}

function getOrCreate(name) {
  const key = name.trim().toLowerCase();
  if (!attendees.has(key)) {
    const a = {
      name: name.trim(), key,
      joined_at: new Date().toISOString(),
      tasks: new Set(),
      tokens: null,
      elapsed_ms: null,
    };
    attendees.set(key, a);
    broadcast('attendee_joined', { name: a.name });
  }
  return attendees.get(key);
}

// -- Routes -------------------------------------------------------------------

app.get('/', (_, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.get('/api/progress', (_, res) => {
  res.json({ tasks: TASKS, attendees: serializeAttendees() });
});

app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  eventLog.forEach((e) => res.write(`data: ${e}\n\n`));
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

app.post('/api/checkin', (req, res) => {
  const { name, task, source = 'manual', tokens, elapsed_ms } = req.body;
  if (!name || !task) return res.status(400).json({ error: 'name and task required' });
  const validTask = TASKS.find((t) => t.id === task);
  if (!validTask) return res.status(400).json({ error: `unknown task: ${task}`, valid: TASKS.map((t) => t.id) });

  const attendee = getOrCreate(name);
  const already  = attendee.tasks.has(task);
  attendee.tasks.add(task);

  if (typeof tokens === 'number')     attendee.tokens     = attendee.tokens     === null ? tokens     : Math.min(attendee.tokens, tokens);
  if (typeof elapsed_ms === 'number') attendee.elapsed_ms = attendee.elapsed_ms === null ? elapsed_ms : Math.min(attendee.elapsed_ms, elapsed_ms);

  const score = scoreFor(attendee.tasks);
  if (!already) broadcast('task_complete', { name: attendee.name, task, task_label: validTask.label, score, source, total_tasks: attendee.tasks.size });

  res.json({ name: attendee.name, task, score, total_tasks: attendee.tasks.size, tasks_complete: [...attendee.tasks], already });
});

app.post('/api/checkin/batch', (req, res) => {
  const { name, tasks, source = 'eval', tokens, elapsed_ms } = req.body;
  if (!name || !Array.isArray(tasks)) return res.status(400).json({ error: 'name and tasks[] required' });

  const attendee = getOrCreate(name);
  const newTasks = [];
  tasks.forEach((task) => {
    const validTask = TASKS.find((t) => t.id === task);
    if (validTask && !attendee.tasks.has(task)) { attendee.tasks.add(task); newTasks.push(task); }
  });

  if (typeof tokens === 'number')     attendee.tokens     = attendee.tokens     === null ? tokens     : Math.min(attendee.tokens, tokens);
  if (typeof elapsed_ms === 'number') attendee.elapsed_ms = attendee.elapsed_ms === null ? elapsed_ms : Math.min(attendee.elapsed_ms, elapsed_ms);

  if (newTasks.length) broadcast('tasks_batch_complete', { name: attendee.name, new_tasks: newTasks, score: scoreFor(attendee.tasks), total_tasks: attendee.tasks.size, source });

  res.json({ name: attendee.name, score: scoreFor(attendee.tasks), tasks_complete: [...attendee.tasks], new_tasks: newTasks });
});

app.get('/health', (_, res) => res.json({ status: 'ok', attendees: attendees.size, port: PORT }));

// -- Start --------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`\n  Leaderboard on http://localhost:${PORT}`);
  console.log(`  POST /api/checkin       { name, task }    — manual checkin`);
  console.log(`  POST /api/checkin/batch { name, tasks[] } — eval auto-report`);
  console.log(`  GET  /api/progress      — workshop standings`);
  console.log(`  GET  /api/events        — SSE stream\n`);
});

module.exports = app;

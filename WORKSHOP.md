# ☕ Talk to the Robot — Agentic CLI Workshop
### AI Engineer · 2 Hours

> **Prerequisites:** Node.js 20+, a terminal, and this repo cloned.
> Clone: `git clone https://github.com/paypal/cli-workshop && cd cli-workshop`
> Install: `npm install`

---

## Agenda

| # | Section | Time |
|---|---------|------|
| 01 | Why — scripts vs agents, the mental shift | 15 min |
| 02 | Patterns — dual output · state · signals | 20 min |
| 03 | Build — three missions on Barista 9000 | 35 min |
| 04 | Observe — tmux cockpit + IPC side channel | 30 min |
| 05 | Measure — evals that prove it never hangs | 15 min |
| 06 | Ship — leaderboard · Q&A | 15 min |

---

## Section 03 · Build — Barista 9000

The exercise CLI is a coffee bot called **Barista 9000**.
Its `brew` command works great for humans but hangs the moment an agent drives it.
Your job is to fix it across three missions.

**Step 1 — Reproduce the failure**
```bash
npm run brew           # works fine for you ✓
npm run brew:as-agent  # hangs — Ctrl+C to escape
```

**Step 2 — Open the exercise file**
```
node-cli/src/commands/workshop/brew.js   (Node.js)
barista/commands/brew.py            (Python track)
```
Find the mission TODOs and implement each one.

---

### Mission 1 — Make it speak

Add `emitPrompt()` before each prompt so the agent knows what to answer.

```js
// Before every select() / confirm() call:
emitPrompt({
  type: 'select',     // 'select' | 'input' | 'confirm'
  step: 1,            // current step number
  of: 4,              // total steps
  field: 'size',      // machine-readable key
  message: 'What size?',
  choices: SIZES,     // valid values
  default: 'medium',
  resumable: true,
});
```

**Win condition:** `npm run brew:as-agent` reaches the first answer instead of hanging.

---

### Mission 2 — Make it remember

Add `FlowState` so an interrupted order picks up exactly where it stopped.

```js
const { FlowState } = require('../../utils/agent');
const state = new FlowState('brew');
await state.init();

// After each step answer is collected:
await state.setStep('step_1', { size });

// On success:
await state.complete();
```

**Win condition:** Kill the CLI mid-order with Ctrl+C, run `npm run brew` again — it resumes at the next step, no re-asking.

---

### Mission 3 — Make it finish

Accept `--size`, `--shots`, and `--milk` flags and emit `emitComplete()` on success.

```js
// Add to your command:
.option('--size <size>',  'Coffee size: small | medium | large')
.option('--shots <n>',    'Espresso shots: 1 | 2 | 3')
.option('--milk <type>',  'Milk type: whole | oat | almond | none')

// On success:
emitComplete([`receipt-${Date.now()}.json`], ['node node-cli/src/index.js quest:play']);
```

**Win condition:**
```bash
node node-cli/src/index.js brew --size large --shots 2 --milk oat
# → no prompts, clean exit 0, complete event on stderr
```

---

## Section 04 · Observe — cockpit

**Option A — tmux (recommended)**
```bash
npm run cockpit
# Sets up three panes: editor | events | check
```

**Option B — three terminals**
- Terminal 1: open `node-cli/src/commands/workshop/brew.js`
- Terminal 2: `WORKSHOP_AGENT_MODE=1 node node-cli/src/index.js brew-check 2>events.jsonl && cat events.jsonl`
- Terminal 3: `npm run check`

### IPC side channel (advanced · optional)

```bash
WORKSHOP_IPC=1 WORKSHOP_AGENT_MODE=1 node node-cli/src/index.js brew-check 2>events.jsonl
```

The CLI opens a TCP socket and announces it with `{ event: "ipc_ready", port }`.
The agent connects and streams answers instead of typing to stdin.
Goal: **TPOK < 500 ms** (time from prompt event → accepted answer).

---

## Section 05 · Measure — evals

```bash
npm run check
# or with leaderboard auto-report:
WORKSHOP_NAME="Your Name" npm run check
```

**What the 10 tests check:**
```
── Baseline ────────────────────────────────────────────────
  baseline: brew hangs without instrumentation        ✓

── Mission 1 — Make it speak ───────────────────────────────
  mission-1: use-defaults completes without hanging   ✓
  mission-1: prompt events emitted on stderr          ✓
  mission-1: all prompt events have required fields   ✓

── Mission 2 — Make it remember ────────────────────────────
  mission-2: state resumes after interrupt            ✓

── Mission 3 — Make it finish ──────────────────────────────
  mission-3: flags shortcut skips all prompts         ✓
  mission-3: emits a complete event                   ✓

── ANSI hygiene ────────────────────────────────────────────
  ansi: no color codes in any JSON event              ✓

── IPC side channel ────────────────────────────────────────
  ipc: channel completes cleanly                      ✓
  ipc: TPOK under 500 ms                              ✓

Results: 10 passed, 0 failed  🎉
✓ Reported 4 mission(s) to leaderboard for Your Name
```

---

## Section 06 · Ship — leaderboard

### Start the leaderboard
```bash
cd leaderboard && npm install && node server.js
# → Open http://localhost:3002
```

### Check in automatically (eval harness)
```bash
WORKSHOP_NAME="Your Name" npm run check
# Passing tests auto-report missions to the leaderboard
```

### Check in manually
```bash
# Interactive:
node node-cli/src/index.js workshop:checkin

# Direct:
node node-cli/src/index.js workshop:checkin --name "Your Name" --task mission_1
```

### Scoring

**Main exercise (180 pts)**
| Task ID | Points | When |
|---------|--------|------|
| `mission_1` | 30 | Prompt events on stderr |
| `mission_2` | 30 | Interrupt & resume cleanly |
| `mission_3` | 30 | Flags + complete signal |
| `eval_pass` | 50 | All 10 eval tests pass |
| `ipc_channel` | 40 | TPOK < 500 ms via socket |
| `tmux_launch` | 10 | Launched cockpit via tmux |

**Side quests (75 pts)**
| Task ID | Points | When |
|---------|--------|------|
| `bonus_cli` | 25 | Drove a second CLI end-to-end |
| `bonus_paypal_creds` | 20 | Credential prompts emitted as events |
| `bonus_paypal_button` | 20 | Generated paypal-checkout.html with JS SDK |
| `bonus_paypal_eval` | 10 | All PayPal bonus eval tests pass |

---

## Bonus Mission — PayPal Checkout Button

### Step 1 — Get credentials

1. Go to https://developer.paypal.com/dashboard
2. Click **Apps & Credentials** → **Create App** (Sandbox)
3. Copy your **Client ID** and **Secret**

### Step 2 — Run the setup command

```bash
# Interactive (prompts for credentials):
node node-cli/src/index.js paypal:setup

# Or pass credentials directly:
node node-cli/src/index.js paypal:setup \
  --client-id YOUR_CLIENT_ID \
  --secret YOUR_SECRET
```

The command validates credentials via the sandbox OAuth2 endpoint, then generates `paypal-checkout.html` with a live PayPal button.

### Step 3 — Open the generated page

```bash
open paypal-checkout.html
# Click "Pay with PayPal" to test a sandbox checkout
```

### Step 4 — Run the bonus evals

```bash
# With real credentials:
PAYPAL_CLIENT_ID=your-id PAYPAL_SECRET=your-secret npm run check:paypal

# Without credentials (structural tests still run):
npm run check:paypal
```

### What the exercise teaches

The `paypal:setup` exercise (`node-cli/src/commands/workshop/bonus-paypal.js`) hangs in agent mode. Apply the same three patterns:

- **TODO-1**: Add `emitPrompt()` before the `client_id` and `secret` text inputs
- **TODO-2**: Replace `console.log` spinner with `getSpinner()` / `NoopSpinner`
- **TODO-3**: Add `emitComplete([outFile], [...])` on success

---

## Troubleshooting

**CLI hangs with `brew:as-agent`**
→ Mission 1 not done yet. Add `emitPrompt()` before every `select()` / `confirm()` call.

**State file not found on resume**
→ State files live in `~/.paypal-workshop/state/`. Check: `ls ~/.paypal-workshop/state/`

**`npm run check` shows ipc tests failing**
→ The IPC tests are advanced — finish the three missions first, then tackle IPC.

---

## Resources

| Resource | URL |
|----------|-----|
| Workshop repo | github.com/paypal/cli-workshop |
| agent.js utilities | `node-cli/src/utils/agent.js` |
| prompt.js wrappers | `node-cli/src/utils/prompt.js` |
| CliAgentSim | `node-cli/src/utils/cli-agent-sim.js` |
| PayPal Orders API | https://developer.paypal.com/docs/api/orders/v2/ |
| PayPal Sandbox | https://developer.paypal.com/dashboard |

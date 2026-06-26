# AGENTS.md — Agentic CLI Workshop

This file tells AI agents how to interact with this CLI.

## Entry point

```
node node-cli/src/index.js <command>
```

## Environment

Always set: `WORKSHOP_AGENT_MODE=1`
This enables structured stderr events, suppresses ANSI color, and swaps spinners for no-ops.

## Available commands

| Command | What it does |
|---------|-------------|
| `brew` | **Exercise** — hangs in agent mode until the attendee adds instrumentation |
| `brew-check` | Reference implementation — all three missions complete, drives cleanly |
| `paypal:setup` | **Bonus exercise** — hangs in agent mode until the attendee adds instrumentation |
| `paypal:setup-check` | Bonus reference — validates credentials and generates `paypal-checkout.html` |
| `workshop:config` | Set attendee name and leaderboard URL |
| `workshop:checkin` | Report a completed task to the live leaderboard |

## How to drive commands

All instrumented commands emit structured JSON on **stderr** before each prompt.
Read stderr events and respond on **stdin**.

### Prompt event schema
```json
{ "event": "prompt", "type": "select", "step": 1, "of": 4,
  "field": "size", "choices": ["small","medium","large"],
  "default": "medium", "resumable": true }
```

### Strategy
- `select` — respond with one of the `choices` values, or `default` if no preference.
- `input` — respond with a short string matching the `field` semantics.
- `confirm` — respond `yes` or `no`. Default is usually `true` (yes).

### Completion signal
```json
{ "event": "complete", "outputs": ["receipt-1234.json"],
  "next_steps": ["node node-cli/src/index.js workshop:checkin"] }
```
Use `next_steps` to determine what to run next.

### Error signal
```json
{ "event": "error", "code": "LEADERBOARD_UNAVAILABLE", "message": "...", "recoverable": false }
```
If `recoverable: false`, stop and report to the user. If `recoverable: true`, retry.

### Resume signal
If a previous run was interrupted mid-order:
```json
{ "event": "flow_resume_available", "current_step": "step_2", "data": { "size": "large" } }
```
Answer the next confirm prompt with `yes` to resume from the saved step.

## Workshop flow (agent task)

```
1.  WORKSHOP_AGENT_MODE=1 node node-cli/src/index.js brew-check 2>events.jsonl
    → Read prompt events from events.jsonl, answer via stdin
    → On complete event: run next_steps

2.  WORKSHOP_AGENT_MODE=1 node node-cli/src/index.js paypal:setup-check \
      --client-id $PAYPAL_CLIENT_ID --secret $PAYPAL_SECRET 2>events.jsonl
    → Generates paypal-checkout.html on success

3.  node node-cli/src/index.js workshop:checkin \
      --name "Attendee" --task eval_pass --source eval
    → Reports score to leaderboard at http://localhost:3002
```

## Python CLI (alternative track)

```
WORKSHOP_AGENT_MODE=1 workshop brew-check order-check \
  --size large --shots 2 --milk oat
```

Same event protocol — JSON on stderr, answers on stdin.

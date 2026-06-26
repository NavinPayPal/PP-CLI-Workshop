# PayPal CLI Workshop
### AI Engineer SF · Agentic-Optimized CLI Tools

A hands-on workshop repo. Build CLI tools that agents can actually drive.

## Quick start

```bash
npm install
node node-cli/src/index.js --help
```

## Workshop guide → [WORKSHOP.md](./WORKSHOP.md)

## Structure

```
paypal-cli-workshop/
├── node-cli/
│   └── src/
│       ├── index.js                          ← CLI entry point
│       ├── utils/
│       │   ├── agent.js                      ← Pattern library (isAgent, emitEvent, FlowState)
│       │   ├── cli-agent-sim.js              ← Eval harness
│       │   ├── config.js                     ← Config helpers
│       │   ├── ipc.js                        ← IPC side channel
│       │   └── prompt.js                     ← Prompt wrappers
│       └── commands/
│           └── workshop/
│               ├── brew.js                   ← Exercise — needs instrumentation
│               ├── brew-check.js             ← Reference implementation
│               ├── bonus-paypal.js           ← Bonus exercise (PayPal setup)
│               ├── bonus-paypal-check.js     ← Bonus reference
│               ├── config.js                 ← workshop:config
│               └── checkin.js                ← workshop:checkin
├── python-cli/
│   └── workshop/
│       ├── main.py                           ← Python CLI entry point
│       ├── commands/                         ← Python command implementations
│       └── utils/                            ← Python utilities (agent.py, config.py)
├── evals/
│   ├── brew.eval.js                          ← Main eval suite (10 tests)
│   ├── paypal.eval.js                        ← Bonus eval suite
│   └── checkout.eval.js                      ← Checkout eval suite
├── leaderboard/
│   └── server.js                             ← Live leaderboard (port 3002)
├── scripts/
│   ├── preflight.js                          ← Environment checks
│   └── tmux-workshop.sh                      ← Cockpit layout
├── WORKSHOP.md                               ← Step-by-step guide
└── AGENTS.md                                 ← Agent driving instructions
```

## Commands

| Command | Description |
|---------|-------------|
| `brew` | Exercise — hangs in agent mode until you add instrumentation |
| `brew-check` | Reference implementation — all three missions complete |
| `paypal:setup` | Bonus exercise — credential setup (hangs in agent mode) |
| `paypal:setup-check` | Bonus reference — validates credentials, generates checkout HTML |
| `workshop:config` | Set your name and leaderboard URL |
| `workshop:checkin` | Report a completed task to the live leaderboard |

## npm scripts

```bash
npm run brew              # Run brew command (human mode)
npm run brew:as-agent     # Run in agent mode — hangs until Mission 1 is done
npm run check             # Run all 10 eval tests
npm run check:paypal      # Run bonus eval suite
npm run cockpit           # Launch tmux workshop layout (3 panes)
npm run preflight         # Check environment
npm run start:leaderboard # Start leaderboard at http://localhost:3002
npm run cli               # Shorthand for node node-cli/src/index.js
```

## Test with an agent

```bash
# Set agent mode so the CLI emits structured JSON on stderr
WORKSHOP_AGENT_MODE=1 node node-cli/src/index.js brew-check 2>events.jsonl
# Watch stderr for the JSON event stream
cat events.jsonl
```

## Run evals

```bash
npm run check
# With leaderboard auto-report:
WORKSHOP_NAME="Your Name" npm run check
```

## Python track

```bash
cd python-cli
pip install -e .
WORKSHOP_AGENT_MODE=1 workshop brew-check --size large --shots 2 --milk oat
```

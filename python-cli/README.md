# PayPal CLI Workshop — Python

Python version of the workshop. Identical patterns to the Node.js version,
idiomatic Python using `click` + `rich` + `questionary`.

## Quick start

```bash
cd python-cli
pip install -e . --break-system-packages
workshop --help
```

## Commands

| Command | Description |
|---------|-------------|
| `workshop sandwich order` | Broken exercise (4 TODOs to fix) |
| `workshop brew-check order-check` | Reference implementation |
| `workshop config set --url <url> --name <name>` | Set leaderboard URL once |
| `workshop config set --ping` | Test connectivity |
| `workshop config set --show` | Show current config |
| `workshop checkin task` | Manual task checkin |
| `workshop quest scaffold` | Scaffold PayPal Quest game |
| `workshop quest leaderboard` | Scaffold leaderboard |
| `workshop quest play` | Play a round |

## Workshop exercise

```bash
# 1. Run the broken version — works for humans
workshop sandwich order

# 2. Test in agent mode — HANGS (no stderr events)
WORKSHOP_AGENT_MODE=1 workshop sandwich order

# 3. Open and fix the 4 TODOs
# workshop/commands/exercise.py

# 4. Run evals
python evals/sandwich_order_eval.py

# 5. With auto-leaderboard reporting
WORKSHOP_NAME="Alice" python evals/sandwich_order_eval.py
```

## Key files

```
python-cli/
├── workshop/
│   ├── utils/
│   │   ├── agent.py      ← is_agent(), emit_event(), FlowState, get_spinner()
│   │   ├── prompts.py    ← agent_select(), agent_text(), agent_confirm()
│   │   └── config.py     ← get_leaderboard_url(), ping_leaderboard()
│   └── commands/
│       ├── exercise.py          ← broken sandwich:order (4 TODOs)
│       ├── exercise_check.py ← reference implementation
│       ├── config_cmd.py        ← workshop:config
│       ├── checkin.py           ← workshop:checkin
│       └── quest.py             ← quest:scaffold / leaderboard / play
└── evals/
    └── sandwich_order_eval.py   ← 7 tests + leaderboard auto-report
```

## Pattern reference

```python
from workshop.utils.agent import is_agent, emit_prompt, emit_complete, FlowState, get_spinner
from workshop.utils.prompts import agent_select, agent_text, agent_confirm

# 1. Agent detection
if is_agent():
    print("running in agent mode")

# 2. Dual output — emit before every prompt
emit_prompt(type="select", step=1, of=4, field="bread",
            message="Choose your bread", choices=BREADS, default="sourdough")
bread = agent_select(message="Choose your bread", choices=BREADS,
                     default="sourdough", step=1, of=4, field="bread")

# 3. Resumable state
state = FlowState("my-command")
state.load()              # check for existing
state.set_step("step_1", bread=bread)   # persist after each step
state.complete()          # clean up on success

# 4. NoopSpinner
with get_spinner("Doing work...") as sp:
    time.sleep(1)
    sp.succeed("Done!")

# 5. Completion signal
emit_complete(outputs=["output.json"], next_steps=["workshop quest play"])
```

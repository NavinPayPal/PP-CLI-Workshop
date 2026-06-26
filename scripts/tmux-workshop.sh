#!/usr/bin/env bash
# tmux-workshop.sh — Launch the full workshop environment in a tmux session
#
# Layout:
#   ┌──────────────────┬──────────────────┐
#   │                  │  Leaderboard     │
#   │   Quest          │  :3002           │
#   │   :3001          ├──────────────────┤
#   │                  │  CLI (your work) │
#   └──────────────────┴──────────────────┘
#
# Usage:
#   npm run workshop:tmux
#   bash scripts/tmux-workshop.sh

set -e

SESSION="paypal-workshop"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# ── Preflight ─────────────────────────────────────────────────────────────────
echo ""
echo "  Running preflight checks..."
node "$ROOT/scripts/preflight.js" --fix
echo ""

# ── Kill existing session if any ──────────────────────────────────────────────
tmux kill-session -t "$SESSION" 2>/dev/null || true

# ── Create session (detached) + first window ─────────────────────────────────
# Window 0 — Quest server (left pane)
tmux new-session -d -s "$SESSION" -n "workshop" -x 220 -y 50

# Send quest server command to pane 0
tmux send-keys -t "$SESSION:0.0" "cd '$ROOT' && npm run start:quest" Enter

# ── Split right: Leaderboard (top-right) ─────────────────────────────────────
tmux split-window -t "$SESSION:0" -h
tmux send-keys -t "$SESSION:0.1" "cd '$ROOT' && sleep 1 && npm run start:leaderboard" Enter

# ── Split bottom-right: CLI shell ─────────────────────────────────────────────
tmux split-window -t "$SESSION:0.1" -v
tmux send-keys -t "$SESSION:0.2" "cd '$ROOT'" Enter
tmux send-keys -t "$SESSION:0.2" "clear && echo '' && echo '  Workshop CLI \u2014 run your commands here' && echo '' && echo '  \u2502 Quest server  \u2192 LEFT pane   (Ctrl+B \u2190 to view logs)' && echo '  \u2502 Leaderboard   \u2192 TOP-RIGHT   http://localhost:3002' && echo '  \u2502 CLI shell     \u2192 HERE (do not run servers in this pane)' && echo '' && echo '  node cli/src/index.js --help' && echo ''" Enter

# ── Resize panes: left pane wider ────────────────────────────────────────────
tmux resize-pane -t "$SESSION:0.0" -x 80

# ── Set pane titles ───────────────────────────────────────────────────────────
tmux select-pane -t "$SESSION:0.0" -T "Quest :3001"
tmux select-pane -t "$SESSION:0.1" -T "Leaderboard :3002"
tmux select-pane -t "$SESSION:0.2" -T "CLI"

# ── Focus the CLI pane ────────────────────────────────────────────────────────
tmux select-pane -t "$SESSION:0.2"

# ── Attach ────────────────────────────────────────────────────────────────────
echo "  Attaching to tmux session '$SESSION'..."
echo "  Tip: Ctrl+B then arrow keys to switch panes. Ctrl+B D to detach."
echo ""
tmux attach-session -t "$SESSION"

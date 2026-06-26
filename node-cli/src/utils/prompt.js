'use strict';

/**
 * prompt.js — agent-aware prompt wrapper
 *
 * Human mode: @clack/prompts (beautiful interactive UI)
 * Agent mode: plain readline — one line per prompt, no arrow keys needed
 */

const readline = require('readline');
const { isAgent, emitPrompt, emitConfirm: _emitConfirm, withTimeout } = require('./agent');

// Shared readline interface for agent mode (avoids stdin contention)
let _rl = null;
function getRL() {
  if (!_rl) {
    _rl = readline.createInterface({ input: process.stdin, terminal: false });
    // Unref stdin immediately so the event loop can exit when the CLI action
    // finishes (e.g. after cancel()) without waiting for stdin to close.
    process.stdin.unref();
    _rl.on('close', () => { _rl = null; });
  }
  return _rl;
}

function readLine() {
  return new Promise((resolve) => {
    const rl = getRL();
    rl.once('line', resolve);
    rl.once('close', () => resolve(''));
  });
}

async function agentSelect({ message, options, initialValue, step, of: total, field, choices }) {
  const choiceValues = choices || options.map((o) => o.value);
  emitPrompt({ type: 'select', step, of: total, field, message,
    choices: choiceValues, default: initialValue, resumable: true });

  if (isAgent()) {
    const ans = await withTimeout(readLine(), 12000, field);
    const t = ans.trim();
    return choiceValues.includes(t) ? t : (initialValue || choiceValues[0]);
  }
  const { select } = require('@clack/prompts');
  return select({ message, options, initialValue });
}

async function agentText({ message, defaultValue, placeholder, step, of: total, field }) {
  emitPrompt({ type: 'input', step, of: total, field, message,
    default: defaultValue, resumable: true });

  if (isAgent()) {
    const ans = await withTimeout(readLine(), 12000, field);
    return ans.trim() || defaultValue || '';
  }
  const { text } = require('@clack/prompts');
  return text({ message, defaultValue, placeholder });
}

async function agentConfirm({ message, step, of: total, field, initialValue = true }) {
  emitPrompt({ type: 'confirm', step, of: total, field, message,
    default: initialValue, resumable: true });

  if (isAgent()) {
    const ans = await withTimeout(readLine(), 12000, field);
    const t = ans.trim().toLowerCase();
    if (t === 'y' || t === 'yes' || t === 'true') return true;
    if (t === 'n' || t === 'no'  || t === 'false') return false;
    return initialValue;
  }
  const { confirm } = require('@clack/prompts');
  return confirm({ message });
}

module.exports = { agentSelect, agentText, agentConfirm };

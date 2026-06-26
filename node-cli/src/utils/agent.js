'use strict';

/**
 * agent.js — Core utilities for agentic CLI patterns
 *
 * WORKSHOP PATTERN LIBRARY
 * These are the three patterns covered in Section 01 of the workshop:
 *   1. isAgent()       — detect agent context
 *   2. emitEvent()     — structured stderr output (dual-rendering contract)
 *   3. FlowState       — resumable state machine
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const stripAnsi = require('strip-ansi');

// ─── IPC SIDE CHANNEL (optional) ─────────────────────────────────────────────
// When WORKSHOP_IPC=1, start a TCP IPC server and broadcast all events to it
// in addition to stderr. Agents can connect to the clean socket instead of
// parsing stderr. The port is announced via stderr: { event: 'ipc_ready', port }
let _ipcServer = null;
// Pre-start buffer: captures events emitted before the IPC server is ready
// so new clients receive a full replay of the flow from the beginning.
const _preStartBuffer = [];

if (process.env.WORKSHOP_IPC) {
  // Lazy-start: do it on the next tick so the module finishes loading first
  setImmediate(async () => {
    try {
      const { IpcServer } = require('./ipc');
      _ipcServer = new IpcServer();
      const port = await _ipcServer.start();
      // Unref the server so it doesn't prevent the process from exiting after
      // the command finishes (the net.Server keepalive would otherwise hang the process)
      _ipcServer._server.unref();
      // Inject pre-start buffered events into the server replay buffer
      for (const evt of _preStartBuffer) _ipcServer._buffer.push(evt);
      _preStartBuffer.length = 0;
      // Announce on stderr so agents/sims know where to connect
      process.stderr.write(JSON.stringify({ event: 'ipc_ready', port, host: '127.0.0.1' }) + '\n');
      // Clean up on exit
      process.on('exit', () => _ipcServer.stop());
    } catch (e) {
      process.stderr.write(JSON.stringify({ event: 'ipc_error', message: e.message }) + '\n');
    }
  });
}

/** Get the active IPC server instance (or null). */
function getIpcServer() { return _ipcServer; }

// ─── 1. AGENT DETECTION ──────────────────────────────────────────────────────

/**
 * Returns true if the CLI is running inside an agent context.
 *
 * Detection order:
 *   1. CLAUDE_CODE_AGENT / CODEX_AGENT env vars (set by major agent runners)
 *   2. process.stdout.isTTY === false (piped / tool-call subprocess)
 *   3. WORKSHOP_AGENT_MODE (local test override — set this to test agent mode)
 */
function isAgent() {
  if (process.env.CLAUDE_CODE_AGENT) return true;
  if (process.env.CODEX_AGENT) return true;
  if (process.env.GEMINI_AGENT) return true;
  if (!process.stdout.isTTY) return true;
  if (process.env.WORKSHOP_AGENT_MODE) return true;
  return false;
}

// ─── 2. STRUCTURED STDERR OUTPUT ─────────────────────────────────────────────

/**
 * Emit a structured event on stderr for agent consumption.
 *
 * All values are ANSI-stripped before writing to ensure clean JSON.
 * Events are newline-delimited JSON (NDJSON) — one event per line.
 *
 * @param {object} envelope — the event payload
 */
function emitEvent(envelope) {
  // Deep-strip any ANSI codes from string values
  const clean = JSON.parse(
    JSON.stringify(envelope, (_, v) =>
      typeof v === 'string' ? stripAnsi(v) : v
    )
  );
  const line = JSON.stringify(clean) + '\n';
  process.stderr.write(line);
  // Also broadcast to IPC side channel if active
  if (_ipcServer) {
    _ipcServer.broadcast(clean);
  } else if (process.env.WORKSHOP_IPC) {
    // IPC server not yet started — buffer for replay when it comes up
    _preStartBuffer.push(clean);
  }
}

/**
 * Emit a prompt event before showing an interactive prompt.
 * This is the core of the dual-rendering contract.
 *
 * @param {object} opts
 * @param {string} opts.type       — 'select' | 'input' | 'confirm' | 'multiselect' | 'password'
 * @param {number} opts.step       — current step number (1-based)
 * @param {number} opts.of         — total steps
 * @param {string} opts.field      — config key being set (machine-readable)
 * @param {string} opts.message    — human-readable prompt text
 * @param {string[]} [opts.choices] — valid options for select/multiselect
 * @param {*}      [opts.default]  — default value / choice
 * @param {boolean} [opts.resumable] — whether this flow supports re-entry
 */
function emitPrompt(opts) {
  emitEvent({ event: 'prompt', ...opts });
}

/**
 * Emit a progress event to replace spinner output.
 */
function emitProgress(message, pct = null) {
  emitEvent({ event: 'progress', message, ...(pct !== null ? { pct } : {}) });
}

/**
 * Emit a structured error event.
 */
function emitError(code, message, recoverable = true, details = {}) {
  emitEvent({ event: 'error', code, message, recoverable, ...details });
}

/**
 * Emit a completion event with outputs and next steps.
 */
function emitComplete(outputs = [], nextSteps = []) {
  emitEvent({ event: 'complete', outputs, next_steps: nextSteps });
}

/**
 * Emit a confirm event before a destructive action.
 */
function emitConfirm(action, severity = 'medium', reversible = true, requiresPhrase = null) {
  emitEvent({
    event: 'confirm',
    action,
    severity,
    reversible,
    ...(requiresPhrase ? { requires_phrase: requiresPhrase } : {}),
  });
}

// ─── 3. NOOP SPINNER ─────────────────────────────────────────────────────────

/**
 * A spinner replacement for agent context.
 * Implements the same interface as ora but emits progress events to stderr.
 */
class NoopSpinner {
  constructor(text = '') {
    this.text = text;
  }
  start(text) {
    if (text) this.text = text;
    emitProgress(this.text);
    return this;
  }
  stop() { return this; }
  succeed(text) {
    emitEvent({ event: 'progress', status: 'success', message: text || this.text });
    return this;
  }
  fail(text) {
    emitEvent({ event: 'progress', status: 'failure', message: text || this.text });
    return this;
  }
  warn(text) {
    emitEvent({ event: 'progress', status: 'warning', message: text || this.text });
    return this;
  }
  info(text) {
    emitEvent({ event: 'progress', status: 'info', message: text || this.text });
    return this;
  }
}

/**
 * Get an appropriate spinner — ora for humans, NoopSpinner for agents.
 */
function getSpinner(text = '') {
  if (isAgent()) return new NoopSpinner(text);
  const ora = require('ora');
  return ora(text);
}

// ─── 4. FLOW STATE (RESUMABLE STATE MACHINE) ─────────────────────────────────

const STATE_DIR = path.join(os.homedir(), '.paypal-workshop', 'state');

/**
 * FlowState — persists step results to disk so flows can be resumed.
 *
 * Usage:
 *   const state = new FlowState('my-command');
 *   await state.load();                          // check for existing state
 *   await state.setStep('step_1', { foo: 'bar' }); // persist after each step
 *   await state.complete();                      // clean up on success
 */
class FlowState {
  constructor(flowName) {
    this.flowName = flowName;
    this.filePath = path.join(STATE_DIR, `${flowName}.json`);
    this.state = null;
  }

  /** Load existing state from disk. Returns state object or null. */
  async load() {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      this.state = JSON.parse(raw);
      return this.state;
    } catch {
      return null;
    }
  }

  /** Initialize a new flow — creates state file with a unique flow_id. */
  async init(initialData = {}) {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    this.state = {
      flow_id: Math.random().toString(36).slice(2, 8),
      flow_name: this.flowName,
      started_at: new Date().toISOString(),
      completed_steps: [],
      current_step: null,
      data: { ...initialData },
    };
    this._write();
    emitEvent({ event: 'flow_started', flow_id: this.state.flow_id, flow_name: this.flowName });
    return this.state;
  }

  /** Persist a completed step and its answer. */
  async setStep(stepName, data = {}) {
    if (!this.state) await this.init();
    this.state.current_step = stepName;
    if (!this.state.completed_steps.includes(stepName)) {
      this.state.completed_steps.push(stepName);
    }
    this.state.data = { ...this.state.data, ...data };
    this._write();
    emitEvent({ event: 'step_complete', step: stepName, flow_id: this.state.flow_id });
  }

  /** Mark the flow complete and delete the state file. */
  async complete(outputs = []) {
    emitEvent({ event: 'flow_complete', flow_id: this.state?.flow_id, outputs });
    try { fs.unlinkSync(this.filePath); } catch {}
    this.state = null;
  }

  /** True if a resumable state exists for this flow. */
  hasResumableState() {
    return fs.existsSync(this.filePath);
  }

  /** Get a previously saved data value. */
  get(key) {
    return this.state?.data?.[key];
  }

  _write() {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2));
  }
}

// ─── 5. TIMEOUT WRAPPER ──────────────────────────────────────────────────────

/**
 * Wrap a promise with a timeout.
 * On timeout, emits a timeout event and rejects with PROMPT_TIMEOUT.
 *
 * @param {Promise} promise
 * @param {number} ms — timeout in milliseconds
 * @param {string} field — the prompt field that timed out
 */
function withTimeout(promise, ms, field = 'unknown') {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      emitEvent({ event: 'timeout', field, timeout_ms: ms, exit_code: 124 });
      reject(new Error('PROMPT_TIMEOUT'));
    }, ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); }
    );
  });
}

module.exports = {
  isAgent,
  emitEvent,
  emitPrompt,
  emitProgress,
  emitError,
  emitComplete,
  emitConfirm,
  NoopSpinner,
  getSpinner,
  FlowState,
  withTimeout,
  getIpcServer,
};

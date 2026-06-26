'use strict';

/**
 * CliAgentSim — simulates an agent driving a CLI for eval purposes.
 *
 * Two transport modes:
 *   stderr (default) — parses JSON events from stderr, responds via stdin
 *   ipc              — connects to the CLI's IPC TCP socket for a clean
 *                      bidirectional channel (set opts.ipc = true)
 *
 * Usage:
 *   const sim = new CliAgentSim({ strategy: 'use-defaults' });
 *   const result = await sim.run('node src/index.js sandwich:order');
 *
 *   // IPC mode — cleaner, bidirectional
 *   const sim = new CliAgentSim({ strategy: 'use-defaults', ipc: true });
 *   const result = await sim.run('node src/index.js sandwich:order');
 *   console.log('tokens used:', result.tokens);
 */

const { spawn } = require('child_process');
const { IpcClient } = require('./ipc');

class CliAgentSim {
  /**
   * @param {object} opts
   * @param {'use-defaults'|'use-first'|'random'|'adversarial'} opts.strategy
   * @param {number}  [opts.timeout_ms=10000]  — per-prompt timeout
   * @param {boolean} [opts.verbose=false]      — log events to console
   * @param {boolean} [opts.ipc=false]          — use IPC side channel instead of stderr
   */
  constructor(opts = {}) {
    this.strategy   = opts.strategy || 'use-defaults';
    this.timeout_ms = opts.timeout_ms || 10000;
    this.verbose    = opts.verbose || false;
    this.ipc        = opts.ipc || false;
  }

  /**
   * Run a CLI command as an agent would and return the interaction record.
   *
   * @param {string} command — e.g. 'node src/index.js sandwich:order'
   * @param {object} [env]   — additional env vars to set
   * @returns {Promise<SimResult>}
   */
  async run(command, env = {}) {
    if (this.ipc) return this._runIpc(command, env);
    return this._runStderr(command, env);
  }

  // ── stderr transport (original behaviour) ──────────────────────────────────
  _runStderr(command, env = {}) {
    const events = [];
    const stdoutLines = [];
    const stderrLines = [];

    return new Promise((resolve) => {
      try {
        const { execSync } = require('child_process');
        execSync('rm -f ~/.paypal-workshop/state/*.json 2>/dev/null || true');
      } catch {}

      const proc = spawn('sh', ['-c', command], {
        env: { ...process.env, WORKSHOP_AGENT_MODE: '1', ...env },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let hung = false;
      let promptTimer = null;
      let stdoutBuf = '';
      let stderrBuf = '';

      const resetPromptTimer = () => {
        if (promptTimer) clearTimeout(promptTimer);
        promptTimer = setTimeout(() => {
          hung = true;
          if (this.verbose) console.error('[CliAgentSim] HUNG —', this.timeout_ms, 'ms');
          proc.kill('SIGTERM');
        }, this.timeout_ms);
      };

      resetPromptTimer();

      proc.stdout.on('data', (chunk) => {
        stdoutBuf += chunk.toString();
        const lines = stdoutBuf.split('\n');
        stdoutBuf = lines.pop();
        lines.forEach((l) => { if (l) stdoutLines.push(l); });
      });

      proc.stderr.on('data', (chunk) => {
        stderrBuf += chunk.toString();
        const lines = stderrBuf.split('\n');
        stderrBuf = lines.pop();
        lines.forEach((line) => {
          if (!line.trim()) return;
          stderrLines.push(line);
          let evt;
          try { evt = JSON.parse(line); } catch { return; }
          events.push(evt);
          if (this.verbose) console.log('[CliAgentSim event]', JSON.stringify(evt));

          if (evt.event === 'complete' || evt.event === 'flow_complete') {
            if (promptTimer) clearTimeout(promptTimer);
            proc.stdin.end();
          }
          if (evt.event === 'prompt') {
            resetPromptTimer();
            const answer = this._pickAnswer(evt);
            if (this.verbose) console.log('[CliAgentSim answer]', answer);
            setTimeout(() => { proc.stdin.write(answer + '\n'); }, 150);
          }
        });
      });

      proc.on('close', (code) => {
        if (promptTimer) clearTimeout(promptTimer);
        resolve(this._buildResult(code, events, stdoutLines, stderrLines, false, hung));
      });
    });
  }

  // ── IPC transport (clean bidirectional channel) ────────────────────────────
  _runIpc(command, env = {}) {
    return new Promise((resolve) => {
      try {
        const { execSync } = require('child_process');
        execSync('rm -f ~/.paypal-workshop/state/*.json 2>/dev/null || true');
      } catch {}

      const proc = spawn('sh', ['-c', command], {
        env: { ...process.env, WORKSHOP_AGENT_MODE: '1', WORKSHOP_IPC: '1', ...env },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const stdoutLines = [];
      const stderrLines = [];
      let stderrBuf = '';
      let stdoutBuf = '';
      let hung = false;
      let ipcClient = null;

      // Global timeout in case ipc_ready never arrives
      const globalTimer = setTimeout(() => {
        hung = true;
        if (this.verbose) console.error('[CliAgentSim/ipc] HUNG — ipc_ready never received');
        if (ipcClient) ipcClient.disconnect();
        proc.kill('SIGTERM');
      }, this.timeout_ms);

      proc.stdout.on('data', (chunk) => {
        stdoutBuf += chunk.toString();
        const lines = stdoutBuf.split('\n');
        stdoutBuf = lines.pop();
        lines.forEach((l) => { if (l) stdoutLines.push(l); });
      });

      // Watch stderr only for ipc_ready — then hand off to IpcClient
      proc.stderr.on('data', (chunk) => {
        stderrBuf += chunk.toString();
        const lines = stderrBuf.split('\n');
        stderrBuf = lines.pop();
        lines.forEach((line) => {
          if (!line.trim()) return;
          stderrLines.push(line);
          if (ipcClient) return; // already connected
          let evt;
          try { evt = JSON.parse(line); } catch { return; }
          if (evt.event !== 'ipc_ready') return;

          // Connect IpcClient to the announced port
          clearTimeout(globalTimer);
          ipcClient = new IpcClient({
            port: evt.port,
            strategy: this.strategy,
            verbose: this.verbose,
            think_ms: 150,
          });

          ipcClient.connect().then(() => {
            if (this.verbose) console.log('[CliAgentSim/ipc] connected on port', evt.port);
          }).catch((err) => {
            if (this.verbose) console.error('[CliAgentSim/ipc] connect error', err.message);
          });

          // Suppress error events so unhandled IPC errors don't crash the sim
          ipcClient.on('error', (e) => {
            if (this.verbose) console.error('[CliAgentSim/ipc] error event', e);
          });

          ipcClient.on('complete', () => { proc.stdin.end(); });
          ipcClient.on('flow_complete', () => { proc.stdin.end(); });

          // Bridge IPC answers back to proc.stdin so @clack/prompts commands
          // (which read stdin) also work in IPC mode without modification.
          ipcClient.on('event', (e) => {
            if (e.event === 'prompt') {
              const answer = ipcClient._pickAnswer(e);
              setTimeout(() => {
                try { proc.stdin.write(answer + '\n'); } catch {}
              }, 150 + (ipcClient.think_ms || 0));
            }
          });
        });
      });

      proc.on('close', (code) => {
        clearTimeout(globalTimer);
        if (ipcClient) ipcClient.disconnect();
        const allEvents = ipcClient ? ipcClient.events : [];
        const tokens    = ipcClient ? ipcClient.tokens : 0;
        resolve(this._buildResult(code, allEvents, stdoutLines, stderrLines, tokens, hung));
      });
    });
  }

  _buildResult(code, events, stdoutLines, stderrLines, tokens, hung) {
    return {
      exit_code: code,
      events,
      stdout: stdoutLines.join('\n'),
      stderr: stderrLines.join('\n'),
      hung,
      tokens,
      eventsOfType:  (type) => events.filter((e) => e.event === type),
      containsEvent: (matcher) => events.some((e) =>
        Object.entries(matcher).every(([k, v]) => e[k] === v)
      ),
    };
  }

  /** Choose an answer based on the current strategy. */
  _pickAnswer(promptEvent) {
    const { type, choices, default: def } = promptEvent;
    switch (this.strategy) {
      case 'use-defaults':
        if (def !== undefined) return String(def);
        if (choices?.length) return choices[0];
        return type === 'confirm' ? 'y' : 'test-input';
      case 'use-first':
        if (choices?.length) return choices[0];
        return type === 'confirm' ? 'y' : 'first-input';
      case 'random':
        if (choices?.length) return choices[Math.floor(Math.random() * choices.length)];
        return type === 'confirm' ? (Math.random() > 0.5 ? 'y' : 'n') : 'random-input';
      case 'adversarial':
        const adversarialInputs = ['', '   ', '<script>alert(1)</script>', 'a'.repeat(500), '\x00', '{}'];
        return adversarialInputs[Math.floor(Math.random() * adversarialInputs.length)];
      default:
        return def !== undefined ? String(def) : '';
    }
  }
}

module.exports = { CliAgentSim };

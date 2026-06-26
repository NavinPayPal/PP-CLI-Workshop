'use strict';

/**
 * ipc.js — IPC side channel for agent ↔ CLI communication
 *
 * Instead of multiplexing agent events onto stderr (which humans also read),
 * this opens a dedicated TCP socket server that:
 *   1. Broadcasts all CLI events as clean NDJSON to every connected agent
 *   2. Accepts response messages back from agents: { field, value }
 *   3. Resolves pending prompt waiters when an agent responds
 *
 * Usage in CLI:
 *   const { IpcServer } = require('./ipc');
 *   const ipc = new IpcServer();
 *   await ipc.start();                        // binds to random free port
 *   ipc.broadcast({ event: 'prompt', ... });  // send event to all agents
 *   const answer = await ipc.waitForResponse('bread', 10000); // await answer
 *   ipc.stop();
 *
 * The server announces itself on stderr so agents know where to connect:
 *   { "event": "ipc_ready", "port": 4321, "host": "127.0.0.1" }
 *
 * Agent usage (CliAgentSim / real LLM agent):
 *   1. Read the ipc_ready event from stderr
 *   2. Open a TCP connection to host:port
 *   3. Read NDJSON lines → handle prompt events
 *   4. Write NDJSON responses: { "field": "bread", "value": "sourdough" }
 */

const net  = require('net');
const os   = require('os');

class IpcServer {
  constructor() {
    this._server   = null;
    this._clients  = new Set();
    this._waiters  = new Map();  // field → { resolve, timer }
    this._buffer   = [];         // event replay buffer for late-connecting clients
    this.port      = null;
    this.host      = '127.0.0.1';
  }

  /** Start the IPC server on a random free port. */
  start() {
    return new Promise((resolve, reject) => {
      this._server = net.createServer((socket) => this._onClient(socket));
      this._server.listen(0, this.host, () => {
        this.port = this._server.address().port;
        resolve(this.port);
      });
      this._server.once('error', reject);
    });
  }

  /** Stop the server and disconnect all clients. */
  stop() {
    for (const socket of this._clients) {
      try { socket.destroy(); } catch {}
    }
    this._clients.clear();
    if (this._server) this._server.close();
  }

  /**
   * Broadcast an event object to all connected agent clients.
   * @param {object} event
   */
  broadcast(event) {
    this._buffer.push(event);  // buffer for late-connecting clients
    if (!this._clients.size) return;
    const line = JSON.stringify(event) + '\n';
    for (const socket of this._clients) {
      try { socket.write(line); } catch {}
    }
  }

  /**
   * Wait for an agent to respond to a specific prompt field.
   * Resolves with the value string the agent sent, or null on timeout.
   *
   * @param {string} field      — the prompt field name (e.g. 'bread')
   * @param {number} timeout_ms — max wait time in ms
   */
  waitForResponse(field, timeout_ms = 15000) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this._waiters.delete(field);
        resolve(null);  // timeout → fall back to stdin
      }, timeout_ms);

      this._waiters.set(field, { resolve: (val) => {
        clearTimeout(timer);
        this._waiters.delete(field);
        resolve(val);
      }, timer });
    });
  }

  /** Handle a new agent TCP connection. */
  _onClient(socket) {
    this._clients.add(socket);
    // Unref so an open client connection doesn't prevent the process from
    // exiting after the command finishes (process.exit() still closes it).
    socket.unref();
    socket.setEncoding('utf8');
    let buf = '';

    // Replay all buffered events so late-connecting clients don't miss anything
    for (const evt of this._buffer) {
      try { socket.write(JSON.stringify(evt) + '\n'); } catch {}
    }

    socket.on('data', (chunk) => {
      buf += chunk;
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        this._onMessage(msg, socket);
      }
    });

    socket.on('close', () => this._clients.delete(socket));
    socket.on('error', () => this._clients.delete(socket));
  }

  /** Handle a message received from an agent client. */
  _onMessage(msg, socket) {
    // Agent response: { field: 'bread', value: 'sourdough' }
    if (msg.field && msg.value !== undefined) {
      const waiter = this._waiters.get(msg.field);
      if (waiter) waiter.resolve(String(msg.value));
    }
  }
}

/**
 * IpcClient — connects to a CLI's IPC server and drives it like an agent.
 *
 * Usage:
 *   const client = new IpcClient({ port: 4321, strategy: 'use-defaults' });
 *   await client.connect();
 *   client.on('complete', () => client.disconnect());
 */
const { EventEmitter } = require('events');

class IpcClient extends EventEmitter {
  /**
   * @param {object} opts
   * @param {number} opts.port          — IPC server port
   * @param {string} [opts.host]        — default 127.0.0.1
   * @param {'use-defaults'|'use-first'|'random'} [opts.strategy]
   * @param {boolean} [opts.verbose]
   * @param {number}  [opts.think_ms]   — simulated thinking delay (ms)
   */
  constructor(opts = {}) {
    super();
    this.port      = opts.port;
    this.host      = opts.host || '127.0.0.1';
    this.strategy  = opts.strategy || 'use-defaults';
    this.verbose   = opts.verbose || false;
    this.think_ms  = opts.think_ms ?? 100;
    this._socket   = null;
    this.events    = [];
    this.tokens    = 0;  // rough token usage counter
  }

  connect() {
    return new Promise((resolve, reject) => {
      this._socket = net.createConnection({ port: this.port, host: this.host }, resolve);
      this._socket.setEncoding('utf8');
      let buf = '';
      this._socket.on('data', (chunk) => {
        buf += chunk;
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const line of lines) {
          if (!line.trim()) continue;
          let evt;
          try { evt = JSON.parse(line); } catch { continue; }
          this._onEvent(evt);
        }
      });
      this._socket.on('error', (err) => this.emit('error', err));
      this._socket.on('close', () => this.emit('close'));
    });
  }

  disconnect() {
    if (this._socket) { this._socket.destroy(); this._socket = null; }
  }

  _onEvent(evt) {
    this.events.push(evt);
    // Count tokens (rough estimate: chars / 4)
    this.tokens += Math.ceil(JSON.stringify(evt).length / 4);
    if (this.verbose) console.log('[IpcClient]', JSON.stringify(evt));
    this.emit('event', evt);
    this.emit(evt.event, evt);

    if (evt.event === 'prompt') {
      const answer = this._pickAnswer(evt);
      if (this.verbose) console.log('[IpcClient answer]', evt.field, '→', answer);
      // Count outgoing tokens too
      this.tokens += Math.ceil(answer.length / 4);
      setTimeout(() => {
        if (this._socket) {
          this._socket.write(JSON.stringify({ field: evt.field, value: answer }) + '\n');
        }
      }, this.think_ms);
    }
  }

  _pickAnswer(evt) {
    const { type, choices, default: def } = evt;
    switch (this.strategy) {
      case 'use-defaults':
        return def !== undefined ? String(def) : (choices?.[0] ?? (type === 'confirm' ? 'y' : 'input'));
      case 'use-first':
        return choices?.[0] ?? (type === 'confirm' ? 'y' : 'first');
      case 'random':
        if (choices?.length) return choices[Math.floor(Math.random() * choices.length)];
        return type === 'confirm' ? (Math.random() > 0.5 ? 'y' : 'n') : 'random';
      default:
        return def !== undefined ? String(def) : '';
    }
  }
}

module.exports = { IpcServer, IpcClient };

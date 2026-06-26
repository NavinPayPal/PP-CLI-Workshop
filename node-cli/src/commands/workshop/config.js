'use strict';

/**
 * workshop:config — set and inspect workshop configuration
 *
 * Attendees run this once at the start of the workshop:
 *   node cli/src/index.js workshop:config --url https://abc123.ngrok.io
 *
 * Then every subsequent command (evals, checkin, quest:play) automatically
 * uses that URL — no env vars needed.
 *
 * Also used to verify connectivity:
 *   node cli/src/index.js workshop:config --ping
 */

const chalk = require('chalk');
const { intro, outro } = require('@clack/prompts');
const { isAgent, emitEvent, emitError } = require('../../utils/agent');
const { agentText } = require('../../utils/prompt');
const { getLeaderboardUrl, pingLeaderboard, writeConfigFile, readConfigFile, CONFIG_FILE } = require('../../utils/config');

async function workshopConfig(program) {
  program
    .command('workshop:config')
    .description('Set the leaderboard URL (run once at workshop start)')
    .option('--url <url>',            'Leaderboard URL, e.g. https://abc123.ngrok.io')
    .option('--name <name>',          'Your workshop name (saves it for checkins)')
    .option('--paypal-client-id <id>','PayPal sandbox Client ID (from developer.paypal.com)')
    .option('--paypal-secret <s>',    'PayPal sandbox Client Secret')
    .option('--ping',                 'Test connectivity to the current leaderboard URL')
    .option('--show',                 'Print current config')
    .action(async (opts) => {
      const agent = isAgent();
      if (!agent) intro(chalk.bold.cyan('⚙️   Workshop Config'));

      // ── --show ──────────────────────────────────────────────────
      if (opts.show) {
        const cfg = readConfigFile();
        const showUrl = getLeaderboardUrl();
        if (agent) {
          emitEvent({ event: 'config', config: cfg, resolved_url: showUrl, config_file: CONFIG_FILE });
        } else {
          console.log('');
          console.log(chalk.dim('  Config file: ') + CONFIG_FILE);
          console.log(chalk.dim('  Leaderboard: ') + chalk.cyan(showUrl));
          if (cfg.workshop_name)    console.log(chalk.dim('  Name:        ') + chalk.white(cfg.workshop_name));
          if (cfg.paypal_client_id) console.log(chalk.dim('  PayPal ID:   ') + chalk.green('✓ set'));
          if (cfg.paypal_secret)    console.log(chalk.dim('  PayPal Sec:  ') + chalk.green('✓ set'));
          console.log('');
        }
        return;
      }

      // ── --ping ──────────────────────────────────────────────────
      if (opts.ping) {
        const pingUrl = getLeaderboardUrl();
        if (!agent) process.stdout.write(chalk.dim(`  Pinging ${pingUrl} ... `));
        const result = await pingLeaderboard(pingUrl);
        if (result.ok) {
          emitEvent({ event: 'ping_ok', url: pingUrl, latency_ms: result.latency_ms, attendees: result.attendees });
          if (!agent) {
            console.log(chalk.green('✓ reachable') + chalk.dim(` (${result.latency_ms}ms · ${result.attendees ?? 0} attendees)`));
            outro(chalk.green('Leaderboard is up!'));
          }
        } else {
          emitError('LEADERBOARD_UNREACHABLE',
            `Cannot reach ${pingUrl} — ${result.error || 'check the URL and try again'}`, false);
          if (!agent) {
            console.log(chalk.red('✗ unreachable'));
            console.log('');
            console.log(chalk.yellow('  Possible fixes:'));
            console.log(chalk.dim('  • Check the ngrok URL from the presenter'));
            console.log(chalk.dim('  • Run: node cli/src/index.js workshop:config --url <url>'));
            console.log(chalk.dim('  • Or run locally: cd leaderboard && node server.js'));
            console.log('');
          }
        }
        return;
      }

      // ── Set URL ─────────────────────────────────────────────────
      let url = opts.url;
      if (!url) {
        url = await agentText({
          message: 'Leaderboard URL (from presenter or http://localhost:3002)',
          defaultValue: 'http://localhost:3002',
          step: 1, of: 2, field: 'leaderboard_url',
        });
      }
      if (!url) return;

      // Normalise — strip trailing slash, add https if looks like ngrok
      url = url.trim().replace(/\/$/, '');
      if (url.includes('ngrok') && !url.startsWith('http')) url = 'https://' + url;

      // ── Set name ─────────────────────────────────────────────────
      let name = opts.name;
      if (!name) {
        name = await agentText({
          message: 'Your name (used for leaderboard checkins)',
          defaultValue: '',
          step: 2, of: 2, field: 'workshop_name',
        });
      }

      // ── Ping to verify ───────────────────────────────────────────
      if (!agent) process.stdout.write(chalk.dim(`\n  Verifying ${url} ... `));
      const result = await pingLeaderboard(url);

      if (result.ok) {
        writeConfigFile({ leaderboard_url: url, ...(name ? { workshop_name: name } : {}),
                          ...(opts.paypalClientId ? { paypal_client_id: opts.paypalClientId } : {}),
                          ...(opts.paypalSecret   ? { paypal_secret:    opts.paypalSecret   } : {}) });
        emitEvent({ event: 'config_saved', leaderboard_url: url, workshop_name: name || null, ping_ok: true,
                    paypal_configured: !!(opts.paypalClientId && opts.paypalSecret) });
        if (!agent) {
          console.log(chalk.green('✓'));
          console.log('');
          outro(
            chalk.green('Config saved!\n') +
            chalk.dim('  URL:  ') + chalk.cyan(url) + '\n' +
            (name ? chalk.dim('  Name: ') + chalk.white(name) + '\n' : '') +
            (opts.paypalClientId ? chalk.dim('  PayPal: ') + chalk.green('credentials saved\n') : '') +
            chalk.dim('\n  All workshop commands will now use this URL automatically.')
          );
        }
      } else {
        if (!agent) console.log(chalk.yellow('⚠ unreachable — saving anyway'));
        writeConfigFile({ leaderboard_url: url, ...(name ? { workshop_name: name } : {}),
                          ...(opts.paypalClientId ? { paypal_client_id: opts.paypalClientId } : {}),
                          ...(opts.paypalSecret   ? { paypal_secret:    opts.paypalSecret   } : {}) });
        emitEvent({ event: 'config_saved', leaderboard_url: url, workshop_name: name || null, ping_ok: false,
                    warning: 'URL saved but ping failed — check connectivity' });
        if (!agent) {
          console.log('');
          outro(chalk.yellow('URL saved (not verified). Run --ping to recheck when the server is up.'));
        }
      }
    });
}

module.exports = { workshopConfig };

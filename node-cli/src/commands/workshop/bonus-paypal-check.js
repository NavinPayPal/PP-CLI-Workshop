'use strict';

/**
 * paypal:setup-check — Bonus Mission: PayPal Checkout Integration ()
 *
 * All TODOs complete:
 *   TODO-1  emitPrompt() via agentText/agentConfirm
 *   TODO-2  isAgent() / getSpinner()
 *   TODO-3  emitComplete() on success
 *
 * Run (human):  node node-cli/src/index.js paypal:setup-check
 * Run (agent):  WORKSHOP_AGENT_MODE=1 node node-cli/src/index.js paypal:setup-check
 * With flags:   node node-cli/src/index.js paypal:setup-check --client-id <id> --secret <s>
 */

const fs   = require('fs');
const chalk = require('chalk');
const {
  isAgent, emitComplete, emitEvent, emitError, getSpinner,
} = require('../../utils/agent');
const { agentText, agentConfirm } = require('../../utils/prompt');

const PAYPAL_AUTH_URL = 'https://api-m.sandbox.paypal.com/v1/oauth2/token';

async function getAccessToken(clientId, secret) {
  const credentials = Buffer.from(`${clientId}:${secret}`).toString('base64');
  const res = await fetch(PAYPAL_AUTH_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`Auth failed: ${res.status} ${res.statusText}`);
  const data = await res.json();
  return data.access_token;
}

function generateCheckoutHtml(clientId) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>PayPal Checkout</title>
  <script src="https://www.paypal.com/sdk/js?client-id=${clientId}&currency=USD"></script>
  <style>
    body { font-family: sans-serif; max-width: 480px; margin: 60px auto; padding: 0 20px; }
    h1   { font-size: 1.4rem; margin-bottom: 24px; }
    #paypal-button-container { margin-top: 16px; }
  </style>
</head>
<body>
  <h1>☕ Barista 9000 — Checkout</h1>
  <p>Large latte · 2 shots · oat milk</p>
  <p><strong>$5.30</strong></p>
  <div id="paypal-button-container"></div>
  <script>
    paypal.Buttons({
      createOrder: function(data, actions) {
        return actions.order.create({
          purchase_units: [{ amount: { value: '5.30' } }]
        });
      },
      onApprove: function(data, actions) {
        return actions.order.capture().then(function(details) {
          document.body.innerHTML = '<h1>✓ Order confirmed!</h1><p>Thank you, ' + details.payer.name.given_name + '</p>';
        });
      },
      onError: function(err) {
        console.error('PayPal error', err);
      }
    }).render('#paypal-button-container');
  </script>
</body>
</html>`;
}

async function bonusPaypalCheck(program) {
  program
    .command('paypal:setup-check')
    .description('Bonus mission — PayPal checkout button ')
    .option('--client-id <id>',   'PayPal Sandbox Client ID (skips prompt)')
    .option('--secret <secret>',  'PayPal Sandbox Secret (skips prompt)')
    .action(async (opts) => {
      const agent = isAgent();
      const { intro, outro, cancel } = agent
        ? { intro: () => {}, outro: () => {}, cancel: () => {} }
        : require('@clack/prompts');

      if (!agent) intro(chalk.bold('💳  PayPal Checkout Setup'));

      // STEP 1 — client ID (TODO-1 : agentText emits emitPrompt internally)
      let clientId = opts.clientId || process.env.PAYPAL_CLIENT_ID;
      if (!clientId) {
        clientId = await agentText({
          message: 'PayPal Sandbox Client ID',
          placeholder: 'AaBbCc… (from developer.paypal.com)',
          step: 1, of: 3, field: 'client_id',
        });
        if (!clientId) { cancel('Cancelled'); return; }
      }

      // STEP 2 — secret
      let secret = opts.secret || process.env.PAYPAL_SECRET;
      if (!secret) {
        secret = await agentText({
          message: 'PayPal Sandbox Secret',
          placeholder: 'EeFfGg…',
          step: 2, of: 3, field: 'secret',
        });
        if (!secret) { cancel('Cancelled'); return; }
      }

      // STEP 3 — validate credentials (TODO-2 : getSpinner)
      const sp = getSpinner('Validating credentials…').start();
      let credentialsValid = false;
      try {
        await getAccessToken(clientId, secret);
        sp.succeed('Credentials valid');
        credentialsValid = true;
        emitEvent({ event: 'paypal_auth_success', client_id: clientId.slice(0, 8) + '…' });
      } catch (e) {
        sp.fail(`Credentials invalid — ${e.message}`);
        emitError('PAYPAL_AUTH_FAILED', e.message, true, { hint: 'Check your Client ID and Secret at developer.paypal.com' });
        if (!agent) {
          cancel('Fix your credentials and try again');
          return;
        }
        // In agent mode continue anyway so HTML is still generated
      }

      // STEP 4 — generate checkout HTML
      const html = generateCheckoutHtml(clientId);
      const outFile = 'paypal-checkout.html';
      fs.writeFileSync(outFile, html);

      if (!agent) outro(chalk.green(`✓ Generated ${outFile} — open it in your browser!`));

      // TODO-3 : emitComplete
      emitComplete(
        [outFile],
        ['open paypal-checkout.html', 'node node-cli/src/index.js paypal:setup-check --client-id <id> --secret <s>'],
      );
    });
}

module.exports = { bonusPaypalCheck };

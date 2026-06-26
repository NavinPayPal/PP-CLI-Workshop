'use strict';

/**
 * paypal:setup — Bonus Mission: PayPal Checkout Integration
 *
 * STARTING STATE — works for humans but hangs when an agent drives it.
 *
 * WHAT THIS DOES:
 *   1. Prompts for PayPal sandbox credentials (from developer.paypal.com)
 *   2. Validates credentials via OAuth2
 *   3. Generates a paypal-checkout.html with the PayPal JS SDK button
 *
 * GET CREDENTIALS:
 *   https://developer.paypal.com/dashboard → Apps & Credentials → Create App
 *
 * TODOS TO FIX:
 *   TODO-1  Add emitPrompt() before each prompt
 *   TODO-2  Add isAgent() / getSpinner()
 *   TODO-3  Add emitComplete() on success
 *
 * Run:
 *   node node-cli/src/index.js paypal:setup
 *
 * Agent mode (hangs until TODO-1 done):
 *   WORKSHOP_AGENT_MODE=1 node node-cli/src/index.js paypal:setup
 *
 * Check progress:
 *   node evals/paypal.eval.js
 */

const fs = require('fs');
const { select, text, confirm, intro, outro, cancel } = require('@clack/prompts');
const chalk = require('chalk');
const { getSpinner } = require('../../utils/agent');

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

async function bonusPaypal(program) {
  program
    .command('paypal:setup')
    .description('Bonus mission — add PayPal checkout button (exercise)')
    .action(async () => {
      intro(chalk.bold('💳  PayPal Checkout Setup'));

      // STEP 1 — client ID
      // TODO-1: emit prompt event before the text() call
      //   emitPrompt({ type: 'input', step: 1, of: 3, field: 'client_id',
      //     message: 'PayPal Sandbox Client ID', resumable: false })
      const clientId = await text({
        message: 'PayPal Sandbox Client ID',
        placeholder: 'AaBbCc… (from developer.paypal.com)',
      });
      if (!clientId) { cancel('Cancelled'); return; }

      // STEP 2 — secret
      // TODO-1: emit prompt event for secret
      const secret = await text({
        message: 'PayPal Sandbox Secret',
        placeholder: 'EeFfGg…',
      });
      if (!secret) { cancel('Cancelled'); return; }

      // STEP 3 — validate credentials
      // TODO-2: replace console.log spinner with getSpinner()
      console.log('Validating credentials…');
      let token = null;
      try {
        token = await getAccessToken(clientId, secret);
        console.log('✓ Credentials valid');
      } catch (e) {
        console.error(`✗ ${e.message}`);
        cancel('Invalid credentials — check your Client ID and Secret');
        return;
      }

      // STEP 4 — generate checkout HTML
      const html = generateCheckoutHtml(clientId);
      const outFile = 'paypal-checkout.html';
      fs.writeFileSync(outFile, html);
      outro(chalk.green(`✓ Generated ${outFile} — open it in your browser!`));

      // TODO-3: emitComplete([outFile], ['node node-cli/src/index.js paypal:setup --client-id <id> --secret <secret>'])
    });
}

module.exports = { bonusPaypal };

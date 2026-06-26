#!/usr/bin/env node
'use strict';

const { Command } = require('commander');
const { brew }                = require('./commands/workshop/brew');
const { brewCheck }           = require('./commands/workshop/brew-check');
const { workshopConfig }      = require('./commands/workshop/config');
const { workshopCheckin }     = require('./commands/workshop/checkin');
const { bonusPaypal }         = require('./commands/workshop/bonus-paypal');
const { bonusPaypalCheck }    = require('./commands/workshop/bonus-paypal-check');

const program = new Command();

program
  .name('workshop')
  .description('AI Engineer — Agentic CLI Workshop (Barista 9000)')
  .version('1.0.0');

// -- Workshop setup
workshopConfig(program);
workshopCheckin(program);

// -- Barista 9000 exercise
brew(program);
brewCheck(program);

// -- Bonus: PayPal setup
bonusPaypal(program);
bonusPaypalCheck(program);

program.parseAsync(process.argv)
  .then(() => { process.exit(0); })
  .catch((err) => {
    const { emitError } = require('./utils/agent');
    emitError('UNEXPECTED_ERROR', err.message, false);
    console.error(err.message);
    process.exit(1);
  });

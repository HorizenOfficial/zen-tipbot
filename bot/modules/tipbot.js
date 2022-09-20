'use strict';

// eslint-disable-next-line node/no-unpublished-require
const { Config } = require('../../config/default');

const zencashjs = require('zencashjs');
const crypto = require('crypto');
const mongoose = require('mongoose');
const axios = require('axios');

const { moderation, mongodb, admins, zencfg, botcfg } = Config

const sweepInterval = botcfg.sweepIntervalMs || 60 * 60 * 24 * 1000;
let sweepSuspend = botcfg.sweepSuspendMs || 60 * 60 * 1000;
let lastSuspend = new Date();
// adjust so initial sweep runs on start
lastSuspend = new Date(lastSuspend - sweepSuspend);
// validation for 1-100
const regSuspend = /^[1-9]$|^[1-9][0-9]$|^(100)$/;
const regHex = /[0-9A-Fa-f]{6}/g;

const INSIGHT_BASE = botcfg.testnet ? 'https://explorer-testnet.horizen.io' : 'https://explorer.horizen.io';
const INSIGHT_API = `${INSIGHT_BASE}/api`;

let axiosApi = axios.create({
  baseURL: INSIGHT_API,
  timeout: 10000,
});
let db;

try {
  mongoose.connect(mongodb.url, mongodb.options);
  db = mongoose.connection;
  db.on('error', console.error.bind(console, 'connection error: '));
  db.once('open', function () {
    console.log("Mongodb: connected to '" + this.host + '/' + this.name + "'!");
  });
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}

const userSchema = mongoose.Schema({
  id: String,
  priv: String,
  address: String,
  spent: Number,
  received: Number,
});
const User = db.model('User', userSchema);


function isAdmin(discordId) {
  if (!admins) return false;
  return admins.includes(discordId);
}

exports.commands = ['tip'];

exports.tip = {
  usage: '<subcommand>',

  description:
    'Here are the commands you can use:\n' +
    '**!tip help** : display this message.\n' +
    '**!tip deposit** : get an address to top up your balance.\n' +
    '**!tip balance** : get your balance.\n' +
    '**!tip withdraw <amount> <address>** : withdraw <amount> ZEN from your' +
    ' balance to your <address>.\n' +
    '**!tip <@user> <amount> [message]** : tip <@user> <amount> ZEN (maximum' +
    ' 1 ZEN) and leave an optional [message].\n' +
    '**!tip each <amount> <n> [message]** : drop a ZEN packet in a channel, the' +
    ' <amount> is divided *equally* between the <n> first people to open' +
    ' the ZEN packet. Leave an optional [message] with the ZEN packet.\n' +
    '**!tip luck <amount> <n> [message]** : drop a ZEN packet in a channel, the' +
    ' <amount> is divided *randomly* between the <n> first people to open' +
    ' the ZEN packet. Leave an optional [message] with the ZEN packet.\n' +
    '**!tip open** : open the latest ZEN packet dropped into the channel.\n',

  process: function (bot, msg) {
    try {
      getUser(msg.author.id, function (err, doc) {
        if (err) return debugLog(err);

        const tipper = doc;
        tipper.isAdmin = isAdmin(doc.id);
        const words = msg.content
          .trim()
          .split(' ')
          .filter(function (n) {
            return n !== '';
          });
        const subcommand = words.length >= 2 ? words[1] : 'help';

        switch (subcommand) {
          case 'help':
            doHelp(msg, tipper, words);
            break;

          case 'balance':
            doBalance(msg, tipper, words);
            break;

          case 'deposit':
            doDeposit(msg, tipper);
            break;

          case 'withdraw':
            doWithdraw(msg, tipper, words);
            break;

          case 'each':
            createTipEach(msg, tipper, words);
            break;

          case 'luck':
            createTipLuck(msg, tipper, words);
            break;

          case 'open':
            doOpenTip(msg, tipper, words, bot);
            break;

          case 'suspend':
            suspend(msg, tipper, words, bot);
            break;

          case 'payout':
            doPayout(msg, tipper, words, bot);
            break;

          default:
            doTip(msg, tipper, words, bot);
        }
      });
    } catch (error) {
      console.error(error);
    }
  },
};

const TX_FEE = 0.0001;

let tipAllChannels = [];
let currencyHelp;
// default currencies if coingecko fails initial request
let allowedFiatCurrencySymbols = [
  'usd',
  'eur',
  'rub',
  'jpy',
  'gbp',
  'aud',
  'brl',
  'cad',
  'chf',
  'clp',
  'cny',
  'czk',
  'dkk',
  'hkd',
  'idr',
  'ils',
  'inr',
  'krw',
  'mxn',
  'myr',
  'nok',
  'nzd',
  'php',
  'pkr',
  'pln',
  'sek',
  'sgd',
  'thb',
  'try',
  'twd',
  'zar',
];

/**
 * @param message
 */
function doHelp(message, tipper, words) {
  if (message.channel.type !== 1) {
    return message.reply('send me this command in a direct message!');
  }
  if (!words || words.length < 3) {
    message.author.send(
      'Here are the commands you can use for your account and to tip a single user:\n' +
      '**!tip help** : display this message.\n\n' +
      '**!tip deposit** : get an address to top up your balance. ' +
      '(note that a 0.0001 fee will be applied to your deposit)\n' +
      '`Warning:` Mining directly into your `tip-bot-address` is ' +
      "prohibited (You won't be able to use these ZEN)! And no support " +
      'for retrieving these ZEN will be provided!\n\n' +
      '**!tip balance** : get your balance. If incorrect and you recently made a deposit, ' +
      'please wait a few minutes for the next block and check again\n\n' +
      '**!tip balance <currency_ticker>** : get your balance in another currency. Supported currencies: !tip help currency\n\n' +
      '**!tip withdraw <amount> <address>** : withdraw <amount> ZEN from ' +
      'your balance to your `T` <address> (Only `T` addresses are supported!).\n\n' +
      '**!tip <@user> <amount> [message]** : tip <@user> <amount> ZEN. ' +
      'Maximum tip has to be less than or equal to 1 ZEN.\n\n' +
      '**!tip <@user> random [message]** : tip <@user> random ZEN where ' +
      'random is greater than 0.0 and less than 0.1)\n\n' +
      '**!tip <@user> <amount><currency_ticker> [message]** : tip ' +
      '<@user> ZEN in currency equivalent. Example: **!tip @lukas 200czk** (_no space between amount and ticker_). ' +
      'You can use <currency_ticker> with every send tip command. Supported currencies: !tip help currency\n\n'
    );

    message.author.send(
      'Commands for multiple users.\n' +
      'The following applies to _luck_ and _each_:  Only one ZEN packet per channel is ' +
      'allowed. Maximum is 20 people. Your ZEN packet will be active for the next ' +
      '20 minutes, after that it can be overwritten by a new ZEN packet. Maximum tip has to be ≤ 1 ZEN.\n\n' +
      '**!tip luck <amount> <n> [message]** : drop a ZEN packet in a channel, ' +
      'the <amount> is divided *randomly* (one tip is bigger, you can win ' +
      'the jackpot) between the <n> first people to open the ZEN packet. Leave an ' +
      'optional [message] with the ZEN packet.\n\n' +
      '**!tip each <amount> <n> [message]** : drop a ZEN packet in a channel, ' +
      'the <amount> is divided *equally* between the <n> first people to ' +
      'open the ZEN packet. Leave an optional [message] with the ZEN packet.\n\n'
    );
  }

  if (tipper.isAdmin && (words.length === 2 || words.length > 2 && words[2] === 'admin')){
    message.author.send(
      'These are the **admin commands** you can use:\n' +
      '**!tip suspend [30] ** : suspend scheduled background tasks for indicated minutes (default one hour) while doing payouts. ' +
      'Optional minutes must be between 1 and 100 and is saved for next time (unless tipbot is restarted). \n\n' +
      '**!tip payout <@user> <amount><fiat_currency_ticker> [message]** : send a tip to a someone who has completed a task. ' +
      'Be sure your balance is sufficient for the total of all payouts to be made since ' +
      'your balance check is skipped when using this command. Supports the same arguments as !tip @<user>.\n\n'
    );
  }

  if (words && words[2]) {
    if (words[2] === 'currency') {
      message.author.send('Supported currencies (fiat and coins): \n\n' +
        `${currencyHelp ? currencyHelp : allowedFiatCurrencySymbols.toString().replace(/,/g, ', ')}\n`);
    } else if (words[2] !== 'admin') {
      message.author.send(`Unknown help: ${words[2]}. Available help: currency`);
    }
  }
}

/**
 * @param id
 * @param cb
 */
function getUser(id, cb) {
  //  default user
  const user = new User({
    id: id,
    priv: '',
    address: '',
    spent: 0,
    received: 0,
  });

  // look for user in DB
  User.findOne({ id: id }, function (err, doc) {
    if (err) {
      return cb(err, null);
    }

    if (doc) {
      // Existing User
      return cb(null, doc);
    } else {
      // New User
      const seed = crypto.randomBytes(id % 65535 | 0);
      user.priv = zencashjs.address.mkPrivKey(seed.toString('hex'));
      const pubKey = zencashjs.address.privKeyToPubKey(user.priv, true, botcfg.testnet ? zencashjs.config.testnet.wif : zencashjs.config.mainnet.wif);
      user.address = zencashjs.address.pubKeyToAddr(pubKey, botcfg.testnet ? zencashjs.config.testnet.pubKeyHash : zencashjs.config.mainnet.pubKeyHash);
      user.save(function (err) {
        if (err) {
          return cb(err, null);
        }
        return cb(null, user);
      });
    }
  });
}

/**
 * Calculate and return user's balance. DO NOT CONFUSE WITH doBalance!
 * @param tipper
 * @param cb
 */
function getBalance(tipper, cb) {
  // balance = total deposit amount + total received - total spent
  axios
    .get(INSIGHT_API + '/addr/' + tipper.address)
    .then((res) => {
      if (res.data.balance > 2 * TX_FEE) {
        transferToBot(tipper, res.data.balance);
      }
      let balance = res.data.totalReceived + tipper.received - tipper.spent;
      balance = Math.trunc(parseFloat(balance) * 10e7) / 10e7;
      return cb(null, balance);
    })
    .catch((err) => {
      return cb(err.data ? err.data : err, null);
    });
}

/**
 * Reply to !tip balance and display user's balance.
 * DO NOT CONFUSE WITH getBalance!
 * @param message
 * @param tipper
 */
function doBalance(message, tipper, words) {
  if (message.channel.type !== 1) {
    return message.reply('send me this command in a direct message!');
  }

  getBalance(tipper, function (err, balance) {
    if (err) {
      debugLog(err);
      return message.reply('error getting balance!');
    }
    if (words.length > 2 && allowedFiatCurrencySymbols.includes(words[2].toLowerCase())) {
      getFiatToZenEquivalent(balance, words[2], true, function (err, value) {
        if (err) {
          message.reply(`Error getting currency rate for ${words[2]}`);
          return;
        }
        message.reply(`You have **${value} ${words[2]}**  (${balance} ZEN}`);
        return;
      });
    } else {
      message.reply(`You have **${balance}** ZEN`);
    }
  });
}

/**
 * @param message
 * @param tipper
 */
function doDeposit(message, tipper) {
  if (message.channel.type !== 1) {
    return message.reply('send me this command in a direct message!');
  }

  message.reply('**WARNING: do not mine to this address, your ZEN will not' + ' be credited to your balance !**\n\n' + 'Your deposit address is:');
  message.reply(tipper.address);
}

/**
 * Calculate equivalent of ZEN in given currency.
 * @param amount - float - given in specific currency
 * @param fiatCurrencySymbol - string - fiat currency ticker
 * @param zentofiat - boolean - calculate zen to fiat for doBalance
 * @param cb
 */
function getFiatToZenEquivalent(amount, fiatCurrencySymbol, zentofiat, cb) {
  const BASE_API_URL = 'https://api.coingecko.com/api/v3/coins/zencash/market_chart';
  const API_URL = `${BASE_API_URL}?vs_currency=${fiatCurrencySymbol}&days=0`;

  axios
    .get(API_URL)
    .then((res) => {
      const zenPrice = parseFloat(res.data.prices[0][1]);
      if (zentofiat) return cb(null, (zenPrice * amount).toFixed(8).toString());
      return cb(null, (amount / zenPrice).toFixed(8).toString());
    })
    .catch((err) => {
      return cb(err.data ? err.data : err, null);
    });
}

function getsSupportedCurrencies(cb) {
  const API_URL = 'https://api.coingecko.com/api/v3/simple/supported_vs_currencies';

  axios
    .get(API_URL)
    .then((res) => {
      allowedFiatCurrencySymbols = res.data;
      currencyHelp = res.data.sort().toString().replace(/,/g, ' ');
      return cb(null, 'Currency list updated');
    })
    .catch((err) => {
      return cb(err.data ? err.data : err, null);
    });
}

/**
 * Validate syntax and check if user's balance is enough to manipulate the
 * requested amount and also stop manipulation if amount is 0.
 * @param tipper
 * @param message
 * @param _amount
 * @param cb
 */
function getValidatedAmount(tipper, message, _amount, cb) {
  getBalance(tipper, function (err, balance) {
    if (err) {
      message.reply('Error getting your balance');
      return cb(err, null);
    }

    let amount = _amount.trim().toLowerCase();
    debugLog('getValidatedAmount amount: ' + amount);

    let symbol = '';
    if (allowedFiatCurrencySymbols.indexOf(amount.slice(-3)) > -1 || amount.toLowerCase().endsWith('zen')) {
      // Has a correct currency symbol
      symbol = amount.slice(-3);
    } else if (amount.endsWith('zens')) {
      symbol = 'zen';
    } else if (amount === 'random') {
      // random <0.0, 0.1) ZEN
      amount = Math.random() / 10;
    }

    // 8 decimals maximum
    amount = Math.trunc(parseFloat(amount) * 10e7) / 10e7;

    // Not A Number
    if (isNaN(amount)) {
      message.reply('Error incorrect amount');
      return cb('NaN', null);
    }

    // Invalid amount
    if (amount > 9000) {
      message.reply('what? Over 9000!');
      return cb('Over9K', null);
    }

    if (amount <= 0) {
      message.reply('Amount should be >= 1e-8 Zen');
      return cb('0', null);
    }

    // get fiat to zen value
    if (symbol && symbol !== 'zen') {
      getFiatToZenEquivalent(amount, symbol, false, function (err, value) {
        if (err) {
          message.reply('Error getting fiat rate');
          return cb(err, null);
        }
        if (value > balance) {
          message.reply('Your balance is too low');
          return cb('balance', null);
        }
        return cb(null, value);
      });

      // zen value with no symbol
    } else {
      if (amount > balance) {
        message.reply('Your balance is too low');
        return cb('balance', null);
      }
      return cb(null, amount);
    }
  });
}

function getValidatedPayoutAmount(tipper, message, _amount, cb) {
  // this version skips getting the balance for the tipper (admin) unless a currency symbol is found

  let amount = _amount.trim().toLowerCase();
  debugLog('getValidatedAmount amount: ' + amount);

  let symbol = '';
  if (allowedFiatCurrencySymbols.indexOf(amount.slice(-3)) > -1 || amount.toLowerCase().endsWith('zen')) {
    // Has a correct currency symbol
    symbol = amount.slice(-3);
  } else if (amount.endsWith('zens')) {
    symbol = 'zen';
  } else if (amount === 'random') {
    // random <0.0, 0.1) ZEN
    amount = Math.random() / 10;
  }

  // 8 decimals maximum
  amount = Math.trunc(parseFloat(amount) * 10e7) / 10e7;

  // Not A Number
  if (isNaN(amount)) {
    message.reply('Error incorrect amount');
    return cb('NaN', null);
  }

  // Invalid amount
  if (amount > 9000) {
    message.reply('what? Over 9000!');
    return cb('Over9K', null);
  }

  if (amount <= 0) {
    message.reply('Amount should be >= 1e-8 Zen');
    return cb('0', null);
  }

  // get fiat to zen value
  if (symbol && symbol !== 'zen') {
    getBalance(tipper, function (err, balance) {
      if (err) {
        message.reply('Error getting your balance');
        return cb(err, null);
      }
      getFiatToZenEquivalent(amount, symbol, false, function (err, value) {
        if (err) {
          message.reply('Error getting fiat rate');
          return cb(err, null);
        }
        if (value > balance) {
          message.reply('Your balance is too low');
          return cb('balance', null);
        }
        return cb(null, value);
      });
    });
    // zen value with no symbol
  } else {
    return cb(null, amount);
  }
}

/**
 * Validate amount if max is lower than maxTipZenAmount = 1.
 * @param amount
 */
function getValidatedMaxAmount(amount) {
  let maxTipZenAmount = 1;
  return amount <= maxTipZenAmount;
}

function transferToBot(user, zenbal) {
  createTx(user.address, user.priv, zencfg.address, TX_FEE, zenbal - TX_FEE, null, (err, res) => {
    if (err) return debugLog(err);
    debugLog(`transfer ${zenbal} for ${user.id}  txid:${res}`);

    User.updateOne({ id: user.id }, { $inc: { spent: TX_FEE } }, function (err, raw) {
      if (err) {
        debugLog(err);
      } else {
        debugLog(raw);
      }
    });
  });
}

function checkFunds(user) {
  axios
    .get(INSIGHT_API + '/addr/' + user.address)
    .then((res) => {
      if (res.data.balance > 2 * TX_FEE) {
        transferToBot(user, res.data.balance);
      }
    })
    .catch((err) => {
      return debugLog(err.data ? err.data : err);
    });
}

/**
 * Move all funds to the bot's address.
 *  called periodically from sweepfunds
 */
function moveFunds() {
  User.find({}, function (err, allUsers) {
    if (err) return debugLog(err.data ? err.data : err);
    allUsers.forEach((user) => {
      checkFunds(user);
    });
  });
}

/**
 * This function check all input parameters.
 *
 * @param fromAddresses - source addresses
 * @param toAddresses - destination addresses
 * @param fee - transaction fee
 */
function checkSendParameters(fromAddresses, toAddresses, fee) {
  let errors = [];

  // NOTE: this for is here only for case when there is more than 1 source address
  for (const fromAddress of fromAddresses) {
    if (fromAddress.length !== 35) {
      errors.push('Bad length of the source address!');
    }

    if (fromAddress.substring(0, 2) !== 'zn' && fromAddress.substring(0, 2) !== 'zt') {
      errors.push("Bad source address prefix - it has to be 'zn' or 'zt'!");
    }
  }

  // NOTE: this for is here only for case when there is more than 1 destination address
  for (const toAddress of toAddresses) {
    if (toAddress.length !== 35) {
      errors.push('Bad length of the destination address!');
    }

    if (toAddress.substring(0, 2) !== 'zn' && toAddress.substring(0, 2) !== 'zt') {
      errors.push("Bad destination address prefix - it has to be 'zn' or 'zt'!");
    }
  }

  if (typeof parseInt(fee, 10) !== 'number' || fee === '') {
    errors.push('Fee is NOT a number!');
  }

  // fee can be zero, in block can be few transactions with zero fee
  if (fee < 0) {
    errors.push('Fee has to be greater than or equal to zero!');
  }

  return errors;
}

/**
 * This function check all input parameters.
 *
 * @param fromAddress - source address
 * @param toAddress - destination address
 * @param fee - transaction fee
 * @param amount - amount of ZEN which will be send
 */
function checkStandardSendParameters(fromAddress, toAddress, fee, amount) {
  let errors = checkSendParameters([fromAddress], [toAddress], fee);

  if (typeof parseInt(amount, 10) !== 'number' || amount === '') {
    errors.push('Amount is NOT a number');
  }

  if (amount <= 0) {
    errors.push('Amount has to be greater than zero!');
  }

  return errors;
}

/**
 * @param url
 */
async function apiGet(url) {
  const resp = await axiosApi(url);
  return resp.data;
}

/**
 * @param url
 * @param form
 */
async function apiPost(url, form) {
  const resp = await axiosApi.post(url, form);
  return resp.data;
}

/**
 * Function for sending funds.
 *
 * @param fromAddress - source address
 * @param privateKey - private key of source address
 * @param toAddress - destination address
 * @param fee - transaction fee
 * @param amount - amount of ZEN which will be send
 * @param message - message for response to the user
 * @param cb - callback
 */
async function createTx(fromAddress, privateKey, toAddress, fee, amount, message, cb) {
  let paramErrors = checkStandardSendParameters(fromAddress, toAddress, fee, amount);
  if (paramErrors.length) {
    // TODO: Come up with better message. For now, just make a text out of it.
    const errString = paramErrors.join('\n\n');
    debugLog(errString);
    return cb(errString, null);
  }

  try {
    // Convert to satoshi
    let amountInSatoshi = Math.round(amount * 100000000);
    let feeInSatoshi = Math.round(fee * 100000000);
    const prevTxURL = '/addr/' + fromAddress + '/utxo';
    const infoURL = '/status?q=getInfo';
    const sendRawTxURL = '/tx/send';

    // Building our transaction TXOBJ
    // Calculate maximum ZEN satoshis that we have
    let satoshisSoFar = 0;
    let history = [];
    let recipients = [{ address: toAddress, satoshis: amountInSatoshi }];

    const txData = await apiGet(prevTxURL);
    if (message) message.reply('Creating transaction: 25%');
    const infoData = await apiGet(infoURL);
    if (message) message.reply('Creating transaction: 50%');

    const blockHeight = infoData.info.blocks - 300;
    const blockHashURL = '/block-index/' + blockHeight;

    const blockHash = (await apiGet(blockHashURL)).blockHash;
    if (message) message.reply('Creating transaction: 75%');

    // Iterate through each utxo and append it to history
    for (let i = 0; i < txData.length; i++) {
      if (txData[i].confirmations === 0) {
        continue;
      }

      history = history.concat({
        txid: txData[i].txid,
        vout: txData[i].vout,
        scriptPubKey: txData[i].scriptPubKey,
      });

      // How many satoshis we have so far
      satoshisSoFar = satoshisSoFar + txData[i].satoshis;
      if (satoshisSoFar >= amountInSatoshi + feeInSatoshi) {
        break;
      }
    }

    // If we don't have enough address - fail and tell it to the user
    if (satoshisSoFar < amountInSatoshi + feeInSatoshi) {
      let errStr = 'Insufficient funds on source address!';
      debugLog(errStr);
      return cb(errStr, null);
    }

    // If we don't have exact amount - refund remaining to current address
    if (satoshisSoFar !== amountInSatoshi + feeInSatoshi) {
      let refundSatoshis = satoshisSoFar - amountInSatoshi - feeInSatoshi;
      recipients = recipients.concat({ address: fromAddress, satoshis: refundSatoshis });
    }

    // Create transaction
    let txObj = zencashjs.transaction.createRawTx(history, recipients, blockHeight, blockHash);

    // Sign each history transcation
    for (let i = 0; i < history.length; i++) {
      txObj = zencashjs.transaction.signTx(txObj, i, privateKey, true);
    }

    // Convert it to hex string
    const txHexString = zencashjs.transaction.serializeTx(txObj);
    const txRespData = await apiPost(sendRawTxURL, { rawtx: txHexString });

    if (message) message.reply('Creating transaction: 100%');
    return cb(null, txRespData.txid);
  } catch (e) {
    debugLog(e.message);
    return cb(e.message, null);
  }
}

/**
 * @param message
 * @param tipper
 * @param words
 */
function doWithdraw(message, tipper, words) {
  if (message.channel.type !== 1) {
    return message.reply('send me this command in a direct message!');
  }

  //  wrong command syntax
  if (words.length < 4 || !words) {
    return doHelp(message, words);
  }

  getValidatedAmount(tipper, message, words[2], function (err, amount) {
    if (err) return;

    const toAddress = words[3];

    let prefix = 'zn';
    if (botcfg.testnet) {
      prefix = 'zt';
    }

    // only T addresses are supported!
    if (toAddress.length !== 35 || toAddress.toLowerCase().substring(0, 2) !== prefix) {
      return message.reply('only `T` addresses are supported!');
    }

    /*axios.get(
            INSIGHT_API + "/utils/estimatefee"
        ).then((res) => {*/
    const fee = TX_FEE; //temporary
    let fromAddress = zencfg.address;
    let privateKey = zencfg.priv;

    if (!regHex.test(privateKey)) privateKey = zencashjs.address.WIFToPrivKey(privateKey);
    createTx(fromAddress, privateKey, toAddress, fee, amount - fee, message, function (err, txId) {
      if (err) {
        debugLog(err);
        return message.reply('error creating transaction object !');
      }

      User.updateOne({ id: tipper.id }, { $inc: { spent: amount } }, function (err, raw) {
        if (err) {
          debugLog(err);
        } else {
          debugLog(raw);
          return message.reply(`you withdrew **${amount.toString()} ZEN** (-${fee} fee) to **${toAddress}** (${txLink(txId)})!`);
        }
      });
    });
    /*}).catch((err) => {
            debugLog(err.data);
            return message.reply("error getting estimatefee!");
        });*/
  });
}

/**
 * @param set
 * @param channel_id
 */
function retreiveChannelTipObjIdx(set, channel_id) {
  for (let i = 0; i < set.length; i++) {
    if (set[i].channel_id === channel_id) {
      return i;
    }
  }
  return null;
}

/**
 * @param message
 * @param receiver
 * @param words
 * @param bot
 */
function doOpenTip(message, receiver, words, bot) {
  if (message.channel.type === 1) {
    return message.reply("you can't send me this command in a DM");
  }

  // wrong command syntax
  if (words.length < 2 || !words) {
    return doHelp(message, words);
  }

  let idx = retreiveChannelTipObjIdx(tipAllChannels, message.channel.id);
  if (idx === null) {
    return message.reply('sorry, no ZEN packet to `open` in this channel!');
  }
  debugLog('open idx' + idx);

  let tipper = tipAllChannels[idx].tipper;
  debugLog('open tipper.id' + tipper.id);

  getBalance(tipper, function (err, balance) {
    if (err) {
      return message.reply('error getting balance!');
    }

    let amount;
    if (tipAllChannels[idx].luck) {
      debugLog('open tipAllChannels[idx].n_used ' + tipAllChannels[idx].n_used);
      debugLog('open tipAllChannels[idx].luck_tips ' + tipAllChannels[idx].luck_tips);
      amount = parseFloat(tipAllChannels[idx].luck_tips[tipAllChannels[idx].n_used]).toFixed(8);
    } else {
      debugLog('open tipAllChannels[idx].amount_total: ' + tipAllChannels[idx].amount_total);
      debugLog('open tipAllChannels[idx].quotient ' + tipAllChannels[idx].quotient);
      amount = parseFloat(tipAllChannels[idx].quotient).toFixed(8);
    }
    debugLog('open amount: ' + amount);
    debugLog('open balance: ' + balance);

    if (amount <= 0 || amount > balance) {
      return message.reply("I don't know how to tip that many ZEN!");
    }

    // prevent user from opening your own tip
    if (tipper.id === message.author.id) {
      return message.reply("you can't `open` your own tip ...");
    }

    debugLog('open receiver.id ' + receiver.id);

    for (let i = 0; i < tipAllChannels[idx].used_user.length; i++) {
      if (tipAllChannels[idx].used_user[i].id === message.author.id) {
        return message.reply("you can't `open` this for the second time...");
      }
    }

    sendZen(tipper, receiver, amount);
    bot.users.cache.get(tipper.id).send('<@' + message.author.id + '> received your tip (' + amount.toString() + ' ZEN)!');
    message.author.send(`${bot.users.cache.get(tipper.id).tag} sent you a **${amount} ZEN** tip!`);

    debugLog('open message.author.id ' + message.author.id);

    tipAllChannels[idx].n_used += 1;
    tipAllChannels[idx].used_user.push({
      id: message.author.id,
      amount: amount,
    });

    debugLog('tipAllChannels[idx].n' + tipAllChannels[idx].n);
    debugLog('tipAllChannels[idx].n_used' + tipAllChannels[idx].n_used);

    // if empty, then remove from active list of open tips
    if (tipAllChannels[idx].n === tipAllChannels[idx].n_used) {
      tipAllChannels.splice(idx, 1);

      return message.reply('that was the last piece! ZEN Packet from <@' + tipper.id + '> is now empty, thank you!');
    }
  });
}

/**
 * Try to find if channel has been already used,
 * if so, then replace last open tip in that channel.
 * @param tip
 * @param message
 */
function isChannelTipAlreadyExist(tip, message) {
  let now = new Date();
  // in minutes
  let allowedTimeBetweenChannelTips = 20;
  let diffMs;
  let diffMins;
  let type = tip.luck ? 'LUCK' : 'EACH';

  for (let i = 0; i < tipAllChannels.length; i++) {
    if (tipAllChannels[i].channel_id === tip.channel_id) {
      // milliseconds between now
      diffMs = now - tipAllChannels[i].creation_date;
      // minutes
      diffMins = Math.round(((diffMs % 86400000) % 3600000) / 60000);

      debugLog('isChannelTipAlreadyExist diffMs: ' + diffMs);
      debugLog('isChannelTipAlreadyExist diffMins: ' + diffMins);

      if (diffMins > allowedTimeBetweenChannelTips) {
        // tip already exist, but it expire -> replace it
        tipAllChannels[i] = tip;
        message.reply('new `' + type + '` ZEN packet has been created (' + tip.amount_total.toString() + ' ZEN)! Claim it with command `!tip open`');
        return 0;
      } else {
        // tip already exist and is still valid
        message.reply("can't create new ZEN packet because" + ' the previous tip is still in progress!\n**' + tipAllChannels[i].n_used + '/' + tipAllChannels[i].n + ' opened**\n**' + (20 - diffMins) + ' minutes left**');
        return 1;
      }
    }
  }
  // tip doesnt exist in this channel -> create new
  tipAllChannels.push(tip);
  message.reply('new `' + type + '` ZEN packet has been created (' + tip.amount_total.toString() + ' ZEN)! Claim it with command `!tip open`');
  return 2;
}

/**
 * Shuffle array.
 * @param array
 */
function shuffle(array) {
  let counter = array.length;

  // While there are elements in the array
  while (counter > 0) {
    // Pick a random index
    let index = Math.floor(Math.random() * counter);

    // Decrease counter by 1
    counter--;

    // And swap the last element with it
    let temp = array[counter];
    array[counter] = array[index];
    array[index] = temp;
  }

  return array;
}

/**
 * @param message
 * @param tipper
 * @param words
 */
function createTipLuck(message, tipper, words) {
  if (message.channel.type === 1) {
    return message.reply("you can't send me this command in a DM");
  }

  // wrong command syntax
  if (words.length < 4 || !words) {
    return doHelp(message, words);
  }

  getValidatedAmount(tipper, message, words[2], function (err, amount) {
    if (err) return;

    if (!getValidatedMaxAmount(amount)) {
      return message.reply('Tip 1 zen maximum !');
    }

    let n = parseFloat(words[3]).toFixed(8);
    if (isNaN(n) || n <= 0) {
      return message.reply("I don't know how to tip that many people!");
    } else if (n > 20) {
      return message.reply('20 people is the maximum per ZEN packet!');
    }
    let quotient = (amount / n).toFixed(8);

    debugLog('createTipLuck amount' + amount);
    debugLog('createTipLuck n' + n);
    debugLog('createTipLuck quotient' + quotient);

    let luckTips = new Array(parseInt(n));
    if (n > 1) {
      for (let i = 0; i < luckTips.length - 1; i++) {
        luckTips[i] = (Math.random() * parseFloat(quotient)).toFixed(8);
      }

      let sum = luckTips.reduce(function (total, num) {
        return parseFloat(total) + parseFloat(num);
      });
      debugLog('createTipLuck sum' + sum);

      luckTips[luckTips.length - 1] = (parseFloat(amount) - parseFloat(sum)).toFixed(8);
      debugLog('createTipLuck luckTips' + luckTips);

      // shuffle random tips (somewhere is BONUS) :-)
      luckTips = shuffle(luckTips);
      debugLog('createTipLuck luckTips (shuffled) ' + luckTips);
    } else {
      luckTips[0] = parseFloat(amount).toFixed(8);
    }

    let tipOneChannel = {
      channel_id: message.channel.id,
      tipper: tipper,
      luck: true,
      amount_total: amount,
      quotient: quotient,
      n: parseInt(n),
      n_used: 0,
      luck_tips: luckTips,
      used_user: [],
      creation_date: new Date(),
    };

    isChannelTipAlreadyExist(tipOneChannel, message);
  });
}

/**
 * @param message
 * @param tipper
 * @param words
 */
function createTipEach(message, tipper, words) {
  if (message.channel.type === 1) {
    return message.reply("you can't send me this command in a DM");
  }

  // wrong command syntax
  if (words.length < 4 || !words) {
    return doHelp(message, words);
  }

  getValidatedAmount(tipper, message, words[2], function (err, amount) {
    if (err) return;

    if (!getValidatedMaxAmount(amount)) {
      return message.reply('Tip 1 zen maximum !');
    }

    let n = parseFloat(words[3]).toFixed(8);
    if (isNaN(n) || n <= 0) {
      return message.reply("I don't know how to tip that many people!");
    } else if (n > 20) {
      return message.reply('20 people is the maximum per ZEN packet!');
    }
    let quotient = (amount / n).toFixed(8);

    debugLog('createTipEach n' + n);
    debugLog('createTipEach quotient' + quotient);
    debugLog('createTipEach amount' + amount);

    let tipOneChannel = {
      channel_id: message.channel.id,
      tipper: tipper,
      luck: false,
      amount_total: amount,
      quotient: quotient,
      n: parseInt(n),
      n_used: 0,
      used_user: [],
      creation_date: new Date(),
    };

    isChannelTipAlreadyExist(tipOneChannel, message);
  });
}

/**
 * @param usertxt
 */
function resolveMention(usertxt) {
  let userid = usertxt;
  if (usertxt.startsWith('<@!')) {
    userid = usertxt.substr(3, usertxt.length - 4);
  } else {
    if (usertxt.startsWith('<@')) {
      userid = usertxt.substr(2, usertxt.length - 3);
    }
  }
  return userid;
}

/**
 * @param message
 * @param tipper
 * @param words
 * @param bot
 */
function doTip(message, tipper, words, bot) {
  if (message.channel.type === 1) {
    return message.reply("you can't send me this command in a DM");
  }

  // wrong command syntax
  if (words.length < 3 || !words) {
    return doHelp(message, words);
  }

  getValidatedAmount(tipper, message, words[2], function (err, amount) {
    if (err) return;

    debugLog(amount);

    if (!getValidatedMaxAmount(amount)) {
      return message.reply('Tip 1 zen maximum !');
    }

    let targetId = resolveMention(words[1]);
    debugLog('doTip targetId' + targetId);
    try {
      const target = bot.users.cache.get(targetId);
      debugLog('doTip target.id ' + target.id);

      if (!target) {
        return message.reply("I cant't find a user in your tip ...");
      } else {
        if (tipper.id === target.id) {
          return message.reply("you can't tip yourself ...");
        }

        getUser(target.id, function (err, receiver) {
          if (err) {
            return message.reply(err.message);
          }

          sendZen(tipper, receiver, amount);
          message.author.send(`${bot.users.cache.get(receiver.id).tag} received your tip (${amount} ZEN)!`);
          const msgtotarget = words.length > 3 ? words.slice(3).join(' ') : '';
          const text = `${bot.users.cache.get(tipper.id).tag} sent you a **${amount} ZEN** tip! ${msgtotarget}`;
          target.send(text);
        });
      }
    } catch (error) {
      debugLog('Failed to fetch user or process tip: ', error);
    }
  });
}

function doPayout(message, tipper, words, bot) {
  if (message.channel.type === 1) {
    return message.reply("you can't send me this command in a DM");
  }

  if (!tipper.isAdmin) {
    return message.reply('That is an invalid command. Check !tip help');
  }

  // wrong command syntax
  if (words.length < 3 || !words) {
    return doHelp(message, words);
  }

  getValidatedPayoutAmount(tipper, message, words[3], function (err, amount) {
    if (err) return;

    debugLog(amount);

    if (!getValidatedMaxAmount(amount)) {
      return message.reply('Payout 1 zen maximum !');
    }

    let targetId = resolveMention(words[2]);
    debugLog('doPayout targetId  ' + targetId);

    try {
      const target = bot.users.cache.get(targetId);
      debugLog('doPayout target.id ' + target.id);

      if (!target) {
        return message.reply("I cant't find a user in your payout ...");
      } else {
        if (tipper.id === target.id) {
          return message.reply("you can't pay yourself ...");
        }

        getUser(target.id, function (err, receiver) {
          if (err) {
            return message.reply(err.message);
          }

          sendZen(tipper, receiver, amount);
          message.author.send(`${bot.users.cache.get(receiver.id).tag} received your tip (${amount} ZEN)!`);
          const msgtotarget = words.length > 4 ? words.slice(4).join(' ') : '';
          const text = `${bot.users.cache.get(tipper.id).tag} sent you a **${amount} ZEN** tip! ${msgtotarget}`;
          target.send(text);
          if (moderation.logchannel) sendToBotLogChannel(bot, `payout of ${amount} sent to <@${receiver.id}> ${msgtotarget}`);
        });
      }
    } catch (error) {
      debugLog('Failed to fetch user or process tip: ', error);
    }
  });
}

/**
 * @param tipper
 * @param receiver
 * @param amount
 */
function sendZen(tipper, receiver, amount) {
  // update tipper's spent amount
  User.updateOne({ id: tipper.id }, { $inc: { spent: amount } }, function (err, raw) {
    if (err) {
      debugLog(err);
    } else {
      debugLog(raw);
    }
  });

  // and receiver's received amount
  User.updateOne({ id: receiver.id }, { $inc: { received: amount } }, function (err, raw) {
    if (err) {
      debugLog(err);
    } else {
      debugLog(raw);
    }
  });
}

/**
 * @param txId is transaction id
 */
function txLink(txId) {
  return `<${INSIGHT_BASE}/tx/${txId}> `;
}

/**
 * @param log - log if bot is in debug mode
 */
function debugLog(log) {
  if (botcfg.debug) {
    console.log(log);
  }
}

function sendToBotLogChannel(bot, msgtext) {
  try {
    const channel = bot.channels.cache.get(moderation.logchannel);
    channel.send(msgtext);
  } catch (error) {
    return debugLog(error.data ? error.data : error);
  }
}

function suspend(msg, tipper, words, bot) {
  if (!tipper.isAdmin) {
    return msg.reply('That is an invalid command. Check with !tip help');
  }
  lastSuspend = new Date();

  if (words[2]) {
    if (!regSuspend.test(words[2])) return msg.reply('Minutes must be between 1 and 100. Suspend failed.');
    sweepSuspend = Number(words[2]) * 60 * 1000;
  }
  if (moderation.logchannel) sendToBotLogChannel(bot, `Scheduled background task suspended for ${sweepSuspend / 1000 / 60} minutes.`);

  return msg.reply(`Scheduled background task suspended for ${sweepSuspend / 1000 / 60} minutes.`);
}

function sweepFunds() {
  if (lastSuspend.getTime() + sweepSuspend - 500 > 0) {
    console.log('sweeping funds');
    moveFunds();
  }
  setTimeout(sweepFunds, sweepInterval);
}

getsSupportedCurrencies((err, resp) => {
  if (err) return console.log(`getSupportedCurrencies: ${err} `);
  console.log(resp);
});
sweepFunds();

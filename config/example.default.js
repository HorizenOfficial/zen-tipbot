/*
bot
  sweepIntervalMs - optional - defaults to 24 hours if not present. Enter as number in milliseconds
     sweepfunds runs only to catch deposits when a user has not sent a check balance to trigger a zen transaction.
     sweepfund will run on bot startup and then every interval
     
  sweepSuspendMs - optional - defaults to 1 hour if not present.  Enter as number in milliseconds
     used by admin to keep a sweep from running while processing payouts.

zen
  priv - accepts either uncompressed or Wallet Import Format (dumpprivkey from zen-cli)

moderation
  role - optional - user must have this role to use bot.  Leave blank if everyone can use it
  logchannel - optional - channel to receive limited log messages. Currently: when sweep funds runs; summary of a payout.
    Leave blank or delete to disable

admins
  optional list (array) of user ids which allows users to use admin methods of suspend and payout

*/


exports.Config = {
  "bot": {
    "token":"DISCORD TOKEN",
    "serverId": "SERVER ID",
    "prefix": "!",
    "debug": true,
    "testnet": true,
    "sweepIntervalMs": 0,
    "sweepSuspendMs": 0
  },
  "zen": {
    "priv":"UNCOMPRESSED OR WIF PRIVATE KEY",
    "address":"BOT'S ADDRESS"
  },
  "mongodb": {
    "url":"mongodb://localhost:27017/tipbot",
    "options": {
      "useNewUrlParser": true
    }
  },
  "moderation":{
    "role": "ALLOWED ROLE ID",
    "logchannel": "LOG CHANNEL ID"
  },
  "admins": ["USER ID", "USER ID 2"]
}

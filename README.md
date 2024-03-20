# Bot for ZEN's Discord
This bot allows users to send tips (ZEN) to other users after funding their tip account. 

Features:

- Tipbot for ZEN. Responds to `!tip`.
- Dynamic plugin loading with permission support.


## Requirements

- node > 16.9.0
- mongod > 3.6.0


## Installation

Create a bot and get the bot's API Token: https://discordapp.com/developers/applications/me

Connect the bot to a discord server.

Edit and rename default.json.example in /config,
Make sure you have mongod running,
then run:
```
npm install
node bot/bot.js
```

or for production:
```
npm run prod
```


## Credits

Based on the original work https://github.com/lbryio/lbry-tipbot from filipnyquist <filip@lbry.io>

## Changes
2022-09:
 - Updated discord.js to v14 (required some code changes)
 - Updated other dependencies
2021-09: 
- The method to check all users for new deposits each time any user makes any call to tipbot has been changed to run every 20 minutes (configurable).  The check also runs when a user checks their balance, but only for that user.
 - A user may be designated an admin by adding their discord id to the configuration.  The admin has two extra !tip commands: suspend and payout.
 - The admin may suspend the periodic check new deposits task so it does not run for a specified number of minutes and interrupt processing payouts.
 - The payout command allows an admin process payments without checking the balance for the admin which was slowing down processing.
 - Help was updated with the following:
   - help with admin commands for admins only
   - dynamic list of currencies supported. List is updated when tipbot restarts.
 - Node modules were updated to more recent versions along with rewrites where needed due to changes in some modules.
 - Fixed the alternate currency feature. It now uses coingecko and supports more currencies.
 - Fixed sending a optional message with a tip.
 - Fixed testing on testnet.


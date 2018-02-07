# Bot for ZEN's Discord
(This README will be updated along with bot updates)

Features:

- Tipbot for ZEN. Responds to `!tip`.
- Dynamic plugin loading with permission support.


## Requirements

- node > 8.0.0
- npm > 0.12.x
- mongod > ?
- one Zen full node


## Installation

Create a bot and get the bot's API Token: https://discordapp.com/developers/applications/me

Edit and rename default.json.example in /config, then run:
```
npm install
node bot.js
```

or for production:
```
npm run prod
```


## Credits

Based on the original work https://github.com/lbryio/lbry-tipbot from filipnyquist <filip@lbry.io>

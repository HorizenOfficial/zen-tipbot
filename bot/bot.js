'use strict';

// eslint-disable-next-line node/no-unpublished-require
const { Config } = require('../config/default');
const { Client, GatewayIntentBits, Partials } = require('discord.js');


const moderation = Config.moderation;
const config = Config.botcfg;
const commands = {};
const bot = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.DirectMessages],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});
let guild;
let aliases;

try {
  // eslint-disable-next-line node/no-missing-require
  aliases = require('./alias.json');
} catch (e) {
  // No aliases defined
  aliases = {
    test: {
      process: function (bot, msg) {
        msg.channel.send('test');
      },
    },
  };
}

bot.on('ready', function () {
  console.log(`Logged in! Serving in ${bot.guilds.cache.size} servers`);
  require('./plugins.js').init();
  console.log('type ' + config.prefix + 'help in Discord for a commands list.');
  guild = bot.guilds.cache.get(config.serverId);
  console.log(`Server: ${guild.name}  member count: ${guild.memberCount}`);
  bot.user.setActivity(config.prefix + 'tip');
});

bot.on('disconnected', function () {
  console.log('Disconnected!');
  // exit node.js with an error
  process.exitCode = 1;
});

/**
 * @param msg
 * 
 */
function checkMessageForCommand(msg) {
  // don't process replies
  // https://discord.com/developers/docs/resources/channel#message-object-message-types
  if (msg.type === 19) return null;

  if (msg.mentions.everyone) {
    console.log('skipping message to everyone')
    return
  }

  // check if message is a command
  let txt = msg.content.split(' ')[0];
  if (msg.author.id !== bot.user.id && txt === config.prefix + 'tip') {
    console.log('treating ' + msg.content + ' from ' + msg.author + ' as command');
    let cmdTxt = msg.content.split(' ')[0].substring(config.prefix.length);
    if (msg.mentions.has(bot.user)) {
      try {
        cmdTxt = msg.content.split(' ')[1];
      } catch (e) {
        // no command
        msg.channel.send('Yes, how can I help you? DM me with !tip help');
        return;
      }
    }
    let alias = aliases[cmdTxt];
    let cmd;
    if (alias) {
      cmd = alias;
    } else {
      cmd = commands[cmdTxt];
    }

    if (cmd) {
      try {
        const target = guild.members.cache.has(msg.author.id) || guild.members.cache.has(guild.owner);
        // permission check
        if (target && moderation.role && !target.roles.cache.has(moderation.role)) {
          console.log('member ' + msg.author.id + ' not allowed to use the bot');
          return;
        }

        try {
          cmd.process(bot, msg);
        } catch (e) {
          let msgTxt = 'command ' + cmdTxt + ' failed :(';
          if (config.debug) {
            msgTxt += '\n' + e.stack;
          }
          msg.channel.send(msgTxt);
        }
      } catch (error) {
        console.log('Failed to fetch guild user: ', error);
      }
    }
  } else {
    // message is not a command or is from us drop our own messages to prevent feedback loops
    if (msg.author === bot.user) {
      return;
    } else if (msg.author !== bot.user && msg.mentions.has(bot.user)) {
      // using a mention here can lead to looping
      msg.channel.send('Yes, how can I help you?');
    } else {
      // regular msg that has probably nothing to do with the bot ;)
    }
  }
}

bot.on('messageCreate', (msg) => {
  checkMessageForCommand(msg);
}
);

exports.addCommand = function (commandName, commandObject) {
  try {
    commands[commandName] = commandObject;
  } catch (err) {
    console.log(err);
  }
};

exports.addCustomFunc = function (customFunc) {
  try {
    customFunc(bot);
  } catch (err) {
    console.log(err);
  }
};

exports.commandCount = function () {
  return Object.keys(commands).length;
};

bot.login(config.token);

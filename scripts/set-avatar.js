import { Client, GatewayIntentBits } from 'discord.js';
import { config } from '../src/config.js';

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

await client.login(config.token);

const guild =
  (config.guildId && client.guilds.cache.get(config.guildId)) ||
  client.guilds.cache.find((g) => g.name.toLowerCase() === 'wellix') ||
  client.guilds.cache.first();

if (!guild) {
  console.error('the bot is not in a guild called wellix, set GUILD_ID');
  client.destroy();
  process.exit(1);
}

const url = guild.iconURL({ size: 512, extension: 'png' });
if (!url) {
  console.error(`${guild.name} has no icon`);
  client.destroy();
  process.exit(1);
}

await client.user.setAvatar(url);
console.log(`avatar set from ${guild.name} (${url})`);

client.destroy();

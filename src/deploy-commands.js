import { REST, Routes } from 'discord.js';
import { config } from './config.js';
import { COMMANDS } from './commands/index.js';
import { buildSlashData } from './lib/registry.js';

if (!config.clientId) {
  console.error('CLIENT_ID is missing in .env');
  process.exit(1);
}

const body = buildSlashData(COMMANDS);
const rest = new REST({ version: '10' }).setToken(config.token);

console.log(`preparing ${body.length} slash commands`);

if (config.guildId) {
  await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), { body });
  console.log(`registered ${body.length} commands in guild ${config.guildId}`);
} else {
  const global = body.slice(0, 100);
  await rest.put(Routes.applicationCommands(config.clientId), { body: global });
  console.log(`registered ${global.length} global commands (discord caches these for up to an hour)`);

  if (body.length > 100) {
    console.warn(
      `warning: ${body.length} commands but discord only allows 100 global. set GUILD_ID to register the rest per guild.`,
    );
  }
}

import members from './members.js';
import roles from './roles.js';
import channels from './channels.js';
import messages from './messages.js';
import server from './server.js';
import utility from './utility.js';
import automation from './automation.js';

export const COMMANDS = [...members, ...roles, ...channels, ...messages, ...server, ...utility, ...automation];

const seen = new Set();
for (const cmd of COMMANDS) {
  if (seen.has(cmd.name)) throw new Error(`duplicate command: ${cmd.name}`);
  seen.add(cmd.name);
}

export const BY_NAME = new Map(COMMANDS.map((c) => [c.name, c]));
export const CATEGORIES = [...new Set(COMMANDS.map((c) => c.cat))];

export default COMMANDS;

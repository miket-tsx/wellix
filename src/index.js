import {
  ActionRowBuilder,
  Client,
  ContainerBuilder,
  Events,
  GatewayIntentBits,
  Partials,
  SeparatorBuilder,
  SeparatorSpacingSize,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextDisplayBuilder,
} from 'discord.js';
import { config } from './config.js';
import { BY_NAME, COMMANDS } from './commands/index.js';
import { flush, guildCfg, prefixFor } from './lib/db.js';
import { COLOR, embed } from './lib/render.js';
import { ACCENT, reply, respond, send } from './lib/cv2.js';
import { runPrefix, runSlash } from './lib/registry.js';
import { cache } from './lib/cache.js';
import { check as automodCheck, runAutoreact, runAutoresponder } from './features/automod.js';
import { onJoin, onLeave } from './features/welcome.js';
import { handleTicketComponent } from './features/tickets.js';
import { runJoinFeatures, runLeaveFeatures, runMessageFeatures } from './features/scripted.js';
import { handleAgentMessage } from './ai/agent.js';
import { CAPABILITY_COUNT } from './ai/capabilities.js';
import { restore, setHandlers } from './lib/scheduler.js';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildEmojisAndStickers,
    GatewayIntentBits.GuildInvites,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [Partials.Channel, Partials.GuildMember, Partials.Message, Partials.Reaction, Partials.User],
});

function groupCommands() {
  const groups = new Map();
  for (const cmd of COMMANDS) {
    if (!groups.has(cmd.cat)) groups.set(cmd.cat, []);
    groups.get(cmd.cat).push(cmd.name);
  }
  return groups;
}

// one panel, a dropdown, no hundred-command wall in the channel.
function helpPanel(prefix) {
  const groups = groupCommands();

  const overview = [...groups.entries()].map(([cat, names]) => `**${cat}** · ${names.length}`).join('\n');

  const menu = new StringSelectMenuBuilder()
    .setCustomId('help:cat')
    .setPlaceholder('pick a category')
    .addOptions(
      [...groups.entries()].map(([cat, names]) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(cat)
          .setDescription(`${names.length} commands`)
          .setValue(cat),
      ),
    );

  const footer = `-# \`${prefix}help <command>\` for args · or mention me and describe the job`;

  return new ContainerBuilder()
    .setAccentColor(ACCENT)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`## wellix\n-# prefix \`${prefix}\` · slash \`/\` · ai: mention me`),
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`${overview}\n\n**${COMMANDS.length}** commands · **${CAPABILITY_COUNT}** capabilities`),
    )
    .addActionRowComponents(new ActionRowBuilder().addComponents(menu))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(footer));
}

function categoryPanel(prefix, cat) {
  const names = COMMANDS.filter((c) => c.cat === cat).map((c) => c.name);
  if (!names.length) return null;

  const body = names.map((n) => `\`${prefix}${n}\``).join(' · ');

  return new ContainerBuilder()
    .setAccentColor(ACCENT)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${cat}\n${body}`))
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`-# ${names.length} commands · \`${prefix}help <command>\` for details`),
    );
}

function commandHelp(prefix, name) {
  const cmd = BY_NAME.get(String(name).toLowerCase());
  if (!cmd) return null;
  const opts = (cmd.options || []).map((o) => `\`${o.name}\`${o.required ? '' : '?'}`).join(' ') || 'none';
  return embed({
    title: `${prefix}${cmd.name}`,
    description: `${cmd.desc}\n\nusage: \`${prefix}${cmd.name} ${opts}\``,
    color: COLOR.info,
    fields: [
      { name: 'category', value: cmd.cat, inline: true },
      { name: 'needs', value: cmd.require || 'anyone', inline: true },
    ],
  });
}

async function onMessage(message) {
  if (!message.inGuild() || message.author.bot) return;

  if (await automodCheck(message)) return;

  await runMessageFeatures(message).catch(() => {});
  await runAutoreact(message).catch(() => {});
  await runAutoresponder(message).catch(() => {});

  const prefix = prefixFor(message.guild.id);
  const content = message.content;

  if (message.mentions.has(client.user)) {
    const prompt = content.replace(new RegExp(`<@!?${client.user.id}>`, 'g'), '').trim();
    if (!prompt) return reply(message, helpPanel(prefix)).catch(() => {});
    if (/^(help|commands)$/i.test(prompt)) return reply(message, helpPanel(prefix)).catch(() => {});
    return handleAgentMessage(message, prompt);
  }

  if (!content.toLowerCase().startsWith(prefix.toLowerCase())) return;

  const body = content.slice(prefix.length).trim();
  const [name, ...rest] = body.split(/\s+/);
  const command = String(name || '').toLowerCase();

  if (!command) return reply(message, helpPanel(prefix)).catch(() => {});

  if (command === 'help') {
    if (rest[0]) {
      const card = commandHelp(prefix, rest[0]);
      if (!card) return reply(message, `no command called \`${rest[0]}\`.`).catch(() => {});
      return reply(message, card).catch(() => {});
    }
    return reply(message, helpPanel(prefix)).catch(() => {});
  }

  const found = BY_NAME.get(command);
  if (!found) {
    return reply(message, `unknown command \`${prefix}${command}\`. try \`${prefix}help\`.`).catch(() => {});
  }

  await runPrefix(message, found, rest.join(' '));
}

client.on(Events.MessageCreate, (message) => {
  onMessage(message).catch((err) => console.error('message:', err));
});

client.on(Events.MessageDelete, (message) => {
  if (message.guild) cache.sniped(message.channelId, message);
});

client.on(Events.MessageUpdate, (oldMessage, newMessage) => {
  if (newMessage.guild) cache.edited(newMessage.channelId, oldMessage, newMessage);
});

client.on(Events.GuildMemberAdd, (member) => {
  onJoin(member).catch(() => {});
  runJoinFeatures(member).catch(() => {});
});

client.on(Events.GuildMemberRemove, (member) => {
  onLeave(member).catch(() => {});
  runLeaveFeatures(member).catch(() => {});
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isStringSelectMenu() && interaction.customId === 'help:cat') {
      const prefix = prefixFor(interaction.guildId);
      const panel = categoryPanel(prefix, interaction.values[0]);
      if (!panel) return respond(interaction, { content: 'that category is gone.' }, { ephemeral: true });
      await respond(interaction, panel, { ephemeral: true });
      return;
    }
    if (interaction.isButton()) {
      await handleTicketComponent(interaction);
      return;
    }
    if (interaction.isChatInputCommand()) {
      await runSlash(interaction);
    }
  } catch (err) {
    console.error('interaction:', err);
    if (!interaction.isRepliable()) return;
    await respond(interaction, truncateError(err), { ephemeral: true }).catch(() => {});
  }
});

function truncateError(err) {
  return `something broke: ${String(err.message || err).slice(0, 300)}`;
}

async function applyReactionRole(reaction, user, add) {
  if (user.bot) return;
  if (reaction.partial) await reaction.fetch().catch(() => {});
  const guild = reaction.message.guild;
  if (!guild) return;

  const cfg = guildCfg(guild.id);
  const key = reaction.emoji.id || reaction.emoji.name;
  const rule = cfg.reactionRoles.find(
    (r) => r.messageId === reaction.message.id && [r.emoji, key, reaction.emoji.toString(), reaction.emoji.name].includes(r.emoji),
  );
  if (!rule) return;

  const member = await guild.members.fetch(user.id).catch(() => null);
  const role = guild.roles.cache.get(rule.roleId);
  if (!member || !role) return;

  await (add ? member.roles.add(role) : member.roles.remove(role)).catch(() => {});
}

client.on(Events.MessageReactionAdd, (reaction, user) => {
  applyReactionRole(reaction, user, true).catch(() => {});
});

client.on(Events.MessageReactionRemove, (reaction, user) => {
  applyReactionRole(reaction, user, false).catch(() => {});
});

client.once(Events.ClientReady, (ready) => {
  console.log(`wellix online as ${ready.user.tag}`);
  console.log(`${COMMANDS.length} commands, ${CAPABILITY_COUNT} capabilities`);

  ready.user.setPresence({
    activities: [{ name: '@wellix to run the server', type: 0 }],
    status: 'online',
  });

  setHandlers({
    unban: async (job) => {
      const guild = ready.guilds.cache.get(job.guildId);
      if (guild) await guild.bans.remove(job.data.userId, 'tempban expired').catch(() => {});
    },
    remind: async (job) => {
      const channel = ready.channels.cache.get(job.data.channelId);
      if (channel?.isTextBased()) {
        await send(channel, { content: `<@${job.data.userId}> reminder: ${job.data.text}` }).catch(() => {});
      }
    },
    say: async (job) => {
      const channel = ready.channels.cache.get(job.data.channelId);
      if (channel?.isTextBased()) {
        await send(channel, { content: job.data.content, allowedMentions: { parse: [] } }).catch(() => {});
      }
    },
  });

  restore();
});

client.on(Events.Error, (err) => console.error('gateway:', err.message));

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log('shutting down');
    flush();
    client.destroy();
    process.exit(0);
  });
}

client.login(config.token);

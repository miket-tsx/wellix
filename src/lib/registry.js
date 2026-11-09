import { PermissionsBitField, SlashCommandBuilder } from 'discord.js';
import { guildCfg } from './db.js';
import { COLOR, embed, errorText } from './render.js';
import { send, toPayload } from './cv2.js';
import { idFrom } from './util.js';
import { resolveChannel, resolveMember, resolveRole } from './resolvers.js';
import { requireStaff } from '../commands/helpers.js';
import { BY_NAME } from '../commands/index.js';

const BUILDER = {
  string: 'addStringOption',
  int: 'addIntegerOption',
  num: 'addNumberOption',
  bool: 'addBooleanOption',
  user: 'addUserOption',
  member: 'addUserOption',
  role: 'addRoleOption',
  channel: 'addChannelOption',
  attach: 'addAttachmentOption',
};

export function buildSlashData(commands) {
  return commands.map((cmd) => {
    const builder = new SlashCommandBuilder().setName(cmd.name).setDescription(cmd.desc.slice(0, 100)).setDMPermission(false);
    for (const opt of cmd.options || []) {
      builder[BUILDER[opt.type]]((o) => {
        o.setName(opt.name).setDescription(opt.description).setRequired(!!opt.required);
        if (opt.choices?.length) o.addChoices(...opt.choices.map((c) => ({ name: c.name, value: c.value })));
        if (opt.type === 'int' || opt.type === 'num') {
          if (opt.min !== undefined) o.setMinValue(opt.min);
          if (opt.max !== undefined) o.setMaxValue(opt.max);
        }
        return o;
      });
    }
    return builder.toJSON();
  });
}

// prefix: tokenise against the option list.
// multi word text works when it is the last argument or when the trailing token
// is an obvious #channel / @user / id that belongs to the next option.
function looksLikeTarget(token) {
  return /^(<[#@][!&]?\d+>|#[^\s]+|@[^\s]+|\d{16,20})$/.test(token);
}

export function readPrefixArgs(cmd, rest) {
  const tokens = rest.trim() ? rest.trim().match(/"[^"]*"|\S+/g)?.map((t) => t.replace(/^"|"$/g, '')) : [];
  const options = cmd.options || [];
  const args = {};
  let i = 0;

  for (let k = 0; k < options.length; k++) {
    const opt = options[k];
    const after = options.slice(k + 1);

    if (!tokens || i >= tokens.length) {
      if (opt.required) return { error: `missing \`${opt.name}\` (${opt.description})` };
      args[opt.name] = undefined;
      continue;
    }

    if (opt.type === 'string') {
      const lastToken = tokens[tokens.length - 1];
      if (after.length && ['channel', 'role', 'member', 'user'].includes(after[0].type) && looksLikeTarget(lastToken)) {
        args[opt.name] = tokens.slice(i, tokens.length - 1).join(' ');
        args[after[0].name] = lastToken;
        i = tokens.length;
        k++;
        continue;
      }

      if (after.length && after.every((o) => ['bool', 'int', 'num'].includes(o.type))) {
        let end = tokens.length;
        for (let j = after.length - 1; j >= 0; j--) {
          const o = after[j];
          const token = tokens[end - 1];
          if (!token) break;
          const fits =
            (o.type === 'int' && /^\d+$/.test(token)) ||
            (o.type === 'num' && !Number.isNaN(Number(token))) ||
            (o.type === 'bool' && /^(true|false|yes|no|on|off|1|0)$/i.test(token));
          if (!fits) break;
          args[o.name] = token;
          end--;
        }
        args[opt.name] = tokens.slice(i, end).join(' ');
        return { args };
      }

      if (!after.length) {
        args[opt.name] = tokens.slice(i).join(' ');
        i = tokens.length;
        continue;
      }
    }

    args[opt.name] = tokens[i++];
  }

  return { args };
}

export async function coerce(guild, cmd, raw, client) {
  const out = {};

  for (const opt of cmd.options || []) {
    const value = raw[opt.name];
    if (value === undefined || value === null || value === '') {
      if (opt.required) return { error: `missing \`${opt.name}\`` };
      out[opt.name] = undefined;
      continue;
    }

    switch (opt.type) {
      case 'member': {
        const m = await resolveMember(guild, value);
        if (!m) return { error: `no member matching \`${value}\`` };
        out[opt.name] = m;
        break;
      }
      case 'user': {
        if (value?.id) {
          out[opt.name] = value;
          break;
        }
        const m = await resolveMember(guild, value).catch(() => null);
        if (m) {
          out[opt.name] = m.user;
          break;
        }
        const id = idFrom(value);
        const user = id ? await client.users.fetch(id).catch(() => null) : null;
        if (!user) return { error: `no user matching \`${value}\`` };
        out[opt.name] = user;
        break;
      }
      case 'role': {
        const r = await resolveRole(guild, value);
        if (!r) return { error: `no role called \`${value}\`` };
        out[opt.name] = r;
        break;
      }
      case 'channel': {
        const c = await resolveChannel(guild, value);
        if (!c) return { error: `no channel called \`${value}\`` };
        out[opt.name] = c;
        break;
      }
      case 'int':
        out[opt.name] = parseInt(value, 10);
        if (Number.isNaN(out[opt.name])) return { error: `\`${opt.name}\` must be a number` };
        break;
      case 'num':
        out[opt.name] = Number(value);
        if (Number.isNaN(out[opt.name])) return { error: `\`${opt.name}\` must be a number` };
        break;
      case 'bool':
        out[opt.name] = /^(true|yes|on|1|y)$/i.test(String(value));
        break;
      default:
        out[opt.name] = value;
    }
  }

  return { args: out };
}

function readSlash(interaction) {
  const out = {};
  for (const opt of interaction.options.data) {
    switch (opt.type) {
      case 1:
      case 2:
        out[opt.name] = interaction.options.getMember(opt.name) || interaction.options.getUser(opt.name);
        break;
      case 3:
      case 4:
      case 5:
      case 10:
        out[opt.name] = opt.value;
        break;
      case 6:
        out[opt.name] = interaction.options.getUser(opt.name);
        break;
      case 7:
        out[opt.name] = interaction.options.getChannel(opt.name);
        break;
      case 8:
        out[opt.name] = interaction.options.getRole(opt.name);
        break;
      case 11:
        out[opt.name] = interaction.options.getAttachment(opt.name);
        break;
      default:
        out[opt.name] = opt.value;
    }
  }
  return out;
}

function wrap(payload, color) {
  if (payload && typeof payload === 'object') return toPayload(payload, color);
  return toPayload(embed({ description: String(payload ?? ''), color }), color);
}

function blocked(cmd, member, guild) {
  if (cmd.require && !requireStaff(member, cmd.require)) {
    return `You need ${cmd.require} level permissions for this.`;
  }
  if (cmd.perms?.length) {
    const missingUser = cmd.perms.filter((p) => !member.permissions.has(PermissionsBitField.Flags[p]));
    if (missingUser.length) return `You are missing: ${missingUser.join(', ')}`;
  }
  if (cmd.perms?.length) {
    const me = guild.members.me;
    const missingBot = cmd.perms.filter((p) => !me.permissions.has(PermissionsBitField.Flags[p]));
    if (missingBot.length) return `I am missing: ${missingBot.join(', ')}`;
  }
  return null;
}

export async function execute(cmd, { client, guild, channel, member, args, interaction, message }) {
  const slash = !!interaction;

  const reply = (payload) => {
    const body = wrap(payload, COLOR.info);
    if (slash) {
      if (interaction.deferred && !interaction.replied) return interaction.editReply(body);
      if (interaction.replied) return interaction.followUp(body);
      return interaction.reply(body);
    }
    return message.reply(body);
  };

  const ctx = {
    client,
    guild,
    channel,
    member,
    user: member.user,
    interaction,
    message,
    args,
    source: slash ? 'slash' : 'prefix',
    cfg: guildCfg(guild.id),
    ok: (payload) => reply(wrap(payload, COLOR.ok)),
    err: (payload) => reply(wrap(payload, COLOR.err)),
    send: (payload) => send(channel, payload),
  };

  const bad = blocked(cmd, member, guild);
  if (bad) return ctx.err(bad);

  try {
    await cmd.run(ctx);
  } catch (err) {
    console.error(`[cmd:${cmd.name}]`, err);
    return ctx.err(`error: ${errorText(err)}`);
  }
}

export async function runSlash(interaction) {
  const found = BY_NAME.get(interaction.commandName);
  if (!found) return interaction.reply(toPayload({ content: 'Unknown command. Try /help.', flags: 64 }));

  const raw = readSlash(interaction);
  const { args, error } = await coerce(interaction.guild, found, raw, interaction.client);
  if (error) return interaction.reply(toPayload({ content: `bad arguments: ${error}`, flags: 64 }));

  return execute(found, {
    client: interaction.client,
    guild: interaction.guild,
    channel: interaction.channel,
    member: interaction.member,
    args,
    interaction,
  });
}

export async function runPrefix(message, cmd, rest) {
  const { args, error } = readPrefixArgs(cmd, rest);
  if (error) return message.reply(toPayload(`bad arguments: ${error}`));
  const coerced = await coerce(message.guild, cmd, args, message.client);
  if (coerced.error) return message.reply(toPayload(`bad arguments: ${coerced.error}`));

  return execute(cmd, {
    client: message.client,
    guild: message.guild,
    channel: message.channel,
    member: message.member,
    args: coerced.args,
    message,
  });
}

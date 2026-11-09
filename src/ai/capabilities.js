import { AuditLogEvent, ChannelType, PermissionFlagsBits } from 'discord.js';
import { config } from '../config.js';
import { COMMANDS } from '../commands/index.js';
import { guildCfg, saveGuild } from '../lib/db.js';
import { COLOR, embed } from '../lib/render.js';
import { send, textOf } from '../lib/cv2.js';
import { resolveChannel, resolveMember, resolveRole, resolveUser } from '../lib/resolvers.js';
import { clamp, parseDuration, truncate } from '../lib/util.js';
import { RES } from './resources/index.js';

export const CATALOG = new Map();

function parseSpec(spec) {
  const required = spec.endsWith('!');
  const core = required ? spec.slice(0, -1) : spec;
  if (core.startsWith('enum:')) return { t: 'enum', req: required, values: core.slice(5).split('|') };
  return { t: core, req: required };
}

function add(name, def) {
  if (CATALOG.has(name)) throw new Error(`duplicate capability ${name}`);
  const params = {};
  for (const [key, value] of Object.entries(def.params || {})) {
    params[key] = typeof value === 'string' ? parseSpec(value) : value;
  }
  CATALOG.set(name, {
    name,
    desc: def.desc,
    params,
    danger: def.danger || 'low',
    group: def.group || 'general',
    perm: def.perm || null,
    run: def.run,
  });
}

// ---------------------------------------------------------------- base verbs

for (const [resource, def] of Object.entries(RES)) {
  for (const [verb, spec] of Object.entries(def.verbs)) {
    add(`${resource}.${verb}`, {
      desc: spec.d,
      params: spec.p,
      danger: spec.danger,
      perm: def.perm,
      group: resource,
      run: spec.run,
    });
  }
}

// ---------------------------------------------------------- permission fans

const CHANNEL_PERMS = [
  'ViewChannel',
  'SendMessages',
  'SendMessagesInThreads',
  'CreatePublicThreads',
  'CreatePrivateThreads',
  'EmbedLinks',
  'AttachFiles',
  'ReadMessageHistory',
  'MentionEveryone',
  'UseExternalEmojis',
  'UseExternalStickers',
  'AddReactions',
  'ManageMessages',
  'ManageChannels',
  'ManageWebhooks',
  'ManageThreads',
  'UseApplicationCommands',
  'Connect',
  'Speak',
  'Stream',
  'UseVAD',
  'PrioritySpeaker',
  'MuteMembers',
  'DeafenMembers',
  'MoveMembers',
  'RequestToSpeak',
  'ManageEvents',
  'SendPolls',
].filter((p) => PermissionFlagsBits[p] !== undefined);

const ROLE_PERMS = [
  'Administrator',
  'ManageGuild',
  'ManageRoles',
  'ManageChannels',
  'ManageMessages',
  'ManageNicknames',
  'ManageWebhooks',
  'ManageEmojisAndStickers',
  'ManageEvents',
  'ManageThreads',
  'KickMembers',
  'BanMembers',
  'ModerateMembers',
  'ViewAuditLog',
  'ViewGuildInsights',
  'MentionEveryone',
  'CreateInstantInvite',
  'ChangeNickname',
  'SendMessages',
  'ReadMessageHistory',
  'AddReactions',
  'Connect',
  'Speak',
  'PrioritySpeaker',
].filter((p) => PermissionFlagsBits[p] !== undefined);

function overwriteValue(op) {
  if (op === 'allow') return true;
  if (op === 'deny') return false;
  return null;
}

function permOverwrite(perm, op, targetType) {
  return async (guild, p) => {
    const channel = p.channel;
    let target = guild.roles.everyone;

    if (targetType === 'role') target = p.role;
    if (targetType === 'member') target = p.member;
    if (!targetType && p.target) {
      target =
        guild.roles.cache.get(p.target) ||
        guild.roles.cache.find((r) => r.name.toLowerCase() === String(p.target).toLowerCase()) ||
        guild.members.cache.get(p.target) ||
        guild.members.cache.find(
          (m) => m.user.username.toLowerCase() === String(p.target).replace(/^@/, '').toLowerCase(),
        );
      if (!target) throw new Error(`target not found: ${p.target}`);
    }

    await channel.permissionOverwrites.edit(target, { [perm]: overwriteValue(op) });
    const who = target.name || target.user?.tag || target.id;
    return `${op} ${perm} for ${who} on #${channel.name}`;
  };
}

for (const perm of CHANNEL_PERMS) {
  for (const op of ['allow', 'deny', 'reset']) {
    add(`channel.${op}.${perm}`, {
      desc: `${op} ${perm} for a role/member in a channel`,
      params: { channel: 'channel!', target: 'string' },
      perm: 'ManageChannels',
      group: 'channel permissions',
      danger: op === 'deny' ? 'low' : 'low',
      run: permOverwrite(perm, op, null),
    });
  }

  add(`channel.allowRole.${perm}`, {
    desc: `allow ${perm} for a role`,
    params: { channel: 'channel!', role: 'role!' },
    perm: 'ManageChannels',
    group: 'channel permissions',
    run: permOverwrite(perm, 'allow', 'role'),
  });
  add(`channel.denyRole.${perm}`, {
    desc: `deny ${perm} for a role`,
    params: { channel: 'channel!', role: 'role!' },
    perm: 'ManageChannels',
    group: 'channel permissions',
    run: permOverwrite(perm, 'deny', 'role'),
  });
  add(`channel.allowMember.${perm}`, {
    desc: `allow ${perm} for one member`,
    params: { channel: 'channel!', member: 'member!' },
    perm: 'ManageChannels',
    group: 'channel permissions',
    run: permOverwrite(perm, 'allow', 'member'),
  });
  add(`channel.denyMember.${perm}`, {
    desc: `deny ${perm} for one member`,
    params: { channel: 'channel!', member: 'member!' },
    perm: 'ManageChannels',
    group: 'channel permissions',
    run: permOverwrite(perm, 'deny', 'member'),
  });
}

for (const perm of ROLE_PERMS) {
  for (const op of ['grant', 'revoke']) {
    add(`role.${op}.${perm}`, {
      desc: `${op} ${perm} on a role`,
      params: { role: 'role!' },
      perm: 'ManageRoles',
      group: 'role permissions',
      danger: op === 'grant' && perm === 'Administrator' ? 'high' : 'low',
      run: async (guild, p) => {
        const role = p.role;
        await role.setPermissions(
          op === 'grant' ? role.permissions.add(perm) : role.permissions.remove(perm),
        );
        return `${perm} ${op}ed on ${role.name}`;
      },
    });
  }
}

// ------------------------------------------------------------- command mirror

const MIRROR_DANGER = new Set([
  'massdm',
  'massrole',
  'nuke',
  'lockdown',
  'unbanall',
  'purge',
  'purgeuser',
  'purgebots',
  'purgeembeds',
  'clearpins',
  'rolerestore',
  'emojiremove',
]);

function mirror(command) {
  return async (guild, p, ctx) => {
    const out = [];
    const collect = (payload) => {
      const text = textOf(payload);
      if (text) out.push(text);
      return Promise.resolve();
    };

    const fake = {
      client: ctx.client,
      guild,
      channel: ctx.channel,
      member: ctx.actor,
      user: ctx.actor.user,
      interaction: null,
      message: null,
      source: 'agent',
      args: p,
      cfg: guildCfg(guild.id),
      ok: collect,
      err: collect,
      send: collect,
    };

    await command.run(fake);
    return out.join('\n') || 'done';
  };
}

for (const command of COMMANDS) {
  const params = {};
  for (const opt of command.options || []) {
    if (opt.choices) params[opt.name] = `enum:${opt.choices.map((c) => c.value).join('|')}${opt.required ? '!' : ''}`;
    else if (['user', 'member', 'role', 'channel', 'int', 'num', 'bool'].includes(opt.type)) {
      params[opt.name] = `${opt.type}${opt.required ? '!' : ''}`;
    } else {
      params[opt.name] = `string${opt.required ? '!' : ''}`;
    }
  }

  add(`cmd.${command.name}`, {
    desc: command.desc,
    params,
    danger: MIRROR_DANGER.has(command.name) ? 'high' : 'low',
    perm: command.perms?.[0] || null,
    group: 'commands',
    run: mirror(command),
  });
}

// -------------------------------------------------------------- audit fan out

const AUDIT_TYPES = {
  ban: 'MemberBanAdd',
  unban: 'MemberBanRemove',
  kick: 'MemberKick',
  prune: 'MemberPrune',
  memberUpdate: 'MemberUpdate',
  roleUpdate: 'MemberRoleUpdate',
  roleCreate: 'RoleCreate',
  roleDelete: 'RoleDelete',
  channelCreate: 'ChannelCreate',
  channelDelete: 'ChannelDelete',
  channelUpdate: 'ChannelUpdate',
  overwriteUpdate: 'ChannelOverwriteUpdate',
  messageDelete: 'MessageDelete',
  messageBulkDelete: 'MessageBulkDelete',
  messagePin: 'MessagePin',
  inviteCreate: 'InviteCreate',
  inviteDelete: 'InviteDelete',
  webhookCreate: 'WebhookCreate',
  webhookDelete: 'WebhookDelete',
  emojiCreate: 'EmojiCreate',
  emojiDelete: 'EmojiDelete',
  botAdd: 'BotAdd',
  threadCreate: 'ThreadCreate',
  threadDelete: 'ThreadDelete',
  commandUpdate: 'ApplicationCommandPermissionUpdate',
};

for (const [label, key] of Object.entries(AUDIT_TYPES)) {
  add(`audit.${label}`, {
    desc: `audit log entries of type ${label}`,
    params: { limit: 'int' },
    perm: 'ViewAuditLog',
    group: 'audit',
    run: async (guild, p) => {
      const type = AuditLogEvent[key];
      if (type === undefined) return 'this discord.js build does not expose that audit event';
      const logs = await guild.fetchAuditLogs({ limit: clamp(p.limit || 10, 1, 50), type });
      return (
        [...logs.entries.values()]
          .map((e) => `${e.executor?.tag || '?'} -> ${e.target?.tag || e.target?.name || e.target?.id || '—'} at ${e.createdAt.toISOString()}`)
          .join('\n') || 'nothing in the audit log'
      );
    },
  });
}

// ----------------------------------------------------------- channel presets

const CHANNEL_TEMPLATES = {
  general: { topic: 'talk about anything' },
  rules: { topic: 'read this before posting' },
  announcements: { topic: 'server news and updates' },
  welcome: { topic: 'say hello' },
  introductions: { topic: 'tell us a bit about yourself' },
  support: { topic: 'need help? open a ticket' },
  tickets: { topic: 'support tickets' },
  logs: { topic: 'moderation and audit logs' },
  modlog: { topic: 'moderation actions' },
  media: { topic: 'screenshots, clips, art' },
  memes: { topic: 'post memes' },
  offTopic: { name: 'off-topic', topic: 'anything goes' },
  lounge: { kind: 'voice' },
  staff: { topic: 'staff only' },
  bots: { topic: 'bot commands' },
  suggestions: { topic: 'suggestions and feedback' },
  events: { topic: 'event planning' },
  showcase: { topic: 'show off your work' },
  archive: { topic: 'old stuff' },
  counting: { topic: 'count in order' },
};

for (const [name, preset] of Object.entries(CHANNEL_TEMPLATES)) {
  add(`channel.template.${name}`, {
    desc: `create a ${name} channel with sensible defaults`,
    params: { category: 'channel' },
    perm: 'ManageChannels',
    group: 'channel templates',
    run: async (guild, p) => {
      const parent = p.category || null;
      const channel = await guild.channels.create({
        name: preset.name || name,
        type: preset.kind === 'voice' ? ChannelType.GuildVoice : ChannelType.GuildText,
        topic: preset.topic,
        parent: parent?.id,
        reason: 'wellix template',
      });
      return `created #${channel.name} (${channel.id})`;
    },
  });
}

// -------------------------------------------------------------- role presets

const ROLE_TEMPLATES = {
  admin: { color: 0xe74c3c, permissions: ['Administrator'] },
  moderator: { color: 0x3498db, permissions: ['ManageMessages', 'ModerateMembers', 'KickMembers'] },
  helper: { color: 0x2ecc71, permissions: ['ManageMessages'] },
  member: { color: 0x95a5a6, permissions: [] },
  muted: { color: 0x7f8c8d, permissions: [] },
  bot: { color: 0x9b59b6, permissions: [] },
  dj: { color: 0x1abc9c, permissions: ['PrioritySpeaker', 'MuteMembers'] },
  vip: { color: 0xf1c40f, permissions: [] },
  booster: { color: 0xff73fa, permissions: [] },
  guest: { color: 0xbdc3c7, permissions: [] },
  staff: { color: 0x34495e, permissions: ['ManageMessages', 'ManageThreads'] },
  tester: { color: 0xe67e22, permissions: [] },
  events: { color: 0xe91e63, permissions: ['ManageEvents'] },
  media: { color: 0x00bcd4, permissions: ['AttachFiles', 'EmbedLinks'] },
  partner: { color: 0x7289da, permissions: [] },
  verified: { color: 0x57f287, permissions: [] },
  unverified: { color: 0x99aab5, permissions: [] },
  newcomer: { color: 0x5865f2, permissions: [] },
  artist: { color: 0xffa500, permissions: [] },
  gamer: { color: 0x00ff7f, permissions: [] },
};

for (const [name, preset] of Object.entries(ROLE_TEMPLATES)) {
  add(`role.template.${name}`, {
    desc: `create a standard ${name} role`,
    params: {},
    perm: 'ManageRoles',
    group: 'role templates',
    danger: name === 'admin' ? 'high' : 'low',
    run: async (guild) => {
      const role = await guild.roles.create({
        name,
        color: preset.color,
        permissions: preset.permissions,
        reason: 'wellix template',
      });
      return `created ${role.name} (${role.id})`;
    },
  });
}

// ------------------------------------------------------------- server presets

const SERVER_PRESETS = {
  community: { channels: ['rules', 'announcements', 'general', 'introductions', 'off-topic'], roles: ['moderator', 'member'] },
  gaming: { channels: ['rules', 'announcements', 'general', 'lfg', 'clips'], roles: ['moderator', 'gamer'] },
  dev: { channels: ['rules', 'announcements', 'general', 'help', 'showcase', 'off-topic'], roles: ['moderator', 'tester'] },
  support: { channels: ['rules', 'announcements', 'general', 'support', 'tickets'], roles: ['helper', 'member'] },
  study: { channels: ['rules', 'announcements', 'general', 'resources', 'homework'], roles: ['moderator', 'member'] },
  music: { channels: ['rules', 'announcements', 'general', 'music', 'lounge'], roles: ['dj', 'member'] },
  art: { channels: ['rules', 'announcements', 'general', 'media', 'showcase'], roles: ['artist', 'member'] },
  roleplay: { channels: ['rules', 'announcements', 'ooc', 'roleplay', 'character-sheets'], roles: ['moderator', 'member'] },
  business: { channels: ['rules', 'announcements', 'general', 'clients', 'staff'], roles: ['staff', 'member'] },
  minimal: { channels: ['general', 'off-topic'], roles: ['member'] },
};

for (const [name, preset] of Object.entries(SERVER_PRESETS)) {
  add(`server.bootstrap.${name}`, {
    desc: `build a ${name} server skeleton (category, channels, roles)`,
    params: {},
    perm: 'ManageGuild',
    group: 'server presets',
    danger: 'high',
    run: async (guild) => {
      const category = await guild.channels.create({ name, type: ChannelType.GuildCategory });
      const created = [];
      for (const channelName of preset.channels) {
        const channel = await guild.channels.create({
          name: channelName,
          type: ChannelType.GuildText,
          parent: category.id,
        });
        created.push(channel.name);
      }
      for (const roleName of preset.roles) {
        if (guild.roles.cache.some((r) => r.name === roleName)) continue;
        await guild.roles.create({ name: roleName }).then(() => created.push(roleName)).catch(() => {});
      }
      return `created category ${category.name}: ${created.join(', ')}`;
    },
  });
}

// --------------------------------------------------------------- ticket panels

const TICKET_PANELS = {
  support: { title: 'support tickets', description: 'Open a ticket if you need help from staff.' },
  report: { title: 'report a user', description: 'Open a ticket to report rule breaking.' },
  appeal: { title: 'ban appeals', description: 'Open a ticket to appeal a punishment.' },
  purchase: { title: 'purchases', description: 'Open a ticket to buy something.' },
  bug: { title: 'bug reports', description: 'Open a ticket and describe the bug.' },
};

for (const [name, panel] of Object.entries(TICKET_PANELS)) {
  add(`ticket.panel.${name}`, {
    desc: `post the ${name} ticket panel`,
    params: { channel: 'channel!' },
    perm: 'ManageChannels',
    group: 'ticket panels',
    run: async (guild, p) => {
      const { sendPanel } = await import('../features/tickets.js');
      await sendPanel(p.channel, panel);
      return `panel posted in #${p.channel.name}`;
    },
  });
}

// ------------------------------------------------------------- automod presets

const AUTOMOD_PRESETS = {
  strict: { antispam: true, antilink: true, antiinvite: true, warnThreshold: 2 },
  relaxed: { antispam: true, antilink: false, antiinvite: true, warnThreshold: 5 },
  raid: { antispam: true, antilink: true, antiinvite: true, warnThreshold: 1 },
  family: { antispam: true, antilink: true, antiinvite: true, warnThreshold: 3 },
  gaming: { antispam: true, antilink: false, antiinvite: true, warnThreshold: 4 },
  support: { antispam: true, antilink: false, antiinvite: true, warnThreshold: 3 },
  school: { antispam: true, antilink: true, antiinvite: true, warnThreshold: 2 },
  off: { antispam: false, antilink: false, antiinvite: false, warnThreshold: 0 },
};

for (const [name, preset] of Object.entries(AUTOMOD_PRESETS)) {
  add(`automod.preset.${name}`, {
    desc: `apply the ${name} automod preset`,
    params: {},
    perm: 'ManageGuild',
    group: 'automod presets',
    run: async (guild) => {
      const cfg = guildCfg(guild.id);
      Object.assign(cfg.automod, preset);
      saveGuild(guild.id, cfg);
      return `automod preset ${name} applied`;
    },
  });
}

// ------------------------------------------------------------ welcome presets

const WELCOME_TEMPLATES = {
  classic: 'Welcome to **{server}**, {user}! You are member #{count}.',
  cozy: 'hey {user}, good to have you here. make yourself at home in **{server}**.',
  bold: '**{user}** just joined. member #{count}. say hi.',
  minimal: '{user} joined.',
  gamer: '{user} joined the lobby. member #{count}.',
  staff: '{user} joined, staff will be with you shortly.',
  community: 'Welcome {user}! Check the rules and introduce yourself.',
  event: '{user} arrived just in time for the event. #{count}.',
  cute: 'nya~ {user} is here! welcome to {server} ♡',
  formal: '{user} has joined {server}. Welcome, member number {count}.',
};

for (const [name, message] of Object.entries(WELCOME_TEMPLATES)) {
  add(`welcome.template.${name}`, {
    desc: `use the ${name} welcome message`,
    params: { channel: 'channel!' },
    perm: 'ManageGuild',
    group: 'welcome templates',
    run: async (guild, p) => {
      const cfg = guildCfg(guild.id);
      cfg.welcome.channel = p.channel.id;
      cfg.welcome.message = message;
      cfg.welcome.enabled = true;
      saveGuild(guild.id, cfg);
      return `welcome template ${name} active in #${p.channel.name}`;
    },
  });
}

// -------------------------------------------------------------- embed presets

const EMBED_TEMPLATES = {
  announcement: { title: 'announcement', body: 'Write your announcement here.' },
  rules: { title: 'server rules', body: '1. be decent\n2. no spam\n3. listen to staff' },
  faq: { title: 'faq', body: 'Add the common questions here.' },
  event: { title: 'event', body: 'When: \nWhere: \nWhat: ' },
  update: { title: 'update', body: 'What changed:' },
  support: { title: 'need help?', body: 'Open a ticket and staff will help you.' },
  welcome: { title: 'welcome', body: 'Read the rules and say hi.' },
  farewell: { title: 'goodbye', body: 'See you around.' },
  poll: { title: 'poll', body: 'React below to vote.' },
  info: { title: 'info', body: 'Useful information goes here.' },
};

for (const [name, preset] of Object.entries(EMBED_TEMPLATES)) {
  add(`embed.template.${name}`, {
    desc: `post the ${name} embed with placeholder copy`,
    params: { channel: 'channel!' },
    perm: 'ManageMessages',
    group: 'embed templates',
    run: async (guild, p) => {
      await send(p.channel, { embeds: [embed({ title: preset.title, description: preset.body, color: COLOR.info })] });
      return `posted ${name} embed in #${p.channel.name}`;
    },
  });
}

// ------------------------------------------------------------ timeout presets

const TIMEOUTS = { '5m': 300000, '10m': 600000, '1h': 3600000, '6h': 21600000, '1d': 86400000, '3d': 259200000, '1w': 604800000, '4w': 2419200000 };

for (const [label, ms] of Object.entries(TIMEOUTS)) {
  add(`member.timeout.${label}`, {
    desc: `timeout a member for ${label}`,
    params: { member: 'member!' },
    perm: 'ModerateMembers',
    group: 'quick moderation',
    run: async (guild, p, ctx) => {
      if (!p.member.moderatable) throw new Error('member is above me');
      await p.member.timeout(ms, `agent timeout ${label}`);
      const { addCase } = await import('../lib/moderation.js');
      await addCase(guild, {
        type: 'timeout',
        targetId: p.member.id,
        targetTag: p.member.user.tag,
        moderatorId: ctx.actor.id,
        reason: `quick timeout ${label}`,
        duration: label,
      });
      return `${p.member.user.tag} timed out for ${label}`;
    },
  });
}

// -------------------------------------------------------------- purge presets

const PURGE_MODES = ['all', 'bots', 'humans', 'embeds', 'files', 'links', 'invites', 'mentions'];

for (const mode of PURGE_MODES) {
  add(`message.purge.${mode}`, {
    desc: `bulk delete, ${mode} only`,
    params: { channel: 'channel!', amount: 'int' },
    perm: 'ManageMessages',
    group: 'bulk delete',
    danger: 'high',
    run: async (guild, p) => {
      const limit = clamp(p.amount || 50, 1, 100);
      let list = [...(await p.channel.messages.fetch({ limit: 100 })).values()];

      if (mode === 'bots') list = list.filter((m) => m.author.bot);
      if (mode === 'humans') list = list.filter((m) => !m.author.bot);
      if (mode === 'embeds') list = list.filter((m) => m.embeds.length);
      if (mode === 'files') list = list.filter((m) => m.attachments.size);
      if (mode === 'links') list = list.filter((m) => /https?:\/\//i.test(m.content));
      if (mode === 'invites') list = list.filter((m) => /discord\.(gg|com\/invite)\//i.test(m.content));
      if (mode === 'mentions') list = list.filter((m) => m.mentions.users.size || m.mentions.roles.size);

      list = list.slice(0, limit);
      if (!list.length) return 'nothing matched';
      const deleted = await p.channel.bulkDelete(list, true);
      return `deleted ${deleted.size} ${mode} messages in #${p.channel.name}`;
    },
  });
}

// ------------------------------------------------------------------ bulk ops

async function eachChild(category, fn) {
  let n = 0;
  for (const child of category.children.cache.values()) {
    if (await fn(child).then(() => true).catch(() => false)) n++;
  }
  return n;
}

add('bulk.channels.lock', {
  desc: 'lock every channel inside a category',
  params: { category: 'channel!' },
  perm: 'ManageChannels',
  group: 'bulk operations',
  run: async (guild, p) =>
    `${await eachChild(p.category, (c) => c.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: false }))} channels locked`,
});

add('bulk.channels.unlock', {
  desc: 'unlock every channel inside a category',
  params: { category: 'channel!' },
  perm: 'ManageChannels',
  group: 'bulk operations',
  run: async (guild, p) =>
    `${await eachChild(p.category, (c) => c.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: true }))} channels unlocked`,
});

add('bulk.channels.delete', {
  desc: 'delete every channel inside a category',
  params: { category: 'channel!' },
  perm: 'ManageChannels',
  group: 'bulk operations',
  danger: 'high',
  run: async (guild, p) => `${await eachChild(p.category, (c) => c.delete())} channels deleted`,
});

add('bulk.channels.rename', {
  desc: 'prefix every channel name in a category',
  params: { category: 'channel!', prefix: 'string!' },
  perm: 'ManageChannels',
  group: 'bulk operations',
  run: async (guild, p) =>
    `${await eachChild(p.category, (c) => c.setName(`${p.prefix}${c.name}`))} channels renamed`,
});

add('bulk.threads.archive', {
  desc: 'archive every active thread',
  params: {},
  perm: 'ManageThreads',
  group: 'bulk operations',
  run: async (guild) => {
    let n = 0;
    for (const channel of guild.channels.cache.filter((c) => c.isThread()).values()) {
      if (await channel.setArchived(true).then(() => true).catch(() => false)) n++;
    }
    return `${n} threads archived`;
  },
});

add('bulk.threads.delete', {
  desc: 'delete every active thread',
  params: {},
  perm: 'ManageThreads',
  group: 'bulk operations',
  danger: 'high',
  run: async (guild) => {
    let n = 0;
    for (const channel of guild.channels.cache.filter((c) => c.isThread()).values()) {
      if (await channel.delete().then(() => true).catch(() => false)) n++;
    }
    return `${n} threads deleted`;
  },
});

add('bulk.roles.giveToAll', {
  desc: 'give a role to every human member',
  params: { role: 'role!' },
  perm: 'ManageRoles',
  group: 'bulk operations',
  run: async (guild, p) => {
    const members = await guild.members.fetch();
    let n = 0;
    for (const member of members.filter((m) => !m.user.bot).values()) {
      if (await member.roles.add(p.role).then(() => true).catch(() => false)) n++;
    }
    return `${p.role.name} given to ${n} members`;
  },
});

add('bulk.roles.removeFromAll', {
  desc: 'remove a role from every member',
  params: { role: 'role!' },
  perm: 'ManageRoles',
  group: 'bulk operations',
  run: async (guild, p) => {
    const members = await guild.members.fetch();
    let n = 0;
    for (const member of members.values()) {
      if (await member.roles.remove(p.role).then(() => true).catch(() => false)) n++;
    }
    return `${p.role.name} removed from ${n} members`;
  },
});

add('bulk.members.kick', {
  desc: 'kick every member holding a role',
  params: { role: 'role!' },
  perm: 'KickMembers',
  group: 'bulk operations',
  danger: 'high',
  run: async (guild, p) => {
    let n = 0;
    for (const member of p.role.members.values()) {
      if (await member.kick('bulk kick').then(() => true).catch(() => false)) n++;
    }
    return `${n} members kicked`;
  },
});

add('bulk.members.ban', {
  desc: 'ban every member holding a role',
  params: { role: 'role!', reason: 'string' },
  perm: 'BanMembers',
  group: 'bulk operations',
  danger: 'high',
  run: async (guild, p) => {
    let n = 0;
    for (const member of p.role.members.values()) {
      if (await guild.bans.create(member.id, { reason: p.reason || 'bulk ban' }).then(() => true).catch(() => false)) n++;
    }
    return `${n} members banned`;
  },
});

add('bulk.messages.purge', {
  desc: 'delete the last 100 messages in a channel',
  params: { channel: 'channel!' },
  perm: 'ManageMessages',
  group: 'bulk operations',
  danger: 'high',
  run: async (guild, p) => {
    const messages = await p.channel.messages.fetch({ limit: 100 });
    const deleted = await p.channel.bulkDelete(messages, true);
    return `${deleted.size} messages deleted`;
  },
});

add('bulk.invites.revoke', {
  desc: 'delete every invite in the server',
  params: {},
  perm: 'ManageGuild',
  group: 'bulk operations',
  danger: 'high',
  run: async (guild) => {
    const invites = await guild.invites.fetch();
    let n = 0;
    for (const invite of invites.values()) {
      if (await invite.delete().then(() => true).catch(() => false)) n++;
    }
    return `${n} invites revoked`;
  },
});

// ------------------------------------------------------------------- reports

const REPORT_KINDS = ['server', 'roles', 'channels', 'members', 'bans', 'cases'];
const REPORT_FORMATS = ['text', 'json', 'csv'];

function reportRows(guild, kind) {
  if (kind === 'roles') return [...guild.roles.cache.values()].map((r) => ({ name: r.name, id: r.id, members: r.members.size, color: r.hexColor }));
  if (kind === 'channels') return [...guild.channels.cache.values()].map((c) => ({ name: c.name, id: c.id, type: c.type }));
  if (kind === 'members') return guild.members.cache.map((m) => ({ tag: m.user.tag, id: m.id, joined: m.joinedAt?.toISOString() || '' }));
  if (kind === 'cases') return require_cases(guild);
  return [{ name: guild.name, id: guild.id, members: guild.memberCount, owner: guild.ownerId }];
}

function require_cases(guild) {
  return guildCfg(guild.id).cases.map((c) => ({ id: c.id, type: c.type, target: c.targetId, reason: c.reason }));
}

async function reportData(guild, kind) {
  if (kind === 'bans') {
    const bans = await guild.bans.fetch();
    return [...bans.values()].map((b) => ({ tag: b.user.tag, id: b.user.id, reason: b.reason || '' }));
  }
  return reportRows(guild, kind);
}

for (const kind of REPORT_KINDS) {
  for (const format of REPORT_FORMATS) {
    add(`report.${kind}.${format}`, {
      desc: `${kind} report as ${format}`,
      params: {},
      group: 'reports',
      run: async (guild) => {
        const rows = await reportData(guild, kind);
        if (format === 'json') return truncate(JSON.stringify(rows), 6000);
        if (format === 'csv') {
          if (!rows.length) return 'empty';
          const keys = Object.keys(rows[0]);
          return truncate([keys.join(','), ...rows.map((r) => keys.map((k) => JSON.stringify(r[k] ?? '')).join(','))].join('\n'), 6000);
        }
        return truncate(rows.map((r) => Object.entries(r).map(([k, v]) => `${k}=${v}`).join(' | ')).join('\n'), 6000);
      },
    });
  }
}

// ------------------------------------------------------------------ execution

export const CAPABILITY_COUNT = CATALOG.size;

export function capabilityNames() {
  return [...CATALOG.keys()];
}

export function describeCapability(name) {
  const cap = CATALOG.get(name);
  if (!cap) return null;
  const params = Object.entries(cap.params).map(([key, schema]) => {
    const label = schema.t === 'enum' ? `enum(${schema.values.join('|')})` : schema.t;
    return `${key}:${label}${schema.req ? '!' : ''}`;
  });
  return `${cap.name} — ${cap.desc} — params: ${params.join(', ') || 'none'}${cap.danger === 'high' ? ' [destructive]' : ''}`;
}

export function searchCapabilities(query) {
  const q = String(query || '').toLowerCase();
  return [...CATALOG.values()]
    .filter((c) => c.name.toLowerCase().includes(q) || c.desc.toLowerCase().includes(q) || c.group.toLowerCase().includes(q))
    .slice(0, 40);
}

async function resolveParams(cap, guild, input, client) {
  const out = {};

  for (const [key, schema] of Object.entries(cap.params)) {
    let value = input[key];
    if (typeof value === 'string') value = value.trim();

    if (value === undefined || value === null || value === '') {
      if (schema.req) throw new Error(`${cap.name} needs "${key}" (${schema.t})`);
      continue;
    }

    switch (schema.t) {
      case 'member': {
        const member = value?.guildId === guild.id ? value : await resolveMember(guild, value);
        if (!member) throw new Error(`member not found: ${value}`);
        out[key] = member;
        break;
      }
      case 'user': {
        if (value?.id) {
          out[key] = value;
          break;
        }
        const member = await resolveMember(guild, value).catch(() => null);
        const user = member?.user || (await resolveUser(client, value));
        if (!user) throw new Error(`user not found: ${value}`);
        out[key] = user;
        break;
      }
      case 'role': {
        const role = await resolveRole(guild, value);
        if (!role) throw new Error(`role not found: ${value}`);
        out[key] = role;
        break;
      }
      case 'channel': {
        const channel = await resolveChannel(guild, value);
        if (!channel) throw new Error(`channel not found: ${value}`);
        out[key] = channel;
        break;
      }
      case 'int': {
        const n = parseInt(value, 10);
        if (Number.isNaN(n)) throw new Error(`${key} must be an integer`);
        out[key] = n;
        break;
      }
      case 'num': {
        const n = Number(value);
        if (Number.isNaN(n)) throw new Error(`${key} must be a number`);
        out[key] = n;
        break;
      }
      case 'bool':
        out[key] = /^(true|yes|on|1|y)$/i.test(String(value));
        break;
      case 'enum': {
        const v = String(value);
        if (!schema.values.includes(v)) throw new Error(`${key} must be one of: ${schema.values.join(', ')}`);
        out[key] = v;
        break;
      }
      case 'json': {
        if (typeof value === 'object') {
          out[key] = value;
          break;
        }
        try {
          out[key] = JSON.parse(value);
        } catch {
          throw new Error(`${key} is not valid json`);
        }
        break;
      }
      case 'duration':
        out[key] = parseDuration(value) > 0 ? value : value;
        break;
      default:
        out[key] = value;
    }
  }

  return out;
}

export async function runCapability(name, guild, params, ctx) {
  const cap = CATALOG.get(name);
  if (!cap) throw new Error(`unknown capability: ${name}`);
  if (cap.danger === 'high' && !config.allowDestructive) {
    throw new Error(`${name} is destructive and AI_ALLOW_DESTRUCTIVE is off`);
  }
  const flag = cap.perm ? PermissionFlagsBits[cap.perm] : null;
  if (flag !== null && flag !== undefined && !guild.members.me.permissions.has(flag)) {
    throw new Error(`missing bot permission ${cap.perm}`);
  }

  const resolved = await resolveParams(cap, guild, params || {}, ctx.client);
  const result = await cap.run(guild, resolved, ctx);
  return String(result ?? 'ok');
}

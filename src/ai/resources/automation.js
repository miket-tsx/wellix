import { guildCfg, saveGuild } from '../../lib/db.js';
import { casesOf, findCase, removeCases } from '../../lib/moderation.js';
import { cancel, jobsFor, schedule } from '../../lib/scheduler.js';
import { applyVars, COLOR, embed } from '../../lib/render.js';
import { send } from '../../lib/cv2.js';
import { clamp, fmtDuration, parseDuration, truncate } from '../../lib/util.js';
import { needChannel, needMember, needRole } from './_helpers.js';

function commit(guild, cfg) {
  saveGuild(guild.id, cfg);
}

export default {
  automod: {
    perm: 'ManageGuild',
    desc: 'automod filters',
    verbs: {
      enable: {
        d: 'Turn every automod filter on',
        p: {},
        run: async (guild) => {
          const cfg = guildCfg(guild.id);
          Object.assign(cfg.automod, { antispam: true, antilink: true, antiinvite: true });
          commit(guild, cfg);
          return 'automod on';
        },
      },
      disable: {
        d: 'Turn every automod filter off',
        p: {},
        run: async (guild) => {
          const cfg = guildCfg(guild.id);
          Object.assign(cfg.automod, { antispam: false, antilink: false, antiinvite: false });
          commit(guild, cfg);
          return 'automod off';
        },
      },
      setBadwords: {
        d: 'Replace the whole badword list',
        p: { words: 'string!' },
        run: async (guild, p) => {
          const cfg = guildCfg(guild.id);
          cfg.automod.badwords = String(p.words).split(',').map((w) => w.trim().toLowerCase()).filter(Boolean);
          commit(guild, cfg);
          return `${cfg.automod.badwords.length} badwords saved`;
        },
      },
      addBadword: {
        d: 'Block one more word',
        p: { word: 'string!' },
        run: async (guild, p) => {
          const cfg = guildCfg(guild.id);
          const word = p.word.toLowerCase();
          if (!cfg.automod.badwords.includes(word)) cfg.automod.badwords.push(word);
          commit(guild, cfg);
          return `blocked ${word}`;
        },
      },
      removeBadword: {
        d: 'Unblock a word',
        p: { word: 'string!' },
        run: async (guild, p) => {
          const cfg = guildCfg(guild.id);
          cfg.automod.badwords = cfg.automod.badwords.filter((w) => w !== p.word.toLowerCase());
          commit(guild, cfg);
          return `unblocked ${p.word}`;
        },
      },
      setAntilink: {
        d: 'Toggle link filtering',
        p: { enabled: 'bool!' },
        run: async (guild, p) => {
          const cfg = guildCfg(guild.id);
          cfg.automod.antilink = p.enabled;
          commit(guild, cfg);
          return `antilink=${p.enabled}`;
        },
      },
      setAntispam: {
        d: 'Toggle spam filtering',
        p: { enabled: 'bool!' },
        run: async (guild, p) => {
          const cfg = guildCfg(guild.id);
          cfg.automod.antispam = p.enabled;
          commit(guild, cfg);
          return `antispam=${p.enabled}`;
        },
      },
      setWarnThreshold: {
        d: 'Warnings before an automatic timeout',
        p: { threshold: 'int!' },
        run: async (guild, p) => {
          const cfg = guildCfg(guild.id);
          cfg.automod.warnThreshold = clamp(p.threshold, 0, 20);
          commit(guild, cfg);
          return `threshold ${cfg.automod.warnThreshold}`;
        },
      },
      status: {
        d: 'Show automod config',
        p: {},
        run: async (guild) => {
          const am = guildCfg(guild.id).automod;
          return `antispam=${am.antispam} antilink=${am.antilink} antiinvite=${am.antiinvite} badwords=${am.badwords.length} threshold=${am.warnThreshold}`;
        },
      },
    },
  },

  welcome: {
    perm: 'ManageGuild',
    desc: 'welcome messages',
    verbs: {
      set: {
        d: 'Set the welcome channel and message',
        p: { channel: 'channel!', message: 'string' },
        run: async (guild, p) => {
          const channel = await needChannel(guild, p.channel);
          const cfg = guildCfg(guild.id);
          cfg.welcome.channel = channel.id;
          if (p.message) cfg.welcome.message = p.message;
          cfg.welcome.enabled = true;
          commit(guild, cfg);
          return `welcome on in #${channel.name}`;
        },
      },
      setChannel: {
        d: 'Change only the welcome channel',
        p: { channel: 'channel!' },
        run: async (guild, p) => {
          const channel = await needChannel(guild, p.channel);
          const cfg = guildCfg(guild.id);
          cfg.welcome.channel = channel.id;
          cfg.welcome.enabled = true;
          commit(guild, cfg);
          return `welcome channel #${channel.name}`;
        },
      },
      setMessage: {
        d: 'Change the welcome text',
        p: { message: 'string!' },
        run: async (guild, p) => {
          const cfg = guildCfg(guild.id);
          cfg.welcome.message = p.message;
          commit(guild, cfg);
          return 'welcome text saved';
        },
      },
      setEmbed: {
        d: 'Render welcome as an embed',
        p: { enabled: 'bool!' },
        run: async (guild, p) => {
          const cfg = guildCfg(guild.id);
          cfg.welcome.embed = p.enabled;
          commit(guild, cfg);
          return `welcome embed=${p.enabled}`;
        },
      },
      setDm: {
        d: 'DM new members, empty text disables',
        p: { message: 'string' },
        run: async (guild, p) => {
          const cfg = guildCfg(guild.id);
          cfg.welcome.dm = p.message || null;
          commit(guild, cfg);
          return p.message ? 'dm message saved' : 'dm disabled';
        },
      },
      disable: {
        d: 'Stop sending welcomes',
        p: {},
        run: async (guild) => {
          const cfg = guildCfg(guild.id);
          cfg.welcome.enabled = false;
          commit(guild, cfg);
          return 'welcome off';
        },
      },
      test: {
        d: 'Send a welcome preview',
        p: {},
        run: async (guild, p, ctx) => {
          const cfg = guildCfg(guild.id);
          if (!cfg.welcome.channel) throw new Error('no welcome channel set');
          const channel = guild.channels.cache.get(cfg.welcome.channel);
          if (!channel) throw new Error('welcome channel is gone');
          const text = truncate(applyVars(cfg.welcome.message, { user: ctx.actor.user, guild, count: guild.memberCount }), 2000);
          await send(channel, { content: text });
          return `preview sent to #${channel.name}`;
        },
      },
      status: {
        d: 'Show welcome config',
        p: {},
        run: async (guild) => {
          const w = guildCfg(guild.id).welcome;
          return `enabled=${w.enabled} channel=${w.channel || '—'} embed=${w.embed} message=${w.message}`;
        },
      },
    },
  },

  goodbye: {
    perm: 'ManageGuild',
    desc: 'leave messages',
    verbs: {
      set: {
        d: 'Set the goodbye channel and message',
        p: { channel: 'channel!', message: 'string' },
        run: async (guild, p) => {
          const channel = await needChannel(guild, p.channel);
          const cfg = guildCfg(guild.id);
          cfg.goodbye.channel = channel.id;
          if (p.message) cfg.goodbye.message = p.message;
          cfg.goodbye.enabled = true;
          commit(guild, cfg);
          return `goodbye on in #${channel.name}`;
        },
      },
      setChannel: {
        d: 'Change only the goodbye channel',
        p: { channel: 'channel!' },
        run: async (guild, p) => {
          const channel = await needChannel(guild, p.channel);
          const cfg = guildCfg(guild.id);
          cfg.goodbye.channel = channel.id;
          cfg.goodbye.enabled = true;
          commit(guild, cfg);
          return `goodbye channel #${channel.name}`;
        },
      },
      setMessage: {
        d: 'Change the goodbye text',
        p: { message: 'string!' },
        run: async (guild, p) => {
          const cfg = guildCfg(guild.id);
          cfg.goodbye.message = p.message;
          commit(guild, cfg);
          return 'goodbye text saved';
        },
      },
      disable: {
        d: 'Stop sending goodbyes',
        p: {},
        run: async (guild) => {
          const cfg = guildCfg(guild.id);
          cfg.goodbye.enabled = false;
          commit(guild, cfg);
          return 'goodbye off';
        },
      },
      test: {
        d: 'Send a goodbye preview',
        p: {},
        run: async (guild, p, ctx) => {
          const cfg = guildCfg(guild.id);
          const channel = guild.channels.cache.get(cfg.goodbye.channel);
          if (!channel) throw new Error('no goodbye channel set');
          await send(channel, { content: truncate(applyVars(cfg.goodbye.message, { user: ctx.actor.user, guild }), 2000) });
          return `preview sent to #${channel.name}`;
        },
      },
    },
  },

  autoresponder: {
    perm: 'ManageGuild',
    desc: 'auto replies',
    verbs: {
      add: {
        d: 'Add an auto reply',
        p: { trigger: 'string!', response: 'string!' },
        run: async (guild, p) => {
          const cfg = guildCfg(guild.id);
          cfg.autoresponders = cfg.autoresponders.filter((a) => a.trigger !== p.trigger.toLowerCase());
          cfg.autoresponders.push({ trigger: p.trigger.toLowerCase(), response: p.response });
          commit(guild, cfg);
          return `reply for ${p.trigger} saved`;
        },
      },
      remove: {
        d: 'Remove an auto reply',
        p: { trigger: 'string!' },
        run: async (guild, p) => {
          const cfg = guildCfg(guild.id);
          const before = cfg.autoresponders.length;
          cfg.autoresponders = cfg.autoresponders.filter((a) => a.trigger !== p.trigger.toLowerCase());
          commit(guild, cfg);
          return before === cfg.autoresponders.length ? 'nothing matched' : 'removed';
        },
      },
      list: {
        d: 'List auto replies',
        p: {},
        run: async (guild) =>
          guildCfg(guild.id).autoresponders.map((a) => `${a.trigger} -> ${truncate(a.response, 80)}`).join('\n') || 'none',
      },
      clear: {
        d: 'Delete every auto reply',
        p: {},
        run: async (guild) => {
          const cfg = guildCfg(guild.id);
          const n = cfg.autoresponders.length;
          cfg.autoresponders = [];
          commit(guild, cfg);
          return `cleared ${n}`;
        },
      },
    },
  },

  reactionrole: {
    perm: 'ManageRoles',
    desc: 'reaction roles',
    verbs: {
      add: {
        d: 'Bind an emoji on a message to a role',
        p: { channel: 'channel!', message_id: 'string!', emoji: 'string!', role: 'role!' },
        run: async (guild, p) => {
          const channel = await needChannel(guild, p.channel);
          const role = await needRole(guild, p.role);
          const message = await channel.messages.fetch(p.message_id).catch(() => null);
          if (!message) throw new Error('message not found');
          const cfg = guildCfg(guild.id);
          cfg.reactionRoles = cfg.reactionRoles.filter((r) => !(r.messageId === p.message_id && r.emoji === p.emoji));
          cfg.reactionRoles.push({ channelId: channel.id, messageId: message.id, emoji: p.emoji, roleId: role.id });
          commit(guild, cfg);
          await message.react(p.emoji).catch(() => {});
          return `${p.emoji} -> ${role.name}`;
        },
      },
      remove: {
        d: 'Unbind an emoji',
        p: { message_id: 'string!', emoji: 'string!' },
        run: async (guild, p) => {
          const cfg = guildCfg(guild.id);
          const before = cfg.reactionRoles.length;
          cfg.reactionRoles = cfg.reactionRoles.filter((r) => !(r.messageId === p.message_id && r.emoji === p.emoji));
          commit(guild, cfg);
          return before === cfg.reactionRoles.length ? 'no rule matched' : 'removed';
        },
      },
      list: {
        d: 'List reaction role rules',
        p: {},
        run: async (guild) =>
          guildCfg(guild.id).reactionRoles
            .map((r) => `msg=${r.messageId} ${r.emoji} -> <@&${r.roleId}>`)
            .join('\n') || 'none',
      },
      clear: {
        d: 'Remove every reaction role rule',
        p: {},
        run: async (guild) => {
          const cfg = guildCfg(guild.id);
          const n = cfg.reactionRoles.length;
          cfg.reactionRoles = [];
          commit(guild, cfg);
          return `cleared ${n}`;
        },
      },
    },
  },

  schedule: {
    perm: 'ManageGuild',
    desc: 'delayed actions',
    verbs: {
      remind: {
        d: 'Remind someone later',
        p: { in: 'duration!', text: 'string!', channel: 'channel' },
        run: async (guild, p, ctx) => {
          const channel = p.channel ? await needChannel(guild, p.channel) : ctx.channel;
          const ms = parseDuration(p.in);
          if (ms < 5000) throw new Error('give me at least 5 seconds');
          schedule({
            type: 'remind',
            guildId: guild.id,
            runAt: Date.now() + ms,
            data: { channelId: channel.id, userId: ctx.actor.id, text: p.text },
          });
          return `reminder in ${fmtDuration(ms)}`;
        },
      },
      message: {
        d: 'Send a message later',
        p: { in: 'duration!', channel: 'channel!', content: 'string!' },
        run: async (guild, p) => {
          const channel = await needChannel(guild, p.channel);
          const ms = parseDuration(p.in);
          if (ms < 5000) throw new Error('give me at least 5 seconds');
          schedule({
            type: 'say',
            guildId: guild.id,
            runAt: Date.now() + ms,
            data: { channelId: channel.id, content: p.content },
          });
          return `message queued for ${fmtDuration(ms)}`;
        },
      },
      list: {
        d: 'List pending scheduled jobs',
        p: {},
        run: async (guild) =>
          jobsFor(guild.id)
            .map((j) => `${j.id} ${j.type} at ${new Date(j.runAt).toISOString()}`)
            .join('\n') || 'nothing scheduled',
      },
      cancel: {
        d: 'Cancel a scheduled job',
        p: { id: 'string!' },
        run: async (guild, p) => {
          const job = jobsFor(guild.id).find((j) => j.id === p.id);
          if (!job) throw new Error('job not found');
          cancel(job.id);
          return 'cancelled';
        },
      },
    },
  },

  modcase: {
    perm: 'ModerateMembers',
    desc: 'moderation cases',
    verbs: {
      get: {
        d: 'Read one case',
        p: { id: 'int!' },
        run: async (guild, p) => {
          const c = findCase(guild.id, p.id);
          if (!c) throw new Error('no such case');
          return `#${c.id} ${c.type} target=${c.targetId} mod=${c.moderatorId} reason=${c.reason} at=${new Date(c.at).toISOString()}`;
        },
      },
      list: {
        d: 'List recent cases',
        p: { type: 'string', limit: 'int' },
        run: async (guild, p) => {
          let list = casesOf(guild.id);
          if (p.type) list = list.filter((c) => c.type === p.type);
          return list
            .slice(0, clamp(p.limit || 15, 1, 50))
            .map((c) => `#${c.id} ${c.type} ${c.targetTag || c.targetId} :: ${truncate(c.reason, 80)}`)
            .join('\n') || 'nothing';
        },
      },
      edit: {
        d: 'Change a case reason',
        p: { id: 'int!', reason: 'string!' },
        run: async (guild, p) => {
          const cfg = guildCfg(guild.id);
          const c = cfg.cases.find((x) => x.id === p.id);
          if (!c) throw new Error('no such case');
          c.reason = p.reason;
          commit(guild, cfg);
          return `case ${p.id} edited`;
        },
      },
      delete: {
        d: 'Delete a case',
        p: { id: 'int!' },
        run: async (guild, p) => {
          const n = removeCases(guild.id, (c) => c.id === p.id);
          if (!n) throw new Error('no such case');
          return `case ${p.id} deleted`;
        },
      },
      history: {
        d: 'Every case for one user',
        p: { user: 'string!' },
        run: async (guild, p) => {
          const id = String(p.user).match(/\d{16,20}/)?.[0] || p.user;
          const list = casesOf(guild.id).filter((c) => c.targetId === id);
          return list.map((c) => `#${c.id} ${c.type} :: ${truncate(c.reason, 90)}`).join('\n') || 'clean';
        },
      },
      export: {
        d: 'Dump cases as JSON',
        p: {},
        run: async (guild) => JSON.stringify(casesOf(guild.id).slice(0, 200)),
      },
      clear: {
        d: 'Wipe the case log',
        p: {},
        danger: 'high',
        run: async (guild) => {
          const cfg = guildCfg(guild.id);
          const n = cfg.cases.length;
          cfg.cases = [];
          commit(guild, cfg);
          return `deleted ${n} cases`;
        },
      },
      banList: {
        d: 'List bans',
        p: {},
        run: async (guild) => {
          const bans = await guild.bans.fetch();
          return [...bans.values()].map((b) => `${b.user.tag} (${b.user.id}) :: ${b.reason || '—'}`).join('\n') || 'no bans';
        },
      },
      warnList: {
        d: 'List warnings',
        p: {},
        run: async (guild) =>
          casesOf(guild.id)
            .filter((c) => c.type === 'warn')
            .map((c) => `${c.targetTag || c.targetId} #${c.id} :: ${truncate(c.reason, 80)}`)
            .join('\n') || 'no warnings',
      },
      noteList: {
        d: 'List staff notes',
        p: {},
        run: async (guild) =>
          casesOf(guild.id)
            .filter((c) => c.type === 'note')
            .map((c) => `${c.targetTag || c.targetId} #${c.id} :: ${truncate(c.reason, 80)}`)
            .join('\n') || 'no notes',
      },
    },
  },

  utility: {
    perm: 'SendMessages',
    desc: 'read only helpers',
    verbs: {
      serverInfo: {
        d: 'Server overview',
        p: {},
        run: async (guild) => `${guild.name} id=${guild.id} owner=${guild.ownerId} members=${guild.memberCount}`,
      },
      userInfo: {
        d: 'Member overview',
        p: { member: 'member!' },
        run: async (guild, p) => {
          const m = await needMember(guild, p.member);
          return `${m.user.tag} id=${m.id} joined=${m.joinedAt?.toISOString()} created=${m.user.createdAt.toISOString()} roles=${m.roles.cache.size}`;
        },
      },
      roleInfo: {
        d: 'Role overview',
        p: { role: 'role!' },
        run: async (guild, p) => {
          const r = await needRole(guild, p.role);
          return `${r.name} color=${r.hexColor} pos=${r.position} members=${r.members.size}`;
        },
      },
      channelInfo: {
        d: 'Channel overview',
        p: { channel: 'channel!' },
        run: async (guild, p) => {
          const c = await needChannel(guild, p.channel);
          return `#${c.name} id=${c.id} type=${c.type} topic=${c.topic || '—'}`;
        },
      },
      permissions: {
        d: 'What the bot can do in a channel',
        p: { channel: 'channel' },
        run: async (guild, p, ctx) => {
          const c = p.channel ? await needChannel(guild, p.channel) : ctx.channel;
          const perms = c.permissionsFor(guild.members.me);
          return perms.toArray().join(',');
        },
      },
      permCheck: {
        d: 'A member permissions in a channel',
        p: { member: 'member!', channel: 'channel' },
        run: async (guild, p, ctx) => {
          const member = await needMember(guild, p.member);
          const c = p.channel ? await needChannel(guild, p.channel) : ctx.channel;
          return c.permissionsFor(member).toArray().join(',') || 'none';
        },
      },
      avatar: {
        d: 'Avatar url of a member',
        p: { member: 'member!' },
        run: async (guild, p) => {
          const member = await needMember(guild, p.member);
          return member.displayAvatarURL({ size: 1024 });
        },
      },
      banner: {
        d: 'Banner url of a user',
        p: { member: 'member!' },
        run: async (guild, p) => {
          const member = await needMember(guild, p.member);
          const user = await member.user.fetch(true);
          return user.bannerURL({ size: 1024 }) || 'no banner';
        },
      },
      uptime: {
        d: 'How long the bot has been up',
        p: {},
        run: async (guild, p, ctx) => `${fmtDuration(ctx.client.uptime)} uptime`,
      },
      ping: {
        d: 'Gateway ping',
        p: {},
        run: async (guild, p, ctx) => `${Math.round(ctx.client.ws.ping)}ms`,
      },
      snowflake: {
        d: 'Creation date from a discord id',
        p: { id: 'string!' },
        run: async (guild, p) => {
          const id = String(p.id).match(/\d{16,20}/)?.[0];
          if (!id) throw new Error('that is not an id');
          const at = new Date(Number(BigInt(id) >> 22n) + 1420070400000);
          return `${id} created ${at.toISOString()}`;
        },
      },
    },
  },

  settings: {
    perm: 'ManageGuild',
    desc: 'bot settings per guild',
    verbs: {
      get: {
        d: 'Show the guild config',
        p: {},
        run: async (guild) => {
          const cfg = guildCfg(guild.id);
          return JSON.stringify({
            prefix: cfg.prefix,
            modlog: cfg.modlog,
            welcome: cfg.welcome,
            goodbye: cfg.goodbye,
            tickets: { ...cfg.tickets, open: Object.keys(cfg.tickets.open).length },
            automod: cfg.automod,
            autoroles: cfg.autoroles,
            features: cfg.features.map((f) => f.id),
            reactionRoles: cfg.reactionRoles.length,
          });
        },
      },
      setPrefix: {
        d: 'Change the text prefix',
        p: { prefix: 'string!' },
        run: async (guild, p) => {
          if (p.prefix.length > 4) throw new Error('keep it short, 4 chars max');
          const cfg = guildCfg(guild.id);
          cfg.prefix = p.prefix;
          commit(guild, cfg);
          return `prefix is now ${p.prefix}`;
        },
      },
      setModlog: {
        d: 'Set the moderation log channel',
        p: { channel: 'channel!' },
        run: async (guild, p) => {
          const channel = await needChannel(guild, p.channel);
          const cfg = guildCfg(guild.id);
          cfg.modlog = channel.id;
          commit(guild, cfg);
          return `modlog -> #${channel.name}`;
        },
      },
      setSupportRole: {
        d: 'Set the ticket support role',
        p: { role: 'role!' },
        run: async (guild, p) => {
          const role = await needRole(guild, p.role);
          const cfg = guildCfg(guild.id);
          cfg.tickets.supportRole = role.id;
          commit(guild, cfg);
          return `support role ${role.name}`;
        },
      },
      export: {
        d: 'Dump the guild config as JSON',
        p: {},
        run: async (guild) => JSON.stringify(guildCfg(guild.id)),
      },
      reset: {
        d: 'Reset this guild config back to defaults',
        p: {},
        danger: 'high',
        run: async (guild) => {
          const cfg = guildCfg(guild.id);
          const keep = { prefix: cfg.prefix };
          const guilds = guildCfg(guild.id);
          for (const key of Object.keys(guilds)) delete guilds[key];
          Object.assign(guilds, { prefix: keep.prefix });
          commit(guild, guilds);
          return 'config reset';
        },
      },
    },
  },
};

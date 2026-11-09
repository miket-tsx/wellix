import { ChannelType } from 'discord.js';
import { addCase, casesOf, findCase, removeCases, warnCount } from '../lib/moderation.js';
import { resolveMember } from '../lib/resolvers.js';
import { parseDuration, fmtDuration, truncate } from '../lib/util.js';
import { guildCfg, saveGuild } from '../lib/db.js';
import { schedule } from '../lib/scheduler.js';
import { COLOR, embed } from '../lib/render.js';
import { dm } from '../lib/cv2.js';
import { B, E, I, M, S, U } from './helpers.js';

const DAY = 86400000;

async function getMember(guild, user) {
  if (!user) return null;
  if (user.guildId === guild.id) return user;
  return guild.members.fetch(user.id).catch(() => null);
}

function tagOf(user) {
  return user?.tag || user?.username || String(user?.id ?? 'unknown');
}

export default [
  {
    name: 'kick',
    desc: 'Kick a member out of the server',
    cat: 'moderation',
    require: 'mod',
    perms: ['KickMembers'],
    options: [M('member', 'Who to kick', true), S('reason', 'Why')],
    async run({ guild, args, member, ok, err }) {
      const target = args.member;
      if (!target) return err('That member is not in the server.');
      if (!target.kickable) return err('I cannot kick them, their role is above mine.');
      await target.kick(`${tagOf(member.user)}: ${args.reason || 'no reason'}`);
      const c = await addCase(guild, {
        type: 'kick',
        targetId: target.id,
        targetTag: target.user.tag,
        moderatorId: member.id,
        reason: args.reason,
      });
      return ok(`Kicked **${target.user.tag}** · case #${c.id}`);
    },
  },
  {
    name: 'ban',
    desc: 'Ban a member',
    cat: 'moderation',
    require: 'mod',
    perms: ['BanMembers'],
    options: [U('user', 'Who to ban', true), S('reason', 'Why'), I('days', 'Delete message history, days (0-7)', false, { min: 0, max: 7 })],
    async run({ guild, args, member, ok, err }) {
      const target = await getMember(guild, args.user);
      if (target && !target.bannable) return err('Cannot ban them, role hierarchy blocks it.');
      const seconds = Math.min(Math.max(args.days || 0, 0), 7) * 86400;
      await guild.bans.create(args.user.id, {
        reason: `${tagOf(member.user)}: ${args.reason || 'no reason'}`,
        deleteMessageSeconds: seconds,
      });
      const c = await addCase(guild, {
        type: 'ban',
        targetId: args.user.id,
        targetTag: tagOf(args.user),
        moderatorId: member.id,
        reason: args.reason,
      });
      return ok(`Banned **${tagOf(args.user)}** · case #${c.id}`);
    },
  },
  {
    name: 'softban',
    desc: 'Ban then immediately unban, clears recent messages',
    cat: 'moderation',
    require: 'mod',
    perms: ['BanMembers'],
    options: [U('user', 'Who to softban', true), S('reason', 'Why')],
    async run({ guild, args, member, ok, err }) {
      const target = await getMember(guild, args.user);
      if (target && !target.bannable) return err('Role hierarchy blocks that.');
      await guild.bans.create(args.user.id, { reason: 'softban: ' + (args.reason || 'no reason'), deleteMessageSeconds: 604800 });
      await guild.bans.remove(args.user.id, 'softban: unban').catch(() => {});
      const c = await addCase(guild, {
        type: 'softban',
        targetId: args.user.id,
        targetTag: tagOf(args.user),
        moderatorId: member.id,
        reason: args.reason,
      });
      return ok(`Softbanned **${tagOf(args.user)}**, last 7 days of messages removed · case #${c.id}`);
    },
  },
  {
    name: 'tempban',
    desc: 'Ban for a set time, then unban automatically',
    cat: 'moderation',
    require: 'mod',
    perms: ['BanMembers'],
    options: [U('user', 'Who to ban', true), S('duration', 'e.g. 1h, 7d, 2w', true), S('reason', 'Why')],
    async run({ guild, args, member, ok, err }) {
      const ms = parseDuration(args.duration);
      if (ms < 60000) return err('Give at least a minute, like `1h` or `3d`.');
      const target = await getMember(guild, args.user);
      if (target && !target.bannable) return err('Role hierarchy blocks that.');

      await guild.bans.create(args.user.id, { reason: `${tagOf(member.user)}: ${args.reason || 'tempban'}` });
      schedule({
        type: 'unban',
        guildId: guild.id,
        runAt: Date.now() + ms,
        data: { userId: args.user.id, tag: tagOf(args.user) },
      });

      const c = await addCase(guild, {
        type: 'tempban',
        targetId: args.user.id,
        targetTag: tagOf(args.user),
        moderatorId: member.id,
        reason: args.reason,
        duration: fmtDuration(ms),
      });
      return ok(`Banned **${tagOf(args.user)}** for ${fmtDuration(ms)} · case #${c.id}`);
    },
  },
  {
    name: 'unban',
    desc: 'Lift a ban',
    cat: 'moderation',
    require: 'mod',
    perms: ['BanMembers'],
    options: [U('user', 'Banned user', true), S('reason', 'Why')],
    async run({ guild, args, member, ok, err }) {
      const ban = await guild.bans.fetch(args.user.id).catch(() => null);
      if (!ban) return err('That user is not banned.');
      await guild.bans.remove(args.user.id, `${tagOf(member.user)}: ${args.reason || 'unban'}`);
      const c = await addCase(guild, {
        type: 'unban',
        targetId: args.user.id,
        targetTag: tagOf(args.user),
        moderatorId: member.id,
        reason: args.reason,
      });
      return ok(`Unbanned **${tagOf(args.user)}** · case #${c.id}`);
    },
  },
  {
    name: 'unbanall',
    desc: 'Clear the whole ban list',
    cat: 'moderation',
    require: 'admin',
    perms: ['BanMembers'],
    options: [B('confirm', 'Really unban everyone?', true)],
    async run({ guild, args, member, ok, err }) {
      if (!args.confirm) return err('Pass confirm:true if you actually mean it.');
      const bans = await guild.bans.fetch();
      if (!bans.size) return ok('Ban list is already empty.');
      let done = 0;
      for (const [, ban] of bans) {
        const okUnban = await guild.bans.remove(ban.user.id, 'mass unban').then(() => true).catch(() => false);
        if (okUnban) done++;
      }
      await addCase(guild, {
        type: 'unbanall',
        moderatorId: member.id,
        reason: `${done} bans lifted`,
        extra: { count: done },
      });
      return ok(`Lifted ${done}/${bans.size} bans.`);
    },
  },
  {
    name: 'banlist',
    desc: 'Show recent bans',
    cat: 'moderation',
    require: 'mod',
    perms: ['BanMembers'],
    options: [],
    async run({ guild, ok }) {
      const bans = await guild.bans.fetch();
      if (!bans.size) return ok('No bans on record.');
      const lines = [...bans.values()]
        .slice(0, 20)
        .map((b) => `\`${b.user.id}\` **${tagOf(b.user)}** — ${truncate(b.reason || 'no reason', 90)}`);
      return ok(embed({ title: `bans · ${bans.size}`, description: lines.join('\n'), color: COLOR.mod }));
    },
  },
  {
    name: 'baninfo',
    desc: 'Details for one ban',
    cat: 'moderation',
    require: 'mod',
    perms: ['BanMembers'],
    options: [U('user', 'User to look up', true)],
    async run({ guild, args, ok, err }) {
      const ban = await guild.bans.fetch(args.user.id).catch(() => null);
      if (!ban) return err('Not banned.');
      return ok(
        embed({
          title: `ban · ${tagOf(ban.user)}`,
          color: COLOR.mod,
          thumb: ban.user.displayAvatarURL(),
          fields: [
            { name: 'id', value: `\`${ban.user.id}\``, inline: true },
            { name: 'reason', value: truncate(ban.reason || 'none', 900) },
          ],
        }),
      );
    },
  },
  {
    name: 'warn',
    desc: 'Log a warning against a member',
    cat: 'moderation',
    require: 'mod',
    perms: ['ModerateMembers'],
    options: [M('member', 'Who', true), S('reason', 'Why', true)],
    async run({ guild, args, member, ok, err }) {
      const target = args.member;
      if (!target) return err('Member not found.');
      const c = await addCase(guild, {
        type: 'warn',
        targetId: target.id,
        targetTag: target.user.tag,
        moderatorId: member.id,
        reason: args.reason,
      });

      const cfg = guildCfg(guild.id);
      const total = warnCount(guild.id, target.id);
      const threshold = cfg.automod.warnThreshold || 0;
      let extra = '';

      if (threshold > 0 && total >= threshold && target.moderatable) {
        await target.timeout(10 * 60000, `auto: ${total} warnings`).catch(() => {});
        extra = `\nHit the warning limit (${threshold}), timed out for 10 minutes.`;
      }

      dm(target, `You were warned in **${guild.name}**: ${args.reason} (case #${c.id})`).catch(() => {});

      return ok(`Warned **${target.user.tag}**, ${total} total · case #${c.id}${extra}`);
    },
  },
  {
    name: 'warnings',
    desc: 'List warnings for a member',
    cat: 'moderation',
    require: 'mod',
    options: [M('member', 'Who', true)],
    async run({ guild, args, ok }) {
      const list = casesOf(guild.id).filter((c) => c.type === 'warn' && c.targetId === args.member?.id);
      if (!list.length) return ok('Clean record.');
      const lines = list.slice(0, 15).map((c) => `#${c.id} · <t:${Math.floor(c.at / 1000)}:d> · ${truncate(c.reason, 120)}`);
      return ok(embed({ title: `warnings · ${list.length}`, description: lines.join('\n'), color: COLOR.warn }));
    },
  },
  {
    name: 'delwarn',
    desc: 'Delete a single warning by case id',
    cat: 'moderation',
    require: 'mod',
    options: [I('id', 'Case number', true)],
    async run({ guild, args, ok, err }) {
      const c = findCase(guild.id, args.id);
      if (!c || c.type !== 'warn') return err('No warning with that id.');
      removeCases(guild.id, (x) => x.id === c.id);
      return ok(`Warning #${c.id} removed.`);
    },
  },
  {
    name: 'clearwarns',
    desc: 'Wipe every warning for a member',
    cat: 'moderation',
    require: 'mod',
    options: [M('member', 'Who', true)],
    async run({ guild, args, ok }) {
      const n = removeCases(guild.id, (c) => c.type === 'warn' && c.targetId === args.member?.id);
      return ok(`Removed ${n} warnings.`);
    },
  },
  {
    name: 'timeout',
    desc: 'Time a member out',
    cat: 'moderation',
    require: 'mod',
    perms: ['ModerateMembers'],
    options: [M('member', 'Who', true), S('duration', 'e.g. 10m, 1h, 7d', true), S('reason', 'Why')],
    async run({ guild, args, member, ok, err }) {
      const target = args.member;
      if (!target) return err('Member not found.');
      if (!target.moderatable) return err('I cannot time them out, role too high.');
      const ms = Math.min(parseDuration(args.duration), 28 * DAY);
      if (ms < 1000) return err('Duration must be between 1 second and 28 days.');
      await target.timeout(ms, `${tagOf(member.user)}: ${args.reason || 'timeout'}`);
      const c = await addCase(guild, {
        type: 'timeout',
        targetId: target.id,
        targetTag: target.user.tag,
        moderatorId: member.id,
        reason: args.reason,
        duration: fmtDuration(ms),
      });
      return ok(`Timed out **${target.user.tag}** for ${fmtDuration(ms)} · case #${c.id}`);
    },
  },
  {
    name: 'untimeout',
    desc: 'Remove a timeout',
    cat: 'moderation',
    require: 'mod',
    perms: ['ModerateMembers'],
    options: [M('member', 'Who', true)],
    async run({ guild, args, member, ok, err }) {
      const target = args.member;
      if (!target) return err('Member not found.');
      if (!target.communicationDisabledUntilTimestamp) return err('They are not timed out.');
      await target.timeout(null, `${tagOf(member.user)}: untimeout`);
      return ok(`Timeout lifted on **${target.user.tag}**.`);
    },
  },
  {
    name: 'timeouts',
    desc: 'List current timeouts',
    cat: 'moderation',
    require: 'mod',
    options: [],
    async run({ guild, ok }) {
      const now = Date.now();
      const list = guild.members.cache.filter((m) => m.communicationDisabledUntilTimestamp > now);
      if (!list.size) return ok('Nobody is timed out.');
      const lines = list.first(20).map((m) => `**${m.user.tag}** — until <t:${Math.floor(m.communicationDisabledUntilTimestamp / 1000)}:R>`);
      return ok(embed({ title: `timeouts · ${list.size}`, description: lines.join('\n'), color: COLOR.warn }));
    },
  },
  {
    name: 'mute',
    desc: 'Apply the muted role',
    cat: 'moderation',
    require: 'mod',
    perms: ['ManageRoles'],
    options: [M('member', 'Who', true), S('reason', 'Why')],
    async run({ guild, args, member, ok, err }) {
      const target = args.member;
      if (!target) return err('Member not found.');
      if (!guild.members.me.permissions.has('ManageRoles')) return err('I need Manage Roles.');

      let role = guild.roles.cache.find((r) => r.name === 'Muted');
      if (!role) {
        role = await guild.roles.create({ name: 'Muted', color: 0x808080, reason: 'wellix mute' });
        for (const ch of guild.channels.cache.values()) {
          if (!ch.manageable || ch.type === ChannelType.GuildCategory) continue;
          await ch.permissionOverwrites
            .edit(role, { SendMessages: false, AddReactions: false, Speak: false, CreatePublicThreads: false, SendMessagesInThreads: false })
            .catch(() => {});
        }
      }
      await target.roles.add(role, `${tagOf(member.user)}: ${args.reason || 'mute'}`);
      const c = await addCase(guild, {
        type: 'mute',
        targetId: target.id,
        targetTag: target.user.tag,
        moderatorId: member.id,
        reason: args.reason,
      });
      return ok(`Muted **${target.user.tag}** · case #${c.id}`);
    },
  },
  {
    name: 'unmute',
    desc: 'Remove the muted role',
    cat: 'moderation',
    require: 'mod',
    perms: ['ManageRoles'],
    options: [M('member', 'Who', true)],
    async run({ guild, args, ok, err }) {
      const role = guild.roles.cache.find((r) => r.name === 'Muted');
      if (!role) return err('There is no Muted role.');
      if (!args.member?.roles.cache.has(role.id)) return err('They are not muted.');
      await args.member.roles.remove(role, 'unmute').catch(() => {});
      return ok(`Unmuted **${args.member.user.tag}**.`);
    },
  },
  {
    name: 'note',
    desc: 'Attach a private staff note to a user',
    cat: 'moderation',
    require: 'mod',
    options: [M('member', 'Who', true), S('text', 'The note', true)],
    async run({ guild, args, member, ok }) {
      const c = await addCase(guild, {
        type: 'note',
        targetId: args.member?.id,
        targetTag: args.member?.user.tag,
        moderatorId: member.id,
        reason: args.text,
      });
      return ok(`Note saved · case #${c.id}`);
    },
  },
  {
    name: 'notes',
    desc: 'Read staff notes for a user',
    cat: 'moderation',
    require: 'mod',
    options: [M('member', 'Who', true)],
    async run({ guild, args, ok, err }) {
      if (!args.member) return err('Member not found.');
      const list = casesOf(guild.id).filter((c) => c.type === 'note' && c.targetId === args.member.id);
      if (!list.length) return ok('No notes.');
      const lines = list.slice(0, 15).map((c) => `#${c.id} · ${truncate(c.reason, 150)}`);
      return ok(embed({ title: `notes · ${args.member.user.tag}`, description: lines.join('\n'), color: COLOR.neutral }));
    },
  },
  {
    name: 'memberinfo',
    desc: 'Everything about a member',
    cat: 'moderation',
    options: [M('member', 'Who (defaults to you)')],
    async run({ guild, args, member, ok }) {
      const m = args.member || member;
      const roles = m.roles.cache.filter((r) => r.id !== guild.id).map((r) => `<@&${r.id}>`).slice(0, 20);
      return ok(
        embed({
          title: m.user.tag,
          thumb: m.displayAvatarURL({ size: 256 }),
          color: m.displayColor || COLOR.info,
          fields: [
            { name: 'id', value: `\`${m.id}\``, inline: true },
            { name: 'nickname', value: m.nickname || '—', inline: true },
            { name: 'bot', value: m.user.bot ? 'yes' : 'no', inline: true },
            { name: 'joined', value: `<t:${Math.floor(m.joinedTimestamp / 1000)}:F>`, inline: true },
            { name: 'created', value: `<t:${Math.floor(m.user.createdTimestamp / 1000)}:F>`, inline: true },
            { name: 'warnings', value: String(warnCount(guild.id, m.id)), inline: true },
            { name: `roles (${roles.length})`, value: roles.join(' ') || 'none' },
          ],
        }),
      );
    },
  },
];

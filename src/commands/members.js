import { ChannelType } from 'discord.js';
import { addCase, casesOf, findCase, removeCases, warnCount } from '../lib/moderation.js';
import { guildCfg } from '../lib/db.js';
import { resolveMember } from '../lib/resolvers.js';
import { parseDuration, fmtDuration, truncate } from '../lib/util.js';
import { dm } from '../lib/cv2.js';
import {
  MAX_TIMEOUT, tagOf, stamp, canActOn, canManageRole, missingBotPerms,
  reasonFor, boundedDuration, listBody, page, caseLine, caseFooter,
} from './shared.js';
import { B, E, I, M, S, U } from './helpers.js';


export default [
  {
    name: 'kick',
    desc: 'Kick a member out of the server',
    cat: 'moderation',
    require: 'mod',
    perms: ['KickMembers'],
    options: [M('member', 'Who to kick', true), S('reason', 'Why')],
    async run({ guild, channel, args, member, ok, err }) {
      const target = args.member;
      if (!target) return err('That member is not in the server.');
      if (!canActOn(guild, target)) return err('I cannot kick them — they outrank me or own the server.');
      const missing = missingBotPerms(guild, channel, ['KickMembers']);
      if (missing.length) return err(`I am missing: ${missing.join(', ')}`);

      await target.kick(reasonFor(member.user, args.reason)).catch(() => {});
      const c = await addCase(guild, {
        type: 'kick',
        targetId: target.id,
        targetTag: target.user.tag,
        moderatorId: member.id,
        reason: args.reason,
      });
      dm(target, `You were kicked from **${guild.name}**: ${args.reason || 'no reason given'} (case #${c.id})`).catch(() => {});
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
    async run({ guild, channel, args, member, ok, err }) {
      const target = await getMember(guild, args.user);
      if (target && !canActOn(guild, target)) return err('I cannot ban them — they outrank me or own the server.');
      const missing = missingBotPerms(guild, channel, ['BanMembers']);
      if (missing.length) return err(`I am missing: ${missing.join(', ')}`);
      const days = Math.min(Math.max(args.days || 0, 0), 7);

      await guild.bans.create(args.user.id, {
        reason: reasonFor(member.user, args.reason),
        deleteMessageSeconds: days * 86400,
      }).catch(() => {});
      const c = await addCase(guild, {
        type: 'ban',
        targetId: args.user.id,
        targetTag: tagOf(args.user),
        moderatorId: member.id,
        reason: args.reason,
      });
      if (target) dm(target, `You were banned from **${guild.name}**: ${args.reason || 'no reason given'} (case #${c.id})`).catch(() => {});
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
    async run({ guild, channel, args, member, ok, err }) {
      const target = await getMember(guild, args.user);
      if (target && !canActOn(guild, target)) return err('I cannot softban them — they outrank me or own the server.');
      const missing = missingBotPerms(guild, channel, ['BanMembers']);
      if (missing.length) return err(`I am missing: ${missing.join(', ')}`);

      await guild.bans.create(args.user.id, { reason: reasonFor(member.user, args.reason || 'softban'), deleteMessageSeconds: 604800 }).catch(() => {});
      await guild.bans.remove(args.user.id, 'softban: unban').catch(() => {});
      const c = await addCase(guild, { type: 'softban', targetId: args.user.id, targetTag: tagOf(args.user), moderatorId: member.id, reason: args.reason });
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
    async run({ guild, channel, args, member, ok, err }) {
      const parsed = boundedDuration(args.duration, { min: 60_000, max: MAX_TIMEOUT });
      if (parsed.error) return err(parsed.error);
      const ms = parsed.ms;
      const target = await getMember(guild, args.user);
      if (target && !canActOn(guild, target)) return err('I cannot tempban them — they outrank me or own the server.');
      const missing = missingBotPerms(guild, channel, ['BanMembers']);
      if (missing.length) return err(`I am missing: ${missing.join(', ')}`);

      await guild.bans.create(args.user.id, { reason: reasonFor(member.user, args.reason || 'tempban') }).catch(() => {});
      await addCase(guild, { type: 'tempban', targetId: args.user.id, targetTag: tagOf(args.user), moderatorId: member.id, reason: args.reason, duration: fmtDuration(ms) });
      if (target) dm(target, `You were temporarily banned from **${guild.name}** for ${fmtDuration(ms)}: ${args.reason || 'no reason given'} (case pending)`).catch(() => {});

      const schedule = await import('../lib/scheduler.js').then((m) => m.schedule);
      schedule({ type: 'unban', guildId: guild.id, runAt: Date.now() + ms, data: { userId: args.user.id, tag: tagOf(args.user) } });
      return ok(`Temp-banned **${tagOf(args.user)}** for ${fmtDuration(ms)} · auto-unbans at ${stamp(Date.now() + ms, 'R')}`);
    },
  },
  {
    name: 'unban',
    desc: 'Lift a ban',
    cat: 'moderation',
    require: 'mod',
    perms: ['BanMembers'],
    options: [U('user', 'Banned user', true), S('reason', 'Why')],
    async run({ guild, channel, args, member, ok, err }) {
      const ban = await getBan(guild, args.user.id);
      if (!ban) return err('That user is not banned.');
      const missing = missingBotPerms(guild, channel, ['BanMembers']);
      if (missing.length) return err(`I am missing: ${missing.join(', ')}`);

      await guild.bans.remove(args.user.id, reasonFor(member.user, args.reason)).catch(() => {});
      const c = await addCase(guild, { type: 'unban', targetId: args.user.id, targetTag: tagOf(args.user), moderatorId: member.id, reason: args.reason });
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
    async run({ guild, channel, args, member, ok, err }) {
      if (!args.confirm) return err('Pass `confirm:true` if you actually mean to lift every ban.');
      const missing = missingBotPerms(guild, channel, ['BanMembers']);
      if (missing.length) return err(`I am missing: ${missing.join(', ')}`);

      const bans = await guild.bans.fetch().catch(() => null);
      if (!bans?.size) return ok('Ban list is already empty.');
      let done = 0, failed = 0;
      for (const [, ban] of bans) {
        const okUnban = await guild.bans.remove(ban.user.id, 'mass unban').then(() => true).catch(() => false);
        if (okUnban) done++; else failed++;
      }
      await addCase(guild, { type: 'unbanall', moderatorId: member.id, reason: `${done} bans lifted, ${failed} failed`, extra: { count: done } });
      return ok(`Lifted ${done}/${bans.size} bans${failed ? ` (${failed} failed)` : ''}.`);
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
      const bans = await guild.bans.fetch().catch(() => null);
      if (!bans?.size) return ok('No bans on record.');
      const p = page([...bans.values()], 1, 15);
      const lines = p.items.map((b) => `\`${b.user.id}\` **${tagOf(b.user)}** — ${truncate(b.reason || 'no reason', 90)}`);
      return ok({
        components: [{ type: 17, accent_color: 0x3498db, components: [{ type: 10, content: `## bans · ${bans.size}\n\n${listBody(lines)}\n\n${caseFooter(p)}` }] }],
      });
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
      const ban = await getBan(guild, args.user.id);
      if (!ban) return err('Not banned.');
      return ok({
        components: [{ type: 17, accent_color: 0x3498db, components: [
          { type: 10, content: `## ban · ${tagOf(ban.user)}\n-# id: \`${ban.user.id}\`\nreason: ${truncate(ban.reason || 'none', 900)}` },
        ] }],
      });
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
      if (!canActOn(guild, target)) return err('I cannot warn them — they outrank me or own the server.');
      const missing = missingBotPerms(guild, null, ['ModerateMembers']);
      if (missing.length) return err(`I am missing: ${missing.join(', ')}`);

      const c = await addCase(guild, { type: 'warn', targetId: target.id, targetTag: target.user.tag, moderatorId: member.id, reason: args.reason });
      const cfg = guildCfg(guild.id);
      const total = warnCount(guild.id, target.id);
      const threshold = cfg.automod?.warnThreshold || 0;
      let extra = '';

      if (threshold > 0 && total >= threshold && target.moderatable) {
        await target.timeout(600_000, `auto: ${total} warnings`).catch(() => {});
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
      if (!args.member) return ok('Member not found.');
      const list = casesOf(guild.id).filter((c) => c.type === 'warn' && c.targetId === args.member.id);
      if (!list.length) return ok(`${args.member.user.tag} has a clean record.`);
      const p = page(list, args.page || 1, 15);
      const lines = p.items.map((c) => `${caseLine(c)} ${stamp(c.at)}`);
      return ok({
        components: [{ type: 17, accent_color: 0xf1c40f, components: [{ type: 10, content: `## warnings · ${args.member.user.tag} · ${list.length}\n\n${listBody(lines)}\n${caseFooter(p)}` }] }],
      });
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
      if (!args.member) return ok('Member not found.');
      const n = removeCases(guild.id, (c) => c.type === 'warn' && c.targetId === args.member.id);
      return ok(`Removed ${n} warnings for **${args.member.user.tag}**.`);
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
      if (!canActOn(guild, target)) return err('I cannot time them out — they outrank me or own the server.');
      if (!target.moderatable) return err('I cannot time them out.');
      const parsed = boundedDuration(args.duration, { min: 1_000, max: MAX_TIMEOUT });
      if (parsed.error) return err(parsed.error);
      const ms = Math.min(parsed.ms, MAX_TIMEOUT);

      await target.timeout(ms, reasonFor(member.user, args.reason || 'timeout')).catch(() => {});
      const c = await addCase(guild, { type: 'timeout', targetId: target.id, targetTag: target.user.tag, moderatorId: member.id, reason: args.reason, duration: fmtDuration(ms) });
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
      if (!target.communicationDisabledUntilTimestamp || target.communicationDisabledUntilTimestamp <= Date.now()) return err('They are not timed out.');
      if (!canActOn(guild, target)) return err('I cannot remove their timeout — they outrank me or own the server.');

      await target.timeout(null, reasonFor(member.user, 'untimeout')).catch(() => {});
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
      const list = [...guild.members.cache.values()].filter((m) => m.communicationDisabledUntilTimestamp > now).sort((a, b) => a.communicationDisabledUntilTimestamp - b.communicationDisabledUntilTimestamp);
      if (!list.length) return ok('Nobody is timed out.');
      const p = page(list, 1, 15);
      const lines = p.items.map((m) => `**${m.user.tag}** — until ${stamp(m.communicationDisabledUntilTimestamp, 'R')}`);
      return ok({
        components: [{ type: 17, accent_color: 0xf1c40f, components: [{ type: 10, content: `## timeouts · ${list.length}\n\n${listBody(lines)}\n${caseFooter(p)}` }] }],
      });
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
      if (!canActOn(guild, target)) return err('I cannot mute them — they outrank me or own the server.');
      const missing = missingBotPerms(guild, null, ['ManageRoles']);
      if (missing.length) return err(`I am missing: ${missing.join(', ')}`);

      let role = guild.roles.cache.find((r) => r.name === 'Muted');
      if (!role) {
        role = await guild.roles.create({ name: 'Muted', color: 0x808080, reason: 'wellix mute role' }).catch(() => null);
        if (!role) return err('I could not create the Muted role.');
        if (!canManageRole(guild, role)) return err('The Muted role sits above me — move it down.');
      }
      if (!canManageRole(guild, role)) return err('That role sits above my highest role.');
      if (target.roles.cache.has(role.id)) return err('They are already muted.');

      for (const ch of guild.channels.cache.values()) {
        if (!ch.manageable || ch.type === ChannelType.GuildCategory) continue;
        await ch.permissionOverwrites.edit(role, { SendMessages: false, AddReactions: false, Speak: false, CreatePublicThreads: false, SendMessagesInThreads: false }).catch(() => {});
      }
      await target.roles.add(role, reasonFor(member.user, args.reason || 'mute')).catch(() => {});
      const c = await addCase(guild, { type: 'mute', targetId: target.id, targetTag: target.user.tag, moderatorId: member.id, reason: args.reason });
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
      if (!canManageRole(guild, role)) return err('That role sits above my highest role.');

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
      const c = await addCase(guild, { type: 'note', targetId: args.member?.id, targetTag: args.member?.user.tag, moderatorId: member.id, reason: args.text });
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
      const p = page(list, 1, 15);
      const lines = p.items.map((c) => `${caseLine(c)} · ${truncate(c.reason, 150)}`);
      return ok({
        components: [{ type: 17, accent_color: 0x2b2d31, components: [{ type: 10, content: `## notes · ${args.member.user.tag} · ${list.length}\n\n${listBody(lines)}\n${caseFooter(p)}` }] }],
      });
    },
  },
  {
    name: 'memberinfo',
    desc: 'Everything about a member',
    cat: 'moderation',
    options: [M('member', 'Who (defaults to you)')],
    async run({ guild, args, member, ok }) {
      const m = args.member || member;
      const roles = m.roles.cache.filter((r) => r.id !== guild.id).sort((a, b) => b.position - a.position);
      const topRole = roles.first() || null;
      return ok({
        components: [{ type: 17, accent_color: m.displayColor || 0x8b5cf6, components: [
          { type: 10, content: `## ${m.user.tag}\n-# id: \`${m.id}\` · bot: ${m.user.bot ? 'yes' : 'no'}\njoined: ${stamp(m.joinedTimestamp, 'F')}\naccount: ${stamp(m.user.createdTimestamp, 'F')}\nwarnings: ${warnCount(guild.id, m.id)}\n${topRole ? `top role: <@&${topRole.id}> (pos ${topRole.position})` : 'no extra roles'}\nroles: ${roles.map((r) => `<@&${r.id}>`).slice(0, 15).join(' ') || 'none'}${roles.size > 15 ? ` (+${roles.size - 15})` : ''}` },
        ] }],
      });
    },
  },
];

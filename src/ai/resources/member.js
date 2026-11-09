import { addCase, casesOf, removeCases, warnCount } from '../../lib/moderation.js';
import { guildCfg } from '../../lib/db.js';
import { schedule } from '../../lib/scheduler.js';
import { resolveMember } from '../../lib/resolvers.js';
import { dm } from '../../lib/cv2.js';
import { idFrom, clamp, fmtDuration, parseDuration } from '../../lib/util.js';
import { needChannel, needMember, mutedRole, shortMember, shortRole } from './_helpers.js';

const DAY = 86400000;

async function target(guild, ref) {
  const member = await resolveMember(guild, ref).catch(() => null);
  return { member, id: member?.id || idFrom(ref) };
}

export default {
  member: {
    perm: 'ModerateMembers',
    desc: 'members and moderation',
    verbs: {
      kick: {
        d: 'Kick a member',
        p: { member: 'member!', reason: 'string' },
        run: async (guild, p, ctx) => {
          const member = await needMember(guild, p.member);
          if (!member.kickable) throw new Error('member is above me');
          await member.kick(`${ctx.actor.user.tag}: ${p.reason || 'no reason'}`);
          const c = await addCase(guild, {
            type: 'kick',
            targetId: member.id,
            targetTag: member.user.tag,
            moderatorId: ctx.actor.id,
            reason: p.reason,
          });
          return `kicked ${member.user.tag} (case ${c.id})`;
        },
      },

      ban: {
        d: 'Ban a user',
        p: { user: 'string!', reason: 'string', days: 'int' },
        danger: 'high',
        run: async (guild, p, ctx) => {
          const { member, id } = await target(guild, p.user);
          if (!id) throw new Error(`user not found: ${p.user}`);
          if (member && !member.bannable) throw new Error('member is above me');
          await guild.bans.create(id, {
            reason: `${ctx.actor.user.tag}: ${p.reason || 'no reason'}`,
            deleteMessageSeconds: clamp(p.days || 0, 0, 7) * 86400,
          });
          const c = await addCase(guild, {
            type: 'ban',
            targetId: id,
            targetTag: member?.user.tag || p.user,
            moderatorId: ctx.actor.id,
            reason: p.reason,
          });
          return `banned ${member?.user.tag || id} (case ${c.id})`;
        },
      },

      softban: {
        d: 'Ban then unban immediately, clearing recent messages',
        p: { user: 'string!', reason: 'string' },
        danger: 'high',
        run: async (guild, p, ctx) => {
          const { member, id } = await target(guild, p.user);
          if (!id) throw new Error('user not found');
          if (member && !member.bannable) throw new Error('member is above me');
          await guild.bans.create(id, { reason: 'softban', deleteMessageSeconds: 604800 });
          await guild.bans.remove(id, 'softban').catch(() => {});
          const c = await addCase(guild, {
            type: 'softban',
            targetId: id,
            targetTag: member?.user.tag || p.user,
            moderatorId: ctx.actor.id,
            reason: p.reason,
          });
          return `softbanned ${id} (case ${c.id})`;
        },
      },

      unban: {
        d: 'Remove a ban',
        p: { user: 'string!', reason: 'string' },
        run: async (guild, p, ctx) => {
          const id = idFrom(p.user);
          if (!id) throw new Error('give me a user id');
          const ban = await guild.bans.fetch(id).catch(() => null);
          if (!ban) throw new Error('that user is not banned');
          await guild.bans.remove(id, `${ctx.actor.user.tag}: ${p.reason || 'unban'}`);
          const c = await addCase(guild, {
            type: 'unban',
            targetId: id,
            targetTag: ban.user.tag,
            moderatorId: ctx.actor.id,
            reason: p.reason,
          });
          return `unbanned ${ban.user.tag} (case ${c.id})`;
        },
      },

      tempban: {
        d: 'Ban for a duration then unban automatically',
        p: { user: 'string!', duration: 'duration!', reason: 'string' },
        danger: 'high',
        run: async (guild, p, ctx) => {
          const { member, id } = await target(guild, p.user);
          if (!id) throw new Error('user not found');
          const ms = parseDuration(p.duration);
          if (ms < 60000) throw new Error('minimum is one minute');
          if (member && !member.bannable) throw new Error('member is above me');
          await guild.bans.create(id, { reason: `tempban ${p.duration}` });
          schedule({
            type: 'unban',
            guildId: guild.id,
            runAt: Date.now() + ms,
            data: { userId: id, tag: member?.user.tag || id },
          });
          const c = await addCase(guild, {
            type: 'tempban',
            targetId: id,
            targetTag: member?.user.tag || id,
            moderatorId: ctx.actor.id,
            reason: p.reason,
            duration: fmtDuration(ms),
          });
          return `tempbanned ${id} for ${fmtDuration(ms)} (case ${c.id})`;
        },
      },

      timeout: {
        d: 'Timeout a member',
        p: { member: 'member!', duration: 'duration!', reason: 'string' },
        run: async (guild, p, ctx) => {
          const member = await needMember(guild, p.member);
          if (!member.moderatable) throw new Error('member is above me');
          const ms = Math.min(parseDuration(p.duration), 28 * DAY);
          if (ms < 1000) throw new Error('duration too small');
          await member.timeout(ms, `${ctx.actor.user.tag}: ${p.reason || 'timeout'}`);
          const c = await addCase(guild, {
            type: 'timeout',
            targetId: member.id,
            targetTag: member.user.tag,
            moderatorId: ctx.actor.id,
            reason: p.reason,
            duration: fmtDuration(ms),
          });
          return `timed out ${member.user.tag} for ${fmtDuration(ms)} (case ${c.id})`;
        },
      },

      untimeout: {
        d: 'Remove a timeout',
        p: { member: 'member!' },
        run: async (guild, p) => {
          const member = await needMember(guild, p.member);
          await member.timeout(null, 'untimeout');
          return `timeout removed from ${member.user.tag}`;
        },
      },

      warn: {
        d: 'Log a warning',
        p: { member: 'member!', reason: 'string!' },
        run: async (guild, p, ctx) => {
          const member = await needMember(guild, p.member);
          const c = await addCase(guild, {
            type: 'warn',
            targetId: member.id,
            targetTag: member.user.tag,
            moderatorId: ctx.actor.id,
            reason: p.reason,
          });
          const total = warnCount(guild.id, member.id);
          const threshold = guildCfg(guild.id).automod.warnThreshold;
          let note = '';

          if (threshold > 0 && total >= threshold && member.moderatable) {
            await member.timeout(600000, `auto: ${total} warnings`).catch(() => {});
            note = `, hit threshold ${threshold} -> 10m timeout`;
          }

          dm(member, `Warned in ${guild.name}: ${p.reason} (case ${c.id})`).catch(() => {});
          return `warned ${member.user.tag}, total ${total} (case ${c.id})${note}`;
        },
      },

      clearWarns: {
        d: 'Delete every warning for a member',
        p: { member: 'member!' },
        run: async (guild, p) => {
          const member = await needMember(guild, p.member);
          const n = removeCases(guild.id, (c) => c.type === 'warn' && c.targetId === member.id);
          return `cleared ${n} warnings for ${member.user.tag}`;
        },
      },

      note: {
        d: 'Attach a staff note to a member',
        p: { member: 'member!', text: 'string!' },
        run: async (guild, p, ctx) => {
          const member = await needMember(guild, p.member);
          const c = await addCase(guild, {
            type: 'note',
            targetId: member.id,
            targetTag: member.user.tag,
            moderatorId: ctx.actor.id,
            reason: p.text,
          });
          return `note saved (case ${c.id})`;
        },
      },

      notes: {
        d: 'Read notes for a member',
        p: { member: 'member!' },
        run: async (guild, p) => {
          const member = await needMember(guild, p.member);
          const list = casesOf(guild.id).filter((c) => c.type === 'note' && c.targetId === member.id);
          if (!list.length) return 'no notes';
          return list.map((c) => `#${c.id} ${c.reason}`).join('\n');
        },
      },

      setNickname: {
        d: 'Change a nickname',
        p: { member: 'member!', nickname: 'string!' },
        run: async (guild, p) => {
          const member = await needMember(guild, p.member);
          await member.setNickname(p.nickname);
          return `nickname set to ${member.nickname}`;
        },
      },

      resetNickname: {
        d: 'Clear a nickname',
        p: { member: 'member!' },
        run: async (guild, p) => {
          const member = await needMember(guild, p.member);
          await member.setNickname(null);
          return 'nickname cleared';
        },
      },

      mute: {
        d: 'Apply the muted role',
        p: { member: 'member!' },
        run: async (guild, p, ctx) => {
          const member = await needMember(guild, p.member);
          const role = await mutedRole(guild);
          await member.roles.add(role, `mute by ${ctx.actor.user.tag}`);
          await addCase(guild, {
            type: 'mute',
            targetId: member.id,
            targetTag: member.user.tag,
            moderatorId: ctx.actor.id,
            reason: 'mute',
          });
          return `muted ${member.user.tag}`;
        },
      },

      unmute: {
        d: 'Remove the muted role',
        p: { member: 'member!' },
        run: async (guild, p) => {
          const member = await needMember(guild, p.member);
          const role = guild.roles.cache.find((r) => r.name === 'Muted');
          if (!role) throw new Error('no Muted role in this server');
          await member.roles.remove(role);
          return `unmuted ${member.user.tag}`;
        },
      },

      deafen: {
        d: 'Server deafen a member in voice',
        p: { member: 'member!' },
        run: async (guild, p) => {
          const member = await needMember(guild, p.member);
          await member.voice.setDeaf(true);
          return `deafened ${member.user.tag}`;
        },
      },

      undeafen: {
        d: 'Remove server deafen',
        p: { member: 'member!' },
        run: async (guild, p) => {
          const member = await needMember(guild, p.member);
          await member.voice.setDeaf(false);
          return `undeafened ${member.user.tag}`;
        },
      },

      move: {
        d: 'Move a member to another voice channel',
        p: { member: 'member!', channel: 'channel!' },
        run: async (guild, p) => {
          const member = await needMember(guild, p.member);
          const channel = await needChannel(guild, p.channel);
          await member.voice.setChannel(channel);
          return `moved ${member.user.tag} to ${channel.name}`;
        },
      },

      dm: {
        d: 'Send a direct message',
        p: { member: 'member!', text: 'string!' },
        run: async (guild, p) => {
          const member = await needMember(guild, p.member);
          await dm(member, p.text.slice(0, 2000));
          return `dm sent to ${member.user.tag}`;
        },
      },

      info: {
        d: 'Details for one member',
        p: { member: 'member!' },
        run: async (guild, p) => {
          const member = await needMember(guild, p.member);
          const roles = member.roles.cache.filter((r) => r.id !== guild.id).map((r) => r.name);
          return `${member.user.tag} id=${member.id} nick=${member.nickname || '—'} joined=${member.joinedAt?.toISOString()} created=${member.user.createdAt.toISOString()} warnings=${warnCount(guild.id, member.id)} roles=${roles.join(',') || 'none'}`;
        },
      },

      list: {
        d: 'List members, filterable',
        p: { role: 'role', query: 'string', bots: 'bool', limit: 'int' },
        run: async (guild, p) => {
          const limit = clamp(p.limit || 25, 1, 100);
          let members = [...guild.members.cache.values()];

          if (p.role) {
            const role = guild.roles.cache.get(p.role) || guild.roles.cache.find((r) => r.name.toLowerCase() === String(p.role).toLowerCase());
            if (!role) throw new Error('role not found');
            members = members.filter((m) => m.roles.cache.has(role.id));
          }
          if (p.query) {
            const q = String(p.query).toLowerCase();
            members = members.filter((m) => m.user.username.toLowerCase().includes(q) || m.displayName.toLowerCase().includes(q));
          }
          if (p.bots === true) members = members.filter((m) => m.user.bot);
          if (p.bots === false) members = members.filter((m) => !m.user.bot);

          return members.slice(0, limit).map((m) => `${m.user.tag} (${m.id})`).join('\n') || 'no match';
        },
      },

      count: {
        d: 'Member counts',
        p: {},
        run: async (guild) => {
          const bots = guild.members.cache.filter((m) => m.user.bot).size;
          return `total=${guild.memberCount} bots=${bots} humans=${guild.memberCount - bots}`;
        },
      },
    },
  },
};

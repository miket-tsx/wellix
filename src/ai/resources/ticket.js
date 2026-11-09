import { guildCfg, saveGuild } from '../../lib/db.js';
import { closeTicket, sendPanel } from '../../features/tickets.js';
import { needChannel, needMember } from './_helpers.js';

export default {
  ticket: {
    perm: 'ManageChannels',
    desc: 'support tickets',
    verbs: {
      panel: {
        d: 'Post the ticket panel',
        p: { channel: 'channel!', title: 'string' },
        run: async (guild, p) => {
          const channel = await needChannel(guild, p.channel);
          await sendPanel(channel, { title: p.title });
          const cfg = guildCfg(guild.id);
          cfg.tickets.panelChannel = channel.id;
          saveGuild(guild.id, cfg);
          return `panel posted in #${channel.name}`;
        },
      },
      close: {
        d: 'Close a ticket channel',
        p: { channel: 'channel!', reason: 'string' },
        run: async (guild, p, ctx) => {
          const channel = await needChannel(guild, p.channel);
          if (!guildCfg(guild.id).tickets.open[channel.id]) throw new Error('not a ticket channel');
          await closeTicket(channel, ctx.actor, p.reason || 'closed by agent');
          return 'ticket closed';
        },
      },
      add: {
        d: 'Add a member to a ticket',
        p: { channel: 'channel!', member: 'member!' },
        run: async (guild, p) => {
          const channel = await needChannel(guild, p.channel);
          const member = await needMember(guild, p.member);
          await channel.permissionOverwrites.edit(member, {
            ViewChannel: true,
            SendMessages: true,
            ReadMessageHistory: true,
            AttachFiles: true,
          });
          return `${member.user.tag} added`;
        },
      },
      remove: {
        d: 'Remove a member from a ticket',
        p: { channel: 'channel!', member: 'member!' },
        run: async (guild, p) => {
          const channel = await needChannel(guild, p.channel);
          const member = await needMember(guild, p.member);
          await channel.permissionOverwrites.delete(member).catch(() => {});
          return `${member.user.tag} removed`;
        },
      },
      claim: {
        d: 'Claim a ticket',
        p: { channel: 'channel!' },
        run: async (guild, p, ctx) => {
          const channel = await needChannel(guild, p.channel);
          const cfg = guildCfg(guild.id);
          const ticket = cfg.tickets.open[channel.id];
          if (!ticket) throw new Error('not a ticket channel');
          ticket.claimedBy = ctx.actor.id;
          saveGuild(guild.id, cfg);
          await channel.setTopic(`ticket #${ticket.number} · claimed by ${ctx.actor.user.tag}`).catch(() => {});
          return `claimed by ${ctx.actor.user.tag}`;
        },
      },
      rename: {
        d: 'Rename a ticket channel',
        p: { channel: 'channel!', name: 'string!' },
        run: async (guild, p) => {
          const channel = await needChannel(guild, p.channel);
          await channel.setName(p.name);
          return `renamed to ${channel.name}`;
        },
      },
      list: {
        d: 'List open tickets',
        p: {},
        run: async (guild) => {
          const open = guildCfg(guild.id).tickets.open;
          const rows = Object.entries(open).map(
            ([channelId, t]) => `#${t.number} ${channelId} opened_by=${t.userId} claimed=${t.claimedBy || '—'}`,
          );
          return rows.join('\n') || 'no open tickets';
        },
      },
      transcript: {
        d: 'Dump recent messages from a ticket channel',
        p: { channel: 'channel!', limit: 'int' },
        run: async (guild, p) => {
          const channel = await needChannel(guild, p.channel);
          const limit = Math.min(p.limit || 100, 100);
          const messages = await channel.messages.fetch({ limit });
          return [...messages.values()]
            .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
            .map((m) => `${m.author.tag}: ${m.content}`)
            .join('\n')
            .slice(0, 6000);
        },
      },
      setup: {
        d: 'Set ticket category, support role and log channel',
        p: { category: 'channel', support_role: 'role', log: 'channel' },
        run: async (guild, p) => {
          const cfg = guildCfg(guild.id);
          if (p.category) cfg.tickets.category = (await needChannel(guild, p.category)).id;
          if (p.support_role) cfg.tickets.supportRole = p.support_role.id;
          if (p.log) cfg.tickets.log = (await needChannel(guild, p.log)).id;
          saveGuild(guild.id, cfg);
          return `category=${cfg.tickets.category || '—'} support=${cfg.tickets.supportRole || '—'} log=${cfg.tickets.log || '—'}`;
        },
      },
    },
  },
};

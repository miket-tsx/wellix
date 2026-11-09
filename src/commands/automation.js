import { guildCfg, saveGuild } from '../lib/db.js';
import { COLOR, embed } from '../lib/render.js';
import { send } from '../lib/cv2.js';
import { truncate } from '../lib/util.js';
import { addUserToTicket, claimTicket, closeTicket, removeUserFromTicket, sendPanel } from '../features/tickets.js';
import { B, C, E, M, R, S } from './helpers.js';

export default [
  {
    name: 'ticketpanel',
    desc: 'Post the ticket panel',
    cat: 'tickets',
    require: 'admin',
    options: [C('channel', 'Where to post it'), S('title', 'Panel title'), R('support_role', 'Role pinged for tickets')],
    async run({ guild, channel, args, ok, err }) {
      const ch = args.channel || channel;
      if (!ch?.isTextBased()) return err('Pick a text channel.');

      const cfg = guildCfg(guild.id);
      if (args.support_role) cfg.tickets.supportRole = args.support_role.id;
      cfg.tickets.panelChannel = ch.id;
      saveGuild(guild.id, cfg);

      await sendPanel(ch, { title: args.title || 'support tickets' });
      return ok(`Panel posted in ${ch}.`);
    },
  },
  {
    name: 'ticketclose',
    desc: 'Close the ticket you are in',
    cat: 'tickets',
    require: 'mod',
    options: [S('reason', 'Why it is being closed')],
    async run({ guild, channel, member, args, ok, err }) {
      const cfg = guildCfg(guild.id);
      if (!cfg.tickets.open[channel.id]) return err('This channel is not a ticket.');
      await closeTicket(channel, member, args.reason);
      return ok('Ticket closed.');
    },
  },
  {
    name: 'ticketadd',
    desc: 'Add someone to the current ticket',
    cat: 'tickets',
    require: 'mod',
    options: [M('member', 'Who to add', true)],
    async run({ guild, channel, args, ok, err }) {
      if (!guildCfg(guild.id).tickets.open[channel.id]) return err('Not a ticket channel.');
      if (!args.member) return err('Member not found.');
      await addUserToTicket(channel, args.member);
      return ok(`Added **${args.member.user.tag}** to the ticket.`);
    },
  },
  {
    name: 'ticketremove',
    desc: 'Remove someone from the current ticket',
    cat: 'tickets',
    require: 'mod',
    options: [M('member', 'Who to remove', true)],
    async run({ guild, channel, args, ok, err }) {
      if (!guildCfg(guild.id).tickets.open[channel.id]) return err('Not a ticket channel.');
      if (!args.member) return err('Member not found.');
      await removeUserFromTicket(channel, args.member);
      return ok(`Removed **${args.member.user.tag}** from the ticket.`);
    },
  },
  {
    name: 'ticketclaim',
    desc: 'Claim the current ticket',
    cat: 'tickets',
    require: 'mod',
    options: [],
    async run({ guild, channel, member, ok, err }) {
      if (!guildCfg(guild.id).tickets.open[channel.id]) return err('Not a ticket channel.');
      await claimTicket(channel, member);
      return ok(`Ticket claimed by **${member.user.tag}**.`);
    },
  },
  {
    name: 'welcome',
    desc: 'Configure the welcome message',
    cat: 'automation',
    require: 'admin',
    options: [C('channel', 'Where to say hi'), S('message', 'Use {user} {name} {server} {count}'), B('test', 'Send a preview')],
    async run({ guild, member, args, ok, err }) {
      const cfg = guildCfg(guild.id);
      if (args.channel) cfg.welcome.channel = args.channel.id;
      if (args.message) cfg.welcome.message = args.message;
      if (args.channel || args.message) {
        cfg.welcome.enabled = true;
        saveGuild(guild.id, cfg);
      }

      if (args.test) {
        if (!cfg.welcome.channel) return err('Set a channel first.');
        const ch = guild.channels.cache.get(cfg.welcome.channel);
        if (!ch) return err('The configured channel is gone.');
        const text = cfg.welcome.message.replaceAll('{user}', `${member}`).replaceAll('{name}', member.user.username).replaceAll('{server}', guild.name).replaceAll('{count}', String(guild.memberCount));
        await send(ch, { content: truncate(text, 2000) });
        return ok(`Preview sent to ${ch}.`);
      }

      return ok(
        embed({
          title: 'welcome settings',
          color: COLOR.info,
          fields: [
            { name: 'enabled', value: cfg.welcome.enabled ? 'yes' : 'no', inline: true },
            { name: 'channel', value: cfg.welcome.channel ? `<#${cfg.welcome.channel}>` : 'not set', inline: true },
            { name: 'message', value: truncate(cfg.welcome.message, 900) },
          ],
        }),
      );
    },
  },
  {
    name: 'goodbye',
    desc: 'Configure the leave message',
    cat: 'automation',
    require: 'admin',
    options: [C('channel', 'Where to post'), S('message', 'Use {name} {server}'), B('test', 'Send a preview')],
    async run({ guild, member, args, ok, err }) {
      const cfg = guildCfg(guild.id);
      if (args.channel) cfg.goodbye.channel = args.channel.id;
      if (args.message) cfg.goodbye.message = args.message;
      if (args.channel || args.message) {
        cfg.goodbye.enabled = true;
        saveGuild(guild.id, cfg);
      }

      if (args.test) {
        const ch = guild.channels.cache.get(cfg.goodbye.channel);
        if (!ch) return err('Set a channel first.');
        await send(ch, { content: cfg.goodbye.message.replaceAll('{name}', member.user.username).replaceAll('{server}', guild.name) });
        return ok(`Preview sent to ${ch}.`);
      }

      return ok(
        embed({
          title: 'goodbye settings',
          color: COLOR.info,
          fields: [
            { name: 'enabled', value: cfg.goodbye.enabled ? 'yes' : 'no', inline: true },
            { name: 'channel', value: cfg.goodbye.channel ? `<#${cfg.goodbye.channel}>` : 'not set', inline: true },
            { name: 'message', value: truncate(cfg.goodbye.message, 900) },
          ],
        }),
      );
    },
  },
  {
    name: 'autoresponder',
    desc: 'Automatic replies to trigger words',
    cat: 'automation',
    require: 'admin',
    options: [E('action', 'add, remove or list', ['add', 'remove', 'list'], true), S('trigger', 'Word or phrase'), S('response', 'What to answer with')],
    async run({ guild, args, ok, err }) {
      const cfg = guildCfg(guild.id);
      cfg.autoresponders ??= [];

      if (args.action === 'list') {
        if (!cfg.autoresponders.length) return ok('No autoresponders.');
        return ok(cfg.autoresponders.map((a) => `\`${a.trigger}\` → ${truncate(a.response, 60)}`).join('\n'));
      }

      if (!args.trigger) return err('Missing trigger.');
      const trigger = args.trigger.toLowerCase();

      if (args.action === 'remove') {
        const n = cfg.autoresponders.length;
        cfg.autoresponders = cfg.autoresponders.filter((a) => a.trigger !== trigger);
        saveGuild(guild.id, cfg);
        return n === cfg.autoresponders.length ? err('No such trigger.') : ok('Removed.');
      }

      if (!args.response) return err('Missing response.');
      cfg.autoresponders = cfg.autoresponders.filter((a) => a.trigger !== trigger);
      cfg.autoresponders.push({ trigger, response: args.response });
      saveGuild(guild.id, cfg);
      return ok(`\`${trigger}\` → saved.`);
    },
  },
  {
    name: 'autoreact',
    desc: 'Auto-react to messages containing a word',
    cat: 'automation',
    require: 'admin',
    options: [E('action', 'add, remove or list', ['add', 'remove', 'list'], true), S('trigger', 'Word or phrase'), S('emoji', 'Emoji to react with')],
    async run({ guild, args, ok, err }) {
      const cfg = guildCfg(guild.id);
      cfg.autoreact ??= [];

      if (args.action === 'list') {
        if (!cfg.autoreact.length) return ok('Nothing set.');
        return ok(cfg.autoreact.map((a) => `\`${a.trigger}\` → ${a.emoji}`).join('\n'));
      }

      if (!args.trigger) return err('Missing trigger.');
      const trigger = args.trigger.toLowerCase();

      if (args.action === 'remove') {
        const before = cfg.autoreact.length;
        cfg.autoreact = cfg.autoreact.filter((a) => a.trigger !== trigger);
        saveGuild(guild.id, cfg);
        return before === cfg.autoreact.length ? err('No such trigger.') : ok('Removed.');
      }

      if (!args.emoji) return err('Missing emoji.');
      cfg.autoreact = cfg.autoreact.filter((a) => a.trigger !== trigger);
      cfg.autoreact.push({ trigger, emoji: args.emoji });
      saveGuild(guild.id, cfg);
      return ok(`Reacting with ${args.emoji} to \`${trigger}\`.`);
    },
  },
  {
    name: 'settings',
    desc: 'Server settings for the bot',
    cat: 'automation',
    require: 'admin',
    options: [S('prefix', 'New command prefix'), C('modlog', 'Mod log channel'), R('support_role', 'Ticket support role')],
    async run({ guild, args, ok }) {
      const cfg = guildCfg(guild.id);
      if (args.prefix) cfg.prefix = args.prefix;
      if (args.modlog) cfg.modlog = args.modlog.id;
      if (args.support_role) cfg.tickets.supportRole = args.support_role.id;
      if (args.prefix || args.modlog || args.support_role) saveGuild(guild.id, cfg);

      return ok(
        embed({
          title: 'settings',
          color: COLOR.info,
          fields: [
            { name: 'prefix', value: `\`${cfg.prefix || 'w!'}\``, inline: true },
            { name: 'modlog', value: cfg.modlog ? `<#${cfg.modlog}>` : 'not set', inline: true },
            { name: 'ticket support', value: cfg.tickets.supportRole ? `<@&${cfg.tickets.supportRole}>` : 'not set', inline: true },
            { name: 'welcome', value: cfg.welcome.enabled ? `<#${cfg.welcome.channel}>` : 'off', inline: true },
            { name: 'autoroles', value: String(cfg.autoroles.length), inline: true },
            { name: 'features', value: String(cfg.features.length), inline: true },
          ],
        }),
      );
    },
  },
];

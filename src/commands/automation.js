import { PermissionsBitField } from 'discord.js';
import { guildCfg, saveGuild } from '../lib/db.js';
import { applyVars, COLOR, embed, errorText } from '../lib/render.js';
import { send } from '../lib/cv2.js';
import { truncate } from '../lib/util.js';
import { addUserToTicket, claimTicket, closeTicket, removeUserFromTicket, sendPanel } from '../features/tickets.js';
import { canActOn, missingBotPerms, tagOf } from './shared.js';
import { B, C, E, M, R, S } from './helpers.js';

const PANEL_PERMS = ['ManageChannels', 'ManageRoles', 'SendMessages'];
const MAX_TRIGGER = 100;
const MAX_RESPONSE = 1000;
const MAX_LIST = 200;
const MAX_MESSAGE = 2000;
const SHOW_LIST = 25;
const VARS = '{user} {name} {tag} {id} {server} {count} {created} {time}';

function ticketIn(cfg, channel) {
  return cfg?.tickets?.open?.[channel?.id] || null;
}

function permsText(list) {
  return list.map((p) => `\`${p}\``).join(', ');
}

function plain(value) {
  return String(value ?? '').replace(/`/g, "'");
}

function normalizeTrigger(raw) {
  return String(raw ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function messageProblem(raw, label) {
  const text = String(raw ?? '');
  if (!text.trim()) return `the ${label} message is empty.`;
  if (text.length > MAX_MESSAGE) return `the ${label} message must be ${MAX_MESSAGE} characters or fewer.`;
  return null;
}

async function textChannel(guild, id) {
  if (!id) return null;
  const cached = guild.channels.cache.get(String(id));
  if (cached) return cached;
  return guild.channels.fetch(String(id)).catch(() => null);
}

function channelValue(id) {
  return id ? `<#${id}>` : 'not set';
}

export default [
  {
    name: 'ticketpanel',
    desc: 'Post the ticket panel',
    cat: 'tickets',
    require: 'admin',
    options: [C('channel', 'Where to post it'), S('title', 'Panel title'), R('support_role', 'Role pinged for tickets')],
    async run({ guild, channel, args, ok, err }) {
      const ch = args.channel || channel;
      if (!ch?.isTextBased?.() || typeof ch.send !== 'function') return err('pick a text channel for the ticket panel.');

      const title = args.title ? String(args.title).trim() : 'support tickets';
      if (!title) return err('the panel title cannot be empty.');
      if (title.length > 256) return err('the panel title must be 256 characters or fewer.');

      const role = args.support_role;
      if (role && role.id === guild.id) return err('@everyone cannot be the support role.');

      const missing = missingBotPerms(guild, ch, PANEL_PERMS);
      if (missing.length) return err(`i need ${permsText(missing)} in ${ch} to post the panel.`);

      // best effort: tell the admin if an older panel is still sitting here.
      const recent = await ch.messages.fetch({ limit: 50 }).catch(() => null);
      const older = recent?.find?.(
        (m) => m.author.id === guild.members.me?.id && m.components?.some((row) => row.components?.some((c) => c.customId === 'ticket:open')),
      );

      let posted;
      try {
        posted = await sendPanel(ch, { title });
      } catch (e) {
        return err(`could not post the panel: ${truncate(errorText(e), 300)}`);
      }

      const cfg = guildCfg(guild.id);
      let changed = false;
      if (cfg.tickets.panelChannel !== ch.id) {
        cfg.tickets.panelChannel = ch.id;
        changed = true;
      }
      if (role && cfg.tickets.supportRole !== role.id) {
        cfg.tickets.supportRole = role.id;
        changed = true;
      }
      if (changed) saveGuild(guild.id, cfg);

      return ok(
        embed({
          title: 'ticket panel posted',
          color: COLOR.ok,
          fields: [
            { name: 'channel', value: `${ch}`, inline: true },
            { name: 'message', value: posted?.url ? `[jump](${posted.url})` : 'posted', inline: true },
            { name: 'title', value: truncate(title, 200), inline: true },
            {
              name: 'support role',
              value: cfg.tickets.supportRole ? `<@&${cfg.tickets.supportRole}>` : 'not set — tickets will not ping staff',
            },
          ],
          footer: older ? 'an older panel is still here — delete it if it is stale.' : 'members open tickets with the button on the panel.',
        }),
      );
    },
  },
  {
    name: 'ticketclose',
    desc: 'Close the ticket you are in',
    cat: 'tickets',
    require: 'mod',
    options: [S('reason', 'Why it is being closed')],
    async run({ guild, channel, member, args, ok, err }) {
      if (!channel?.isTextBased?.()) return err('run this inside a ticket channel.');
      const cfg = guildCfg(guild.id);
      const ticket = ticketIn(cfg, channel);
      if (!ticket) return err('this channel is not an open ticket.');

      const missing = missingBotPerms(guild, channel, ['ManageChannels']);
      if (missing.length) return err(`i need ${permsText(missing)} here to close and delete the ticket.`);

      const reason = args.reason ? truncate(String(args.reason).trim(), 500) : '';
      try {
        await closeTicket(channel, member, reason);
      } catch (e) {
        return err(`could not close the ticket: ${truncate(errorText(e), 300)}`);
      }

      const log = cfg.tickets.log ? guild.channels.cache.get(cfg.tickets.log) : null;
      return ok(
        embed({
          title: `ticket #${ticket.number} closed`,
          color: COLOR.ok,
          fields: [
            { name: 'opened by', value: ticket.userId ? `<@${ticket.userId}>` : 'unknown', inline: true },
            { name: 'closed by', value: `${member}`, inline: true },
            { name: 'log', value: log ? `${log}` : 'not configured', inline: true },
            { name: 'reason', value: truncate(reason || 'none', 500) },
          ],
          footer: 'the channel will be deleted in 5 seconds.',
        }),
      );
    },
  },
  {
    name: 'ticketadd',
    desc: 'Add someone to the current ticket',
    cat: 'tickets',
    require: 'mod',
    options: [M('member', 'Who to add', true)],
    async run({ guild, channel, args, ok, err }) {
      if (!channel?.isTextBased?.()) return err('run this inside a ticket channel.');
      const cfg = guildCfg(guild.id);
      const ticket = ticketIn(cfg, channel);
      if (!ticket) return err('this channel is not an open ticket.');

      const member = args.member;
      if (!member) return err('that member is not in this server.');
      if (member.id === guild.members.me?.id) return err('that is me — i already have access.');
      if (member.id === guild.ownerId) return err('the server owner can already see this ticket.');
      if (member.user.bot) return err('bots do not need ticket access.');
      if (!canActOn(guild, member)) return err(`${tagOf(member.user)} outranks me, so i can't change their access.`);

      const overwrite = channel.permissionOverwrites?.cache?.get(member.id);
      if (overwrite?.allow?.has(PermissionsBitField.Flags.ViewChannel)) {
        return err(`${tagOf(member.user)} can already see this ticket.`);
      }

      const missing = missingBotPerms(guild, channel, ['ManageRoles']);
      if (missing.length) return err(`i need ${permsText(missing)} here to add members.`);

      try {
        await addUserToTicket(channel, member);
      } catch (e) {
        return err(`could not add them: ${truncate(errorText(e), 300)}`);
      }
      return ok(`added **${tagOf(member.user)}** to ticket #${ticket.number}.`);
    },
  },
  {
    name: 'ticketremove',
    desc: 'Remove someone from the current ticket',
    cat: 'tickets',
    require: 'mod',
    options: [M('member', 'Who to remove', true)],
    async run({ guild, channel, args, ok, err }) {
      if (!channel?.isTextBased?.()) return err('run this inside a ticket channel.');
      const cfg = guildCfg(guild.id);
      const ticket = ticketIn(cfg, channel);
      if (!ticket) return err('this channel is not an open ticket.');

      const member = args.member;
      if (!member) return err('that member is not in this server.');
      if (member.id === guild.members.me?.id) return err('that is me — i need to stay to manage the ticket.');
      if (member.id === ticket.userId) return err('that member opened this ticket; close it instead of removing them.');
      if (member.id === guild.ownerId) return err('the server owner can always see this channel; removing them does nothing.');
      if (!canActOn(guild, member)) return err(`${tagOf(member.user)} outranks me, so i can't change their access.`);

      const overwrite = channel.permissionOverwrites?.cache?.get(member.id);
      if (!overwrite) return err(`${tagOf(member.user)} does not have explicit access to this ticket.`);

      const missing = missingBotPerms(guild, channel, ['ManageRoles']);
      if (missing.length) return err(`i need ${permsText(missing)} here to remove members.`);

      try {
        await removeUserFromTicket(channel, member);
      } catch (e) {
        return err(`could not remove them: ${truncate(errorText(e), 300)}`);
      }
      return ok(`removed **${tagOf(member.user)}** from ticket #${ticket.number}.`);
    },
  },
  {
    name: 'ticketclaim',
    desc: 'Claim the current ticket',
    cat: 'tickets',
    require: 'mod',
    options: [],
    async run({ guild, channel, member, ok, err }) {
      if (!channel?.isTextBased?.()) return err('run this inside a ticket channel.');
      const cfg = guildCfg(guild.id);
      const ticket = ticketIn(cfg, channel);
      if (!ticket) return err('this channel is not an open ticket.');

      if (ticket.claimedBy === member.id) return err('you already claimed this ticket.');
      if (ticket.claimedBy) return err(`this ticket is already claimed by <@${ticket.claimedBy}>.`);

      const missing = missingBotPerms(guild, channel, ['ManageChannels']);
      if (missing.length) return err(`i need ${permsText(missing)} here to claim the ticket.`);

      try {
        await claimTicket(channel, member);
      } catch (e) {
        return err(`could not claim the ticket: ${truncate(errorText(e), 300)}`);
      }
      return ok(`ticket #${ticket.number} claimed by **${tagOf(member.user)}**.`);
    },
  },
  {
    name: 'welcome',
    desc: 'Configure the welcome message',
    cat: 'automation',
    require: 'admin',
    options: [
      C('channel', 'Where to say hi'),
      S('message', 'Use {user} {name} {tag} {id} {server} {count} {created} {time}'),
      B('enabled', 'Turn welcome messages on or off'),
      B('test', 'Send a preview'),
    ],
    async run({ guild, member, args, ok, err }) {
      const cfg = guildCfg(guild.id);
      const w = cfg.welcome;

      if (args.channel && !args.channel.isTextBased()) return err('pick a text channel for welcome messages.');
      if (args.channel) {
        const missing = missingBotPerms(guild, args.channel, ['ViewChannel', 'SendMessages']);
        if (missing.length) return err(`i need ${permsText(missing)} in ${args.channel} to post welcomes.`);
      }
      if (args.message !== undefined) {
        const problem = messageProblem(args.message, 'welcome');
        if (problem) return err(problem);
      }

      // a channel or message implies "on" unless the caller explicitly disabled it.
      const enabling = args.enabled === true || (args.enabled !== false && (!!args.channel || args.message !== undefined));
      if (enabling && !(args.channel?.id || w.channel)) return err('set a channel before enabling welcome messages.');

      let changed = false;
      if (args.channel && w.channel !== args.channel.id) {
        w.channel = args.channel.id;
        changed = true;
      }
      if (args.message !== undefined && w.message !== args.message) {
        w.message = args.message;
        changed = true;
      }
      if (args.enabled === false) {
        if (w.enabled !== false) {
          w.enabled = false;
          changed = true;
        }
      } else if (enabling && w.enabled !== true) {
        w.enabled = true;
        changed = true;
      }
      if (changed) saveGuild(guild.id, cfg);

      if (args.test) {
        if (!w.channel) return err('set a channel before previewing welcome messages.');
        if (!String(w.message ?? '').trim()) return err('set a welcome message before previewing.');
        const target = await textChannel(guild, w.channel);
        if (!target?.isTextBased()) return err('the configured welcome channel is gone or is not text-based.');
        const missing = missingBotPerms(guild, target, ['ViewChannel', 'SendMessages']);
        if (missing.length) return err(`i need ${permsText(missing)} in ${target} to preview.`);

        const vars = { user: member.user, guild, count: guild.memberCount };
        const text = truncate(applyVars(w.message, vars), MAX_MESSAGE);
        const payload = w.embed
          ? {
              embeds: [
                embed({
                  description: text,
                  color: COLOR.info,
                  thumb: member.user.displayAvatarURL({ size: 128 }),
                  image: w.image || undefined,
                }),
              ],
            }
          : { content: text, allowedMentions: { parse: [] } };

        try {
          await send(target, payload);
        } catch (e) {
          return err(`preview failed: ${truncate(errorText(e), 300)}`);
        }
        return ok(`preview sent to ${target}${changed ? ' · settings saved' : ''}.`);
      }

      return ok(
        embed({
          title: 'welcome settings',
          color: w.enabled ? COLOR.ok : COLOR.info,
          fields: [
            { name: 'status', value: w.enabled ? 'on' : 'off', inline: true },
            { name: 'channel', value: channelValue(w.channel), inline: true },
            { name: 'message', value: truncate(w.message, 900) || 'not set' },
            { name: 'variables', value: VARS },
            { name: 'preview', value: 'set `test` to true to send a preview as yourself.' },
          ],
          footer: changed ? 'settings saved' : 'no changes',
        }),
      );
    },
  },
  {
    name: 'goodbye',
    desc: 'Configure the leave message',
    cat: 'automation',
    require: 'admin',
    options: [
      C('channel', 'Where to post'),
      S('message', 'Use {user} {name} {tag} {id} {server} {count} {created} {time}'),
      B('enabled', 'Turn goodbye messages on or off'),
      B('test', 'Send a preview'),
    ],
    async run({ guild, member, args, ok, err }) {
      const cfg = guildCfg(guild.id);
      const g = cfg.goodbye;

      if (args.channel && !args.channel.isTextBased()) return err('pick a text channel for goodbye messages.');
      if (args.channel) {
        const missing = missingBotPerms(guild, args.channel, ['ViewChannel', 'SendMessages']);
        if (missing.length) return err(`i need ${permsText(missing)} in ${args.channel} to post goodbyes.`);
      }
      if (args.message !== undefined) {
        const problem = messageProblem(args.message, 'goodbye');
        if (problem) return err(problem);
      }

      const enabling = args.enabled === true || (args.enabled !== false && (!!args.channel || args.message !== undefined));
      if (enabling && !(args.channel?.id || g.channel)) return err('set a channel before enabling goodbye messages.');

      let changed = false;
      if (args.channel && g.channel !== args.channel.id) {
        g.channel = args.channel.id;
        changed = true;
      }
      if (args.message !== undefined && g.message !== args.message) {
        g.message = args.message;
        changed = true;
      }
      if (args.enabled === false) {
        if (g.enabled !== false) {
          g.enabled = false;
          changed = true;
        }
      } else if (enabling && g.enabled !== true) {
        g.enabled = true;
        changed = true;
      }
      if (changed) saveGuild(guild.id, cfg);

      if (args.test) {
        if (!g.channel) return err('set a channel before previewing goodbye messages.');
        if (!String(g.message ?? '').trim()) return err('set a goodbye message before previewing.');
        const target = await textChannel(guild, g.channel);
        if (!target?.isTextBased()) return err('the configured goodbye channel is gone or is not text-based.');
        const missing = missingBotPerms(guild, target, ['ViewChannel', 'SendMessages']);
        if (missing.length) return err(`i need ${permsText(missing)} in ${target} to preview.`);

        const vars = { user: member.user, guild, count: guild.memberCount };
        const text = truncate(applyVars(g.message, vars), MAX_MESSAGE);

        try {
          await send(target, { content: text, allowedMentions: { parse: [] } });
        } catch (e) {
          return err(`preview failed: ${truncate(errorText(e), 300)}`);
        }
        return ok(`preview sent to ${target}${changed ? ' · settings saved' : ''}.`);
      }

      return ok(
        embed({
          title: 'goodbye settings',
          color: g.enabled ? COLOR.ok : COLOR.info,
          fields: [
            { name: 'status', value: g.enabled ? 'on' : 'off', inline: true },
            { name: 'channel', value: channelValue(g.channel), inline: true },
            { name: 'message', value: truncate(g.message, 900) || 'not set' },
            { name: 'variables', value: VARS },
            { name: 'preview', value: 'set `test` to true to send a preview as yourself.' },
          ],
          footer: changed ? 'settings saved' : 'no changes',
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
      if (!Array.isArray(cfg.autoresponders)) cfg.autoresponders = [];
      const list = cfg.autoresponders;

      if (args.action === 'list') {
        if (!list.length) return ok('no autoresponders set. add one with `autoresponder action:add trigger:<word> response:<text>`.');
        const shown = list.slice(0, SHOW_LIST);
        const lines = shown.map((a) => `**${plain(a.trigger)}** → ${truncate(String(a.response ?? '').replace(/\s+/g, ' '), 90)}`);
        const more = list.length - shown.length;
        return ok(
          embed({
            title: `autoresponders · ${list.length}/${MAX_LIST}`,
            color: COLOR.info,
            description: lines.join('\n'),
            footer: more > 0 ? `showing ${shown.length} of ${list.length} · ${more} more` : `${list.length} configured`,
          }),
        );
      }

      const trigger = normalizeTrigger(args.trigger);
      if (!trigger) return err('give me a trigger word or phrase.');
      if (trigger.length > MAX_TRIGGER) return err(`triggers must be ${MAX_TRIGGER} characters or fewer.`);

      const at = list.findIndex((a) => normalizeTrigger(a.trigger) === trigger);

      if (args.action === 'remove') {
        if (at === -1) return err(`no autoresponder is set for \`${plain(trigger)}\`.`);
        list.splice(at, 1);
        saveGuild(guild.id, cfg);
        return ok(`removed \`${plain(trigger)}\` · ${list.length} left.`);
      }

      const response = String(args.response ?? '').trim();
      if (!response) return err('give me a response to send.');
      if (response.length > MAX_RESPONSE) return err(`responses must be ${MAX_RESPONSE} characters or fewer.`);
      if (at === -1 && list.length >= MAX_LIST) return err(`the autoresponder list is full (${MAX_LIST}); remove one first.`);

      if (at === -1) list.push({ trigger, response });
      else list[at] = { ...list[at], trigger, response };

      saveGuild(guild.id, cfg);
      return ok(`${at === -1 ? 'added' : 'updated'} \`${plain(trigger)}\` · ${list.length}/${MAX_LIST}.`);
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
      if (!Array.isArray(cfg.autoreact)) cfg.autoreact = [];
      const list = cfg.autoreact;

      if (args.action === 'list') {
        if (!list.length) return ok('no autoreacts set. add one with `autoreact action:add trigger:<word> emoji:<emoji>`.');
        const shown = list.slice(0, SHOW_LIST);
        const lines = shown.map((a) => `**${plain(a.trigger)}** → ${plain(a.emoji)}`);
        const more = list.length - shown.length;
        return ok(
          embed({
            title: `autoreacts · ${list.length}/${MAX_LIST}`,
            color: COLOR.info,
            description: lines.join('\n'),
            footer: more > 0 ? `showing ${shown.length} of ${list.length} · ${more} more` : `${list.length} configured`,
          }),
        );
      }

      const trigger = normalizeTrigger(args.trigger);
      if (!trigger) return err('give me a trigger word or phrase.');
      if (trigger.length > MAX_TRIGGER) return err(`triggers must be ${MAX_TRIGGER} characters or fewer.`);

      const at = list.findIndex((a) => normalizeTrigger(a.trigger) === trigger);

      if (args.action === 'remove') {
        if (at === -1) return err(`no autoreact is set for \`${plain(trigger)}\`.`);
        list.splice(at, 1);
        saveGuild(guild.id, cfg);
        return ok(`removed \`${plain(trigger)}\` · ${list.length} left.`);
      }

      const emoji = String(args.emoji ?? '').trim();
      if (!emoji) return err('give me an emoji to react with.');
      if (/\s/.test(emoji)) return err('that does not look like an emoji.');
      if (emoji.length > 100) return err('that emoji is too long.');
      if (at === -1 && list.length >= MAX_LIST) return err(`the autoreact list is full (${MAX_LIST}); remove one first.`);

      if (at === -1) list.push({ trigger, emoji });
      else list[at] = { ...list[at], trigger, emoji };

      saveGuild(guild.id, cfg);
      return ok(`${at === -1 ? 'added' : 'updated'} ${plain(emoji)} for \`${plain(trigger)}\` · ${list.length}/${MAX_LIST}.`);
    },
  },
  {
    name: 'settings',
    desc: 'Server settings for the bot',
    cat: 'automation',
    require: 'admin',
    options: [S('prefix', 'New command prefix'), C('modlog', 'Mod log channel'), R('support_role', 'Ticket support role')],
    async run({ guild, args, ok, err }) {
      // validate every supplied value before changing anything.
      let prefix;
      if (args.prefix !== undefined) {
        prefix = String(args.prefix).trim();
        if (!/^\S{1,5}$/.test(prefix)) return err('prefix must be 1-5 characters with no spaces.');
      }

      let modlog;
      if (args.modlog) {
        const ch = args.modlog;
        if (!ch.isTextBased()) return err('pick a text channel for the mod log.');
        const missing = missingBotPerms(guild, ch, ['ViewChannel', 'SendMessages']);
        if (missing.length) return err(`i need ${permsText(missing)} in ${ch} for the mod log.`);
        modlog = ch.id;
      }

      const supportRole = args.support_role?.id;
      if (supportRole && supportRole === guild.id) return err('@everyone cannot be the support role.');

      const cfg = guildCfg(guild.id);
      let changed = false;

      if (prefix !== undefined && cfg.prefix !== prefix) {
        cfg.prefix = prefix;
        changed = true;
      }
      if (modlog !== undefined && cfg.modlog !== modlog) {
        cfg.modlog = modlog;
        changed = true;
      }
      if (supportRole !== undefined && cfg.tickets.supportRole !== supportRole) {
        cfg.tickets.supportRole = supportRole;
        changed = true;
      }

      if (changed) saveGuild(guild.id, cfg);

      const onOff = (value) => (value ? 'on' : 'off');
      return ok(
        embed({
          title: 'server settings',
          color: changed ? COLOR.ok : COLOR.info,
          fields: [
            { name: 'prefix', value: `\`${plain(cfg.prefix || 'w!')}\``, inline: true },
            { name: 'modlog', value: channelValue(cfg.modlog), inline: true },
            { name: 'welcome', value: `${onOff(cfg.welcome.enabled)} · ${channelValue(cfg.welcome.channel)}`, inline: true },
            { name: 'goodbye', value: `${onOff(cfg.goodbye.enabled)} · ${channelValue(cfg.goodbye.channel)}`, inline: true },
            { name: 'ticket support', value: cfg.tickets.supportRole ? `<@&${cfg.tickets.supportRole}>` : 'not set', inline: true },
            { name: 'ticket panel', value: channelValue(cfg.tickets.panelChannel), inline: true },
            { name: 'ticket log', value: channelValue(cfg.tickets.log), inline: true },
            { name: 'ticket category', value: cfg.tickets.category ? `<#${cfg.tickets.category}>` : 'not set', inline: true },
            { name: 'autoroles', value: String(cfg.autoroles?.length || 0), inline: true },
            { name: 'features', value: String(cfg.features?.length || 0), inline: true },
            { name: 'ai', value: onOff(cfg.ai?.enabled), inline: true },
          ],
          footer: changed ? 'saved' : 'no changes',
        }),
      );
    },
  },
];

import { AuditLogEvent, PermissionsBitField } from 'discord.js';
import { casesOf, findCase, removeCases } from '../lib/moderation.js';
import { guildCfg, saveGuild } from '../lib/db.js';
import { resolveMember } from '../lib/resolvers.js';
import { COLOR, embed } from '../lib/render.js';
import { truncate } from '../lib/util.js';
import { B, C, E, I, M, S } from './helpers.js';

function caseEmbed(c) {
  return embed({
    title: `case #${c.id} · ${c.type}`,
    color: c.type === 'warn' ? COLOR.warn : COLOR.mod,
    fields: [
      { name: 'target', value: c.targetId ? `<@${c.targetId}> \`${c.targetId}\`` : 'n/a', inline: true },
      { name: 'moderator', value: c.moderatorId ? `<@${c.moderatorId}>` : 'system', inline: true },
      { name: 'when', value: `<t:${Math.floor(c.at / 1000)}:F>`, inline: true },
      ...(c.duration ? [{ name: 'duration', value: c.duration, inline: true }] : []),
      { name: 'reason', value: truncate(c.reason, 1000) },
    ],
  });
}

export default [
  {
    name: 'case',
    desc: 'Look up one moderation case',
    cat: 'utility',
    require: 'mod',
    options: [I('id', 'Case number', true)],
    async run({ guild, args, ok, err }) {
      const c = findCase(guild.id, args.id);
      if (!c) return err('No such case.');
      return ok(caseEmbed(c));
    },
  },
  {
    name: 'cases',
    desc: 'Recent moderation cases',
    cat: 'utility',
    require: 'mod',
    options: [S('type', 'Filter by type, e.g. ban'), I('limit', 'How many', false, { min: 1, max: 50 })],
    async run({ guild, args, ok }) {
      let list = casesOf(guild.id);
      if (args.type) list = list.filter((c) => c.type === String(args.type).toLowerCase());
      if (!list.length) return ok('Nothing on record.');
      const lines = list.slice(0, args.limit || 12).map((c) => `#${c.id} \`${c.type}\` <@${c.targetId}> · ${truncate(c.reason, 60)}`);
      return ok(embed({ title: `${list.length} cases`, description: lines.join('\n'), color: COLOR.mod }));
    },
  },
  {
    name: 'editcase',
    desc: 'Rewrite the reason on a case',
    cat: 'utility',
    require: 'admin',
    options: [I('id', 'Case number', true), S('reason', 'New reason', true)],
    async run({ guild, args, ok, err }) {
      const cfg = guildCfg(guild.id);
      const c = cfg.cases.find((x) => x.id === Number(args.id));
      if (!c) return err('No such case.');
      c.reason = args.reason;
      saveGuild(guild.id, cfg);
      return ok(`Case #${c.id} updated.`);
    },
  },
  {
    name: 'delcase',
    desc: 'Delete a case',
    cat: 'utility',
    require: 'admin',
    options: [I('id', 'Case number', true)],
    async run({ guild, args, ok, err }) {
      const n = removeCases(guild.id, (c) => c.id === Number(args.id));
      if (!n) return err('No such case.');
      return ok(`Case #${args.id} deleted.`);
    },
  },
  {
    name: 'history',
    desc: 'All cases for a member',
    cat: 'utility',
    require: 'mod',
    options: [M('member', 'Who', true)],
    async run({ guild, args, ok, err }) {
      if (!args.member) return err('Member not found.');
      const list = casesOf(guild.id).filter((c) => c.targetId === args.member.id);
      if (!list.length) return ok('Clean record.');
      const lines = list.slice(0, 20).map((c) => `#${c.id} \`${c.type}\` · ${truncate(c.reason, 70)}`);
      return ok(embed({ title: `history · ${args.member.user.tag}`, description: lines.join('\n'), color: COLOR.mod }));
    },
  },
  {
    name: 'audit',
    desc: 'Recent audit log entries',
    cat: 'utility',
    require: 'admin',
    perms: ['ViewAuditLog'],
    options: [I('limit', '1-25', false, { min: 1, max: 25 })],
    async run({ guild, args, ok }) {
      const logs = await guild.fetchAuditLogs({ limit: args.limit || 8 }).catch(() => null);
      if (!logs) return ok('Could not read the audit log.');
      const lines = [...logs.entries.values()].map((e) => {
        const action = Object.keys(AuditLogEvent).find((k) => AuditLogEvent[k] === e.action) || String(e.action);
        const who = e.executor?.tag || 'unknown';
        const what = e.target?.tag || e.target?.name || e.target?.id || '—';
        return `\`${action}\` **${who}** → ${what}`;
      });
      return ok(embed({ title: 'audit log', description: lines.join('\n') || 'empty', color: COLOR.neutral }));
    },
  },
  {
    name: 'permissions',
    desc: 'What can the bot do here?',
    cat: 'utility',
    require: 'mod',
    options: [C('channel', 'Channel (default: here)')],
    async run({ guild, channel, args, ok }) {
      const ch = args.channel || channel;
      const me = guild.members.me;
      const perms = ch.permissionsFor(me);
      const have = perms.toArray();
      const need = ['ManageChannels', 'ManageRoles', 'ManageMessages', 'KickMembers', 'BanMembers', 'ModerateMembers', 'ViewAuditLog'];
      const missing = need.filter((p) => !perms.has(PermissionsBitField.Flags[p]));
      return ok(
        embed({
          title: `bot perms · #${ch.name}`,
          color: missing.length ? COLOR.warn : COLOR.ok,
          fields: [
            { name: 'granted', value: `${have.length} permissions` },
            { name: 'missing (recommended)', value: missing.join(', ') || 'none' },
            { name: 'all', value: truncate(have.join(', '), 900) },
          ],
        }),
      );
    },
  },
  {
    name: 'permcheck',
    desc: 'Check a member’s permissions in a channel',
    cat: 'utility',
    require: 'mod',
    options: [M('member', 'Who', true), C('channel', 'Channel (default: here)')],
    async run({ guild, channel, args, ok, err }) {
      if (!args.member) return err('Member not found.');
      const ch = args.channel || channel;
      const perms = ch.permissionsFor(args.member);
      const critical = ['Administrator', 'ManageGuild', 'ManageChannels', 'ManageRoles', 'ManageMessages', 'KickMembers', 'BanMembers', 'ModerateMembers'];
      const held = critical.filter((p) => perms.has(PermissionsBitField.Flags[p]));
      return ok(
        embed({
          title: `permcheck · ${args.member.user.tag}`,
          color: held.includes('Administrator') ? COLOR.err : COLOR.info,
          description: `in ${ch}\n\n${held.map((p) => `\`${p}\``).join(' ') || 'no elevated permissions'}`,
        }),
      );
    },
  },
  {
    name: 'antispam',
    desc: 'Toggle spam filtering',
    cat: 'utility',
    require: 'admin',
    options: [B('enabled', 'On or off', true)],
    async run({ guild, args, ok }) {
      const cfg = guildCfg(guild.id);
      cfg.automod.antispam = args.enabled;
      saveGuild(guild.id, cfg);
      return ok(`Anti-spam ${args.enabled ? 'on' : 'off'}.`);
    },
  },
  {
    name: 'antilink',
    desc: 'Toggle link filtering',
    cat: 'utility',
    require: 'admin',
    options: [B('enabled', 'On or off', true)],
    async run({ guild, args, ok }) {
      const cfg = guildCfg(guild.id);
      cfg.automod.antilink = args.enabled;
      saveGuild(guild.id, cfg);
      return ok(`Anti-link ${args.enabled ? 'on' : 'off'}.`);
    },
  },
  {
    name: 'badwords',
    desc: 'Manage the bad word list',
    cat: 'utility',
    require: 'admin',
    options: [
      E('action', 'add, remove or list', ['add', 'remove', 'list'], true),
      S('word', 'Word or phrase'),
    ],
    async run({ guild, args, ok, err }) {
      const cfg = guildCfg(guild.id);
      cfg.automod.badwords ??= [];

      if (args.action === 'list') {
        return ok(cfg.automod.badwords.length ? `\`${cfg.automod.badwords.join('`, `')}\`` : 'List is empty.');
      }
      if (!args.word) return err('Give me a word.');
      const word = args.word.toLowerCase();

      if (args.action === 'add') {
        if (cfg.automod.badwords.includes(word)) return err('Already blocked.');
        cfg.automod.badwords.push(word);
      } else {
        if (!cfg.automod.badwords.includes(word)) return err('Not on the list.');
        cfg.automod.badwords = cfg.automod.badwords.filter((w) => w !== word);
      }
      saveGuild(guild.id, cfg);
      return ok(`\`${word}\` ${args.action}ed.`);
    },
  },
  {
    name: 'warnsettings',
    desc: 'Warnings before an automatic timeout',
    cat: 'utility',
    require: 'admin',
    options: [I('threshold', '0 disables auto action', false, { min: 0, max: 20 })],
    async run({ guild, args, ok }) {
      const cfg = guildCfg(guild.id);
      if (args.threshold !== undefined) {
        cfg.automod.warnThreshold = args.threshold;
        saveGuild(guild.id, cfg);
      }
      return ok(`Warning threshold: **${cfg.automod.warnThreshold}** (0 = off).`);
    },
  },
  {
    name: 'automod',
    desc: 'Automod overview or master switch',
    cat: 'utility',
    require: 'admin',
    options: [E('action', 'status, on or off', ['status', 'on', 'off'])],
    async run({ guild, args, ok }) {
      const cfg = guildCfg(guild.id);
      if (args.action === 'on' || args.action === 'off') {
        cfg.automod.antispam = args.action === 'on';
        cfg.automod.antilink = args.action === 'on';
        cfg.automod.antiinvite = args.action === 'on';
        saveGuild(guild.id, cfg);
      }
      return ok(
        embed({
          title: 'automod',
          color: COLOR.info,
          fields: [
            { name: 'antispam', value: cfg.automod.antispam ? 'on' : 'off', inline: true },
            { name: 'antilink', value: cfg.automod.antilink ? 'on' : 'off', inline: true },
            { name: 'antiinvite', value: cfg.automod.antiinvite ? 'on' : 'off', inline: true },
            { name: 'badwords', value: String(cfg.automod.badwords.length), inline: true },
            { name: 'warn threshold', value: String(cfg.automod.warnThreshold), inline: true },
          ],
        }),
      );
    },
  },
];

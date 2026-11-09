import { guildCfg, saveGuild } from '../lib/db.js';
import { resolveRole } from '../lib/resolvers.js';
import { COLOR, embed } from '../lib/render.js';
import { chunk, truncate } from '../lib/util.js';
import { B, E, I, M, R, S } from './helpers.js';

function hex(input) {
  if (!input) return undefined;
  const s = String(input).replace('#', '').trim();
  if (/^[0-9a-f]{6}$/i.test(s)) return parseInt(s, 16);
  if (/^[0-9a-f]{3}$/i.test(s)) return parseInt(s.split('').map((c) => c + c).join(''), 16);
  return undefined;
}

export default [
  {
    name: 'addrole',
    desc: 'Give a role to a member',
    cat: 'roles',
    require: 'mod',
    perms: ['ManageRoles'],
    options: [M('member', 'Who', true), R('role', 'Which role', true)],
    async run({ guild, args, ok, err }) {
      const { member: target, role } = args;
      if (!target || !role) return err('Member or role not found.');
      if (role.position >= guild.members.me.roles.highest.position) return err('That role sits above mine.');
      await target.roles.add(role);
      return ok(`Gave **${role.name}** to **${target.user.tag}**.`);
    },
  },
  {
    name: 'removerole',
    desc: 'Take a role away from a member',
    cat: 'roles',
    require: 'mod',
    perms: ['ManageRoles'],
    options: [M('member', 'Who', true), R('role', 'Which role', true)],
    async run({ guild, args, ok, err }) {
      const { member: target, role } = args;
      if (!target || !role) return err('Member or role not found.');
      if (role.position >= guild.members.me.roles.highest.position) return err('That role sits above mine.');
      await target.roles.remove(role);
      return ok(`Removed **${role.name}** from **${target.user.tag}**.`);
    },
  },
  {
    name: 'createrole',
    desc: 'Create a role',
    cat: 'roles',
    require: 'admin',
    perms: ['ManageRoles'],
    options: [S('name', 'Role name', true), S('color', 'Hex like #8b5cf6'), B('hoist', 'Show separately'), B('mentionable', 'Allow mentions')],
    async run({ guild, args, ok }) {
      const role = await guild.roles.create({
        name: args.name,
        color: hex(args.color) ?? 0,
        hoist: !!args.hoist,
        mentionable: !!args.mentionable,
        reason: 'created via wellix',
      });
      return ok(`Created ${role} at position ${role.position}.`);
    },
  },
  {
    name: 'deleterole',
    desc: 'Delete a role',
    cat: 'roles',
    require: 'admin',
    perms: ['ManageRoles'],
    options: [R('role', 'Role to delete', true), B('confirm', 'Skip the safety check?')],
    async run({ guild, args, ok, err }) {
      if (!args.role) return err('Role not found.');
      if (args.role.managed) return err('That role is managed by an integration, delete it there.');
      if (args.role.position >= guild.members.me.roles.highest.position) return err('That role is above mine.');
      const name = args.role.name;
      await args.role.delete('deleted via wellix');
      return ok(`Deleted **${name}**.`);
    },
  },
  {
    name: 'renamerole',
    desc: 'Rename a role',
    cat: 'roles',
    require: 'admin',
    perms: ['ManageRoles'],
    options: [R('role', 'Role', true), S('name', 'New name', true)],
    async run({ guild, args, ok, err }) {
      if (!args.role) return err('Role not found.');
      const old = args.role.name;
      await args.role.setName(args.name, 'renamed via wellix');
      return ok(`**${old}** is now **${args.name}**.`);
    },
  },
  {
    name: 'rolecolor',
    desc: 'Change a role colour',
    cat: 'roles',
    require: 'admin',
    perms: ['ManageRoles'],
    options: [R('role', 'Role', true), S('color', 'Hex or "reset"', true)],
    async run({ guild, args, ok, err }) {
      if (!args.role) return err('Role not found.');
      if (String(args.color).toLowerCase() === 'reset') {
        await args.role.setColor(null);
        return ok('Colour reset.');
      }
      const value = hex(args.color);
      if (value === undefined) return err('That is not a hex colour.');
      await args.role.setColor(value);
      return ok(`**${args.role.name}** is now #${value.toString(16).padStart(6, '0')}.`);
    },
  },
  {
    name: 'rolehoist',
    desc: 'Toggle whether a role is displayed separately',
    cat: 'roles',
    require: 'admin',
    perms: ['ManageRoles'],
    options: [R('role', 'Role', true), B('hoist', 'On or off', true)],
    async run({ guild, args, ok, err }) {
      if (!args.role) return err('Role not found.');
      await args.role.setHoist(args.hoist);
      return ok(`Hoist for **${args.role.name}** is ${args.hoist ? 'on' : 'off'}.`);
    },
  },
  {
    name: 'rolementionable',
    desc: 'Toggle whether a role can be mentioned',
    cat: 'roles',
    require: 'admin',
    perms: ['ManageRoles'],
    options: [R('role', 'Role', true), B('mentionable', 'On or off', true)],
    async run({ guild, args, ok, err }) {
      if (!args.role) return err('Role not found.');
      await args.role.setMentionable(args.mentionable);
      return ok(`**${args.role.name}** ${args.mentionable ? 'can' : 'cannot'} be mentioned.`);
    },
  },
  {
    name: 'roleposition',
    desc: 'Move a role up or down',
    cat: 'roles',
    require: 'admin',
    perms: ['ManageRoles'],
    options: [R('role', 'Role', true), I('position', 'Target position', true, { min: 0, max: 500 })],
    async run({ guild, args, ok, err }) {
      if (!args.role) return err('Role not found.');
      const ceiling = guild.members.me.roles.highest.position - 1;
      const target = Math.min(args.position, ceiling);
      await args.role.setPosition(target);
      return ok(`**${args.role.name}** moved to ${args.role.position}.`);
    },
  },
  {
    name: 'roleinfo',
    desc: 'Role details',
    cat: 'roles',
    options: [R('role', 'Role', true)],
    async run({ guild, args, ok, err }) {
      const role = args.role;
      if (!role) return err('Role not found.');
      return ok(
        embed({
          title: role.name,
          color: role.color || COLOR.neutral,
          fields: [
            { name: 'id', value: `\`${role.id}\``, inline: true },
            { name: 'colour', value: role.hexColor, inline: true },
            { name: 'position', value: String(role.position), inline: true },
            { name: 'members', value: String(role.members.size), inline: true },
            { name: 'hoisted', value: role.hoist ? 'yes' : 'no', inline: true },
            { name: 'mentionable', value: role.mentionable ? 'yes' : 'no', inline: true },
            { name: 'permissions', value: `${role.permissions.toArray().length} granted` },
          ],
        }),
      );
    },
  },
  {
    name: 'rolelist',
    desc: 'All roles with member counts',
    cat: 'roles',
    options: [],
    async run({ guild, ok }) {
      const roles = [...guild.roles.cache.values()]
        .filter((r) => r.id !== guild.id)
        .sort((a, b) => b.position - a.position)
        .slice(0, 40);
      if (!roles.length) return ok('No roles besides @everyone.');
      const lines = roles.map((r) => `${r.hexColor} **${r.name}** · ${r.members.size}`);
      return ok(embed({ title: `roles · ${guild.roles.cache.size - 1}`, description: lines.join('\n'), color: COLOR.neutral }));
    },
  },
  {
    name: 'massrole',
    desc: 'Add or remove a role from every human member',
    cat: 'roles',
    require: 'admin',
    perms: ['ManageRoles'],
    options: [R('role', 'Role', true), E('action', 'add or remove', ['add', 'remove'], true)],
    async run({ guild, args, ok, err }) {
      const role = args.role;
      if (!role) return err('Role not found.');
      if (role.position >= guild.members.me.roles.highest.position) return err('That role is above mine.');

      const members = await guild.members.fetch();
      const targets = members.filter((m) => !m.user.bot);
      let done = 0;
      for (const batch of chunk([...targets.values()], 5)) {
        const results = await Promise.allSettled(
          batch.map((m) => (args.action === 'add' ? m.roles.add(role) : m.roles.remove(role))),
        );
        done += results.filter((r) => r.status === 'fulfilled').length;
      }
      return ok(`${args.action === 'add' ? 'Added' : 'Removed'} **${role.name}** for ${done} members.`);
    },
  },
  {
    name: 'autorole',
    desc: 'Roles handed out automatically on join',
    cat: 'roles',
    require: 'admin',
    options: [
      E('action', 'add, remove or list', ['add', 'remove', 'list'], true),
      R('role', 'Role to add/remove'),
    ],
    async run({ guild, args, ok, err }) {
      const cfg = guildCfg(guild.id);
      cfg.autoroles ??= [];

      if (args.action === 'list') {
        if (!cfg.autoroles.length) return ok('No autoroles set.');
        return ok(`Autoroles: ${cfg.autoroles.map((id) => `<@&${id}>`).join(', ')}`);
      }

      if (!args.role) return err('Pick a role.');
      if (args.action === 'add') {
        if (cfg.autoroles.includes(args.role.id)) return err('Already on the list.');
        cfg.autoroles.push(args.role.id);
      } else {
        if (!cfg.autoroles.includes(args.role.id)) return err('Not on the list.');
        cfg.autoroles = cfg.autoroles.filter((id) => id !== args.role.id);
      }
      saveGuild(guild.id, cfg);
      return ok(`Autorole **${args.role.name}** ${args.action === 'add' ? 'added' : 'removed'}.`);
    },
  },
  {
    name: 'rolebackup',
    desc: 'Snapshot all roles',
    cat: 'roles',
    require: 'admin',
    options: [S('name', 'Backup name', false)],
    async run({ guild, args, ok }) {
      const cfg = guildCfg(guild.id);
      const key = (args.name || 'default').toLowerCase();
      cfg.roleBackups ??= {};
      cfg.roleBackups[key] = guild.roles.cache
        .filter((r) => r.id !== guild.id && !r.managed)
        .map((r) => ({
          name: r.name,
          color: r.color,
          hoist: r.hoist,
          mentionable: r.mentionable,
          position: r.position,
          permissions: r.permissions.bitfield.toString(),
        }));
      saveGuild(guild.id, cfg);
      return ok(`Saved ${cfg.roleBackups[key].length} roles as \`${key}\`.`);
    },
  },
  {
    name: 'rolerestore',
    desc: 'Re-create roles from a backup',
    cat: 'roles',
    require: 'admin',
    perms: ['ManageRoles'],
    options: [S('name', 'Backup name', false)],
    async run({ guild, args, ok, err }) {
      const cfg = guildCfg(guild.id);
      const key = (args.name || 'default').toLowerCase();
      const snap = cfg.roleBackups?.[key];
      if (!snap?.length) return err(`No backup called \`${key}\`.`);

      let made = 0;
      for (const r of snap) {
        if (guild.roles.cache.some((x) => x.name === r.name)) continue;
        await guild.roles
          .create({
            name: r.name,
            color: r.color,
            hoist: r.hoist,
            mentionable: r.mentionable,
            permissions: BigInt(r.permissions),
            reason: 'role restore',
          })
          .then(() => made++)
          .catch(() => {});
      }
      return ok(`Restored ${made} missing roles from \`${key}\`.`);
    },
  },
];

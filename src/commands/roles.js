import { guildCfg, saveGuild } from '../lib/db.js';
import { resolveRole } from '../lib/resolvers.js';
import { COLOR, embed } from '../lib/render.js';
import { chunk, truncate } from '../lib/util.js';
import { canActOn, canManageRole, hexColor, listBody, page, caseLine, missingBotPerms } from './shared.js';
import { B, E, I, M, R, S } from './helpers.js';

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
      if (!canActOn(guild, target)) return err('I cannot change roles for them — they outrank me or own the server.');
      if (!canManageRole(guild, role)) return err('That role sits above my highest role or cannot be managed.');
      if (target.roles.cache.has(role.id)) return err(`**${target.user.tag}** already has **${role.name}**.`);
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
      if (!canActOn(guild, target)) return err('I cannot change roles for them — they outrank me or own the server.');
      if (!canManageRole(guild, role)) return err('That role sits above my highest role or cannot be managed.');
      if (!target.roles.cache.has(role.id)) return err(`**${target.user.tag}** does not have **${role.name}**.`);
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
    async run({ guild, args, ok, err }) {
      if (!args.name || args.name.length < 2 || args.name.length > 100) return err('Role name must be between 2 and 100 characters.');
      if (guild.roles.cache.some((r) => r.name.toLowerCase() === args.name.toLowerCase() && r.id !== guild.id)) return err('A role with that name already exists.');
      const color = hexColor(args.color) ?? 0;
      const role = await guild.roles.create({
        name: args.name,
        color,
        hoist: !!args.hoist,
        mentionable: !!args.mentionable,
        reason: 'created via wellix',
      }).catch(() => null);
      if (!role) return err('Failed to create the role — check my permissions and role limit.');
      return ok(`Created **${role.name}** at position ${role.position}.`);
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
      if (args.role.id === guild.id) return err('Cannot delete @everyone.');
      if (args.role.managed) return err('That role is managed by an integration — delete it at the source.');
      if (!canManageRole(guild, args.role)) return err('That role sits above my highest role.');
      const missing = missingBotPerms(guild, null, ['ManageRoles']);
      if (missing.length) return err(`I am missing: ${missing.join(', ')}`);
      if (!args.confirm) return err('Pass `confirm:true` to actually delete this role.');
      const name = args.role.name;
      await args.role.delete('deleted via wellix').catch(() => {});
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
      if (args.role.id === guild.id) return err('Cannot rename @everyone.');
      if (!args.name || args.name.length < 2 || args.name.length > 100) return err('Name must be between 2 and 100 characters.');
      if (!canManageRole(guild, args.role)) return err('That role sits above my highest role.');
      const old = args.role.name;
      await args.role.setName(args.name, 'renamed via wellix').catch(() => {});
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
      if (args.role.id === guild.id) return err('Cannot recolour @everyone.');
      if (!canManageRole(guild, args.role)) return err('That role sits above my highest role.');
      if (String(args.color).toLowerCase() === 'reset') {
        await args.role.setColor(null).catch(() => {});
        return ok(`**${args.role.name}** colour reset.`);
      }
      const value = hexColor(args.color);
      if (value === undefined) return err('That is not a hex colour.');
      await args.role.setColor(value).catch(() => {});
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
      if (args.role.id === guild.id) return err('Cannot hoist @everyone.');
      if (!canManageRole(guild, args.role)) return err('That role sits above my highest role.');
      await args.role.setHoist(args.hoist).catch(() => {});
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
      if (args.role.id === guild.id) return err('Cannot make @everyone mentionable.');
      if (!canManageRole(guild, args.role)) return err('That role sits above my highest role.');
      await args.role.setMentionable(args.mentionable).catch(() => {});
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
      if (args.role.id === guild.id) return err('Cannot move @everyone.');
      if (!canManageRole(guild, args.role)) return err('That role sits above my highest role.');
      const ceiling = guild.members.me.roles.highest.position - 1;
      const target = Math.max(1, Math.min(args.position, ceiling));
      await args.role.setPosition(target).catch(() => {});
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
      const perms = role.permissions.toArray();
      const notable = perms.filter((p) => ['Administrator', 'ManageGuild', 'ManageChannels', 'ManageRoles', 'ManageMessages', 'KickMembers', 'BanMembers', 'ModerateMembers', 'MentionEveryone'].includes(p));
      return ok({
        components: [{ type: 17, accent_color: role.color || 0x2b2d31, components: [
          { type: 10, content: `## ${role.name}\n-# id: \`${role.id}\`\ncolour: ${role.hexColor}\nposition: ${role.position}\nmembers: ${role.members.size}\nhoisted: ${role.hoist ? 'yes' : 'no'}\nmentionable: ${role.mentionable ? 'yes' : 'no'}\nmanaged: ${role.managed ? 'yes' : 'no'}\npermissions: ${perms.length} granted${notable.length ? `\nnotable: ${notable.join(', ')}` : ''}` },
        ] }],
      });
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
      return ok(embed({ title: `roles · ${guild.roles.cache.size - 1}`, description: listBody(lines), color: COLOR.neutral }));
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
      if (!canManageRole(guild, role)) return err('That role sits above my highest role or cannot be managed.');
      const missing = missingBotPerms(guild, null, ['ManageRoles']);
      if (missing.length) return err(`I am missing: ${missing.join(', ')}`);

      const members = await guild.members.fetch().catch(() => null);
      if (!members) return err('Could not fetch the member list.');
      const targets = members.filter((m) => !m.user.bot);
      let done = 0, skipped = 0, failed = 0;
      for (const batch of chunk([...targets.values()], 5)) {
        const results = await Promise.allSettled(
          batch.map(async (m) => {
            if (!canActOn(guild, m)) { skipped++; return; }
            if (args.action === 'add' && m.roles.cache.has(role.id)) { skipped++; return; }
            if (args.action === 'remove' && !m.roles.cache.has(role.id)) { skipped++; return; }
            await (args.action === 'add' ? m.roles.add(role) : m.roles.remove(role)).catch(() => { failed++; });
            done++;
          }),
        );
        results.forEach((r) => { if (r.status === 'rejected') failed++; });
      }
      return ok(`${args.action === 'add' ? 'Added' : 'Removed'} **${role.name}** for ${done} members${skipped ? ` (${skipped} skipped)` : ''}${failed ? `, ${failed} failed` : ''}.`);
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
      if (!canManageRole(guild, args.role)) return err('That role sits above my highest role or cannot be managed.');
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
      const snap = guild.roles.cache
        .filter((r) => r.id !== guild.id && !r.managed)
        .sort((a, b) => b.position - a.position)
        .map((r) => ({
          name: r.name,
          color: r.color,
          hoist: r.hoist,
          mentionable: r.mentionable,
          position: r.position,
          permissions: r.permissions.bitfield.toString(),
        }));
      cfg.roleBackups[key] = snap;
      saveGuild(guild.id, cfg);
      return ok(`Saved ${snap.length} roles as \`${key}\`.`);
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
      const missing = missingBotPerms(guild, null, ['ManageRoles']);
      if (missing.length) return err(`I am missing: ${missing.join(', ')}`);

      let made = 0, skipped = 0, failed = 0;
      for (const r of snap) {
        if (guild.roles.cache.some((x) => x.name === r.name)) { skipped++; continue; }
        try {
          await guild.roles.create({
            name: r.name,
            color: r.color,
            hoist: r.hoist,
            mentionable: r.mentionable,
            permissions: BigInt(r.permissions),
            reason: 'role restore',
          }).catch(() => { failed++; });
          made++;
        } catch { failed++; }
      }
      return ok(`Restored ${made} missing roles from \`${key}\`${skipped ? ` (${skipped} already existed)` : ''}.`);
    },
  },
];

import { guildCfg, saveGuild } from '../../lib/db.js';
import { chunk } from '../../lib/util.js';
import { needMember, needRole, shortRole } from './_helpers.js';

function color(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return value;
  const s = String(value).replace('#', '');
  if (/^[0-9a-f]{6}$/i.test(s)) return parseInt(s, 16);
  if (/^[0-9a-f]{3}$/i.test(s)) return parseInt(s.split('').map((c) => c + c).join(''), 16);
  throw new Error(`bad colour: ${value}`);
}

export default {
  role: {
    perm: 'ManageRoles',
    desc: 'roles and permissions',
    verbs: {
      create: {
        d: 'Create a role',
        p: { name: 'string!', color: 'string', hoist: 'bool', mentionable: 'bool' },
        run: async (guild, p) => {
          const role = await guild.roles.create({
            name: p.name,
            color: color(p.color),
            hoist: !!p.hoist,
            mentionable: !!p.mentionable,
            reason: 'wellix',
          });
          return `created ${shortRole(role)}`;
        },
      },

      delete: {
        d: 'Delete a role',
        p: { role: 'role!' },
        danger: 'high',
        run: async (guild, p) => {
          const role = await needRole(guild, p.role);
          if (role.managed) throw new Error('managed role, remove the integration');
          await role.delete('wellix');
          return `deleted ${role.name}`;
        },
      },

      clone: {
        d: 'Clone a role with the same permissions',
        p: { role: 'role!', name: 'string' },
        run: async (guild, p) => {
          const source = await needRole(guild, p.role);
          const role = await guild.roles.create({
            name: p.name || `${source.name} copy`,
            color: source.color,
            hoist: source.hoist,
            mentionable: source.mentionable,
            permissions: source.permissions.bitfield,
            reason: 'clone',
          });
          return `cloned into ${shortRole(role)}`;
        },
      },

      rename: {
        d: 'Rename a role',
        p: { role: 'role!', name: 'string!' },
        run: async (guild, p) => {
          const role = await needRole(guild, p.role);
          await role.setName(p.name);
          return `renamed to ${role.name}`;
        },
      },

      setColor: {
        d: 'Set a role colour',
        p: { role: 'role!', color: 'string!' },
        run: async (guild, p) => {
          const role = await needRole(guild, p.role);
          await role.setColor(color(p.color));
          return `${role.name} is now ${role.hexColor}`;
        },
      },

      setHoist: {
        d: 'Show role separately in the member list',
        p: { role: 'role!', hoist: 'bool!' },
        run: async (guild, p) => {
          const role = await needRole(guild, p.role);
          await role.setHoist(p.hoist);
          return `hoist=${role.hoist}`;
        },
      },

      setMentionable: {
        d: 'Toggle role mentions',
        p: { role: 'role!', mentionable: 'bool!' },
        run: async (guild, p) => {
          const role = await needRole(guild, p.role);
          await role.setMentionable(p.mentionable);
          return `mentionable=${role.mentionable}`;
        },
      },

      setPosition: {
        d: 'Move a role',
        p: { role: 'role!', position: 'int!' },
        run: async (guild, p) => {
          const role = await needRole(guild, p.role);
          const ceiling = guild.members.me.roles.highest.position - 1;
          await role.setPosition(Math.min(p.position, ceiling));
          return `${role.name} at ${role.position}`;
        },
      },

      add: {
        d: 'Give a role to a member',
        p: { member: 'member!', role: 'role!' },
        run: async (guild, p) => {
          const member = await needMember(guild, p.member);
          const role = await needRole(guild, p.role);
          await member.roles.add(role);
          return `gave ${role.name} to ${member.user.tag}`;
        },
      },

      remove: {
        d: 'Take a role from a member',
        p: { member: 'member!', role: 'role!' },
        run: async (guild, p) => {
          const member = await needMember(guild, p.member);
          const role = await needRole(guild, p.role);
          await member.roles.remove(role);
          return `removed ${role.name} from ${member.user.tag}`;
        },
      },

      addAll: {
        d: 'Give a role to every human member',
        p: { role: 'role!' },
        run: async (guild, p) => {
          const role = await needRole(guild, p.role);
          if (role.position >= guild.members.me.roles.highest.position) throw new Error('role above mine');
          const members = await guild.members.fetch();
          let n = 0;
          for (const batch of chunk([...members.filter((m) => !m.user.bot).values()], 5)) {
            const results = await Promise.allSettled(batch.map((m) => m.roles.add(role)));
            n += results.filter((r) => r.status === 'fulfilled').length;
          }
          return `added to ${n} members`;
        },
      },

      removeAll: {
        d: 'Remove a role from every member',
        p: { role: 'role!' },
        run: async (guild, p) => {
          const role = await needRole(guild, p.role);
          const members = await guild.members.fetch();
          let n = 0;
          for (const batch of chunk([...members.values()], 5)) {
            const results = await Promise.allSettled(batch.map((m) => m.roles.remove(role)));
            n += results.filter((r) => r.status === 'fulfilled').length;
          }
          return `removed from ${n} members`;
        },
      },

      list: {
        d: 'List roles with member counts',
        p: {},
        run: async (guild) =>
          [...guild.roles.cache.values()]
            .filter((r) => r.id !== guild.id)
            .sort((a, b) => b.position - a.position)
            .map((r) => `${r.name} (${r.id}) pos=${r.position} members=${r.members.size}`)
            .join('\n') || 'no roles',
      },

      info: {
        d: 'Role details',
        p: { role: 'role!' },
        run: async (guild, p) => {
          const role = await needRole(guild, p.role);
          return `${role.name} id=${role.id} color=${role.hexColor} pos=${role.position} hoist=${role.hoist} mentionable=${role.mentionable} members=${role.members.size} perms=${role.permissions.toArray().join(',') || 'none'}`;
        },
      },

      backup: {
        d: 'Snapshot all roles',
        p: { name: 'string' },
        run: async (guild, p) => {
          const cfg = guildCfg(guild.id);
          const key = (p.name || 'default').toLowerCase();
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
          return `saved ${cfg.roleBackups[key].length} roles as ${key}`;
        },
      },

      restore: {
        d: 'Recreate missing roles from a backup',
        p: { name: 'string' },
        run: async (guild, p) => {
          const cfg = guildCfg(guild.id);
          const key = (p.name || 'default').toLowerCase();
          const snapshot = cfg.roleBackups?.[key];
          if (!snapshot) throw new Error(`no backup named ${key}`);
          let made = 0;
          for (const saved of snapshot) {
            if (guild.roles.cache.some((r) => r.name === saved.name)) continue;
            await guild.roles
              .create({
                name: saved.name,
                color: saved.color,
                hoist: saved.hoist,
                mentionable: saved.mentionable,
                permissions: BigInt(saved.permissions),
                reason: 'restore',
              })
              .then(() => made++)
              .catch(() => {});
          }
          return `restored ${made} roles`;
        },
      },

      grantPerm: {
        d: 'Grant one permission to a role',
        p: { role: 'role!', permission: 'string!' },
        run: async (guild, p) => {
          const role = await needRole(guild, p.role);
          await role.setPermissions(role.permissions.add(p.permission));
          return `${p.permission} granted to ${role.name}`;
        },
      },

      revokePerm: {
        d: 'Revoke one permission from a role',
        p: { role: 'role!', permission: 'string!' },
        run: async (guild, p) => {
          const role = await needRole(guild, p.role);
          await role.setPermissions(role.permissions.remove(p.permission));
          return `${p.permission} revoked from ${role.name}`;
        },
      },
    },
  },
};

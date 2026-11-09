export const U = (name, description, required = false) => ({ name, type: 'user', description, required });
export const M = (name, description, required = false) => ({ name, type: 'member', description, required });
export const R = (name, description, required = false) => ({ name, type: 'role', description, required });
export const C = (name, description, required = false) => ({ name, type: 'channel', description, required });
export const S = (name, description, required = false, extra = {}) => ({ name, type: 'string', description, required, ...extra });
export const I = (name, description, required = false, extra = {}) => ({ name, type: 'int', description, required, ...extra });
export const N = (name, description, required = false, extra = {}) => ({ name, type: 'num', description, required, ...extra });
export const B = (name, description, required = false) => ({ name, type: 'bool', description, required });
export const A = (name, description, required = false) => ({ name, type: 'attach', description, required });

export const E = (name, description, values, required = false) => ({
  name,
  type: 'string',
  description,
  required,
  choices: values.map((v) => ({ name: v, value: v })),
});

export function requireStaff(member, level = 'mod') {
  if (!member) return false;
  if (member.id === member.guild.ownerId) return true;
  if (member.permissions.has('Administrator')) return true;
  if (level === 'admin') return member.permissions.has('ManageGuild');
  return member.permissions.any(['ManageMessages', 'ModerateMembers', 'KickMembers', 'BanMembers']);
}

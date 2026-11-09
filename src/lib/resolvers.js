import { idFrom } from './util.js';

export async function resolveMember(guild, input) {
  if (!input) return null;

  if (typeof input === 'object' && input.id) {
    if (input.guildId === guild.id) return input;
    const cached = guild.members.cache.get(input.id);
    if (cached) return cached;
    return guild.members.fetch(input.id).catch(() => null);
  }

  const raw = String(input).trim();
  const id = idFrom(raw);
  if (id) {
    const byId = await guild.members.fetch(id).catch(() => null);
    if (byId) return byId;
  }

  const q = raw.replace(/^@/, '').toLowerCase();
  if (!q) return null;

  const exact = guild.members.cache.find(
    (m) => m.user.username.toLowerCase() === q || m.displayName.toLowerCase() === q || m.user.tag.toLowerCase() === q,
  );
  if (exact) return exact;

  const found = await guild.members.fetch({ query: q, limit: 10 }).catch(() => null);
  if (!found?.size) return null;
  return (
    found.find((m) => m.user.username.toLowerCase() === q || m.displayName.toLowerCase() === q) || found.first()
  );
}

export async function resolveRole(guild, input) {
  if (!input) return null;
  if (typeof input === 'object' && input.id) return input;
  const raw = String(input).trim();
  const id = idFrom(raw);
  if (id) return guild.roles.cache.get(id) || (await guild.roles.fetch(id).catch(() => null));
  const q = raw.replace(/^@/, '').toLowerCase();
  return guild.roles.cache.find((r) => r.name.toLowerCase() === q) || null;
}

export async function resolveChannel(guild, input) {
  if (!input) return null;
  if (typeof input === 'object' && input.id) return input;
  const raw = String(input).trim();
  const id = idFrom(raw);
  if (id) return guild.channels.cache.get(id) || (await guild.channels.fetch(id).catch(() => null));
  const q = raw.replace(/^#/, '').toLowerCase();
  return guild.channels.cache.find((c) => c.name.toLowerCase() === q) || null;
}

export async function resolveUser(client, input) {
  if (!input) return null;
  if (typeof input === 'object' && input.id) return input;
  const id = idFrom(input);
  if (!id) return null;
  return client.users.cache.get(id) || (await client.users.fetch(id).catch(() => null));
}

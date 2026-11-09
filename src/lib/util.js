export const UNIT = {
  ms: 1,
  s: 1000,
  m: 60000,
  h: 3600000,
  d: 86400000,
  w: 604800000,
  mo: 2592000000,
  y: 31536000000,
};

// "7d", "1h30m", "30" (minutes). empty -> 0.
export function parseDuration(input) {
  if (input == null) return 0;
  if (typeof input === 'number') return input;
  const s = String(input).trim().toLowerCase();
  if (!s) return 0;
  if (/^\d+$/.test(s)) return Number(s) * UNIT.m;

  let total = 0;
  const re = /(\d+(?:\.\d+)?)\s*(mo|min|ms|s|m|h|d|w|y)/g;
  let hit;
  while ((hit = re.exec(s))) {
    const n = Number(hit[1]);
    const unit = hit[2] === 'min' ? 'm' : hit[2];
    total += n * (UNIT[unit] || 0);
  }
  return Math.round(total);
}

export function fmtDuration(ms) {
  const abs = Math.abs(ms);
  if (abs < UNIT.s) return '0s';
  const parts = [];
  let rest = abs;
  for (const [unit, size] of [['y', UNIT.y], ['mo', UNIT.mo], ['d', UNIT.d], ['h', UNIT.h], ['m', UNIT.m], ['s', UNIT.s]]) {
    const n = Math.floor(rest / size);
    if (n) {
      parts.push(`${n}${unit}`);
      rest -= n * size;
    }
    if (parts.length === 2) break;
  }
  return parts.join(' ');
}

export function truncate(str, max = 1000) {
  const s = String(str ?? '');
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

export function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function idFrom(raw) {
  if (!raw) return null;
  const m = String(raw).match(/\d{16,20}/);
  return m ? m[0] : null;
}

export function unix(date) {
  return Math.floor(new Date(date).getTime() / 1000);
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

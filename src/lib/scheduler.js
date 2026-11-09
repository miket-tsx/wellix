import { db, save } from './db.js';

const timers = new Map();
let handlers = {};

export function setHandlers(map) {
  handlers = map;
}

function arm(job) {
  const wait = Math.max(0, Number(job.runAt) - Date.now());
  const MAX = 2 ** 31 - 1;

  const timer = setTimeout(
    () => {
      if (wait > MAX) return arm(job);
      fire(job);
    },
    Math.min(wait, MAX),
  );
  timers.set(job.id, timer);
}

async function fire(job) {
  timers.delete(job.id);
  const jobs = db.get('jobs', []);
  db.set('jobs', jobs.filter((j) => j.id !== job.id));

  const fn = handlers[job.type];
  if (!fn) return;
  try {
    await fn(job);
  } catch (err) {
    console.error(`[scheduler] ${job.type} failed:`, err.message);
  }
}

export function schedule(job) {
  const entry = {
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    ...job,
  };
  const jobs = db.get('jobs', []);
  jobs.push(entry);
  db.set('jobs', jobs);
  arm(entry);
  return entry;
}

export function cancel(id) {
  const timer = timers.get(id);
  if (timer) clearTimeout(timer);
  timers.delete(id);
  db.set('jobs', db.get('jobs', []).filter((j) => j.id !== id));
}

export function jobsFor(guildId) {
  return db.get('jobs', []).filter((j) => j.guildId === guildId);
}

export function restore() {
  for (const job of db.get('jobs', [])) {
    if (job.runAt <= Date.now()) fire(job);
    else arm(job);
  }
}

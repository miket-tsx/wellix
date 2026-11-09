import {
  addFeature,
  findFeature,
  listFeatures,
  removeFeature,
  runSpec,
  toggleFeature,
} from '../../features/scripted.js';

function parseSpec(input) {
  if (!input) throw new Error('spec is required');
  if (typeof input === 'string') {
    try {
      return JSON.parse(input);
    } catch {
      throw new Error('spec is not valid json');
    }
  }
  return input;
}

export default {
  feature: {
    perm: 'ManageGuild',
    desc: 'self written event features',
    verbs: {
      create: {
        d: 'Create an event driven feature from a spec object',
        p: { spec: 'json!' },
        run: async (guild, p) => {
          const spec = parseSpec(p.spec);
          const { error, feature } = addFeature(guild.id, spec);
          if (error) throw new Error(error);
          return `feature ${feature.id} saved (on=${feature.on}, ${feature.actions.length} actions)`;
        },
      },
      list: {
        d: 'List features',
        p: {},
        run: async (guild) => {
          const features = listFeatures(guild.id);
          return features.map((f) => `${f.id} on=${f.on} enabled=${f.enabled} :: ${f.name}`).join('\n') || 'none';
        },
      },
      describe: {
        d: 'Show one feature spec',
        p: { id: 'string!' },
        run: async (guild, p) => {
          const feature = findFeature(guild.id, p.id);
          if (!feature) throw new Error('feature not found');
          return JSON.stringify(feature);
        },
      },
      delete: {
        d: 'Delete a feature',
        p: { id: 'string!' },
        run: async (guild, p) => {
          return removeFeature(guild.id, p.id) ? 'deleted' : 'feature not found';
        },
      },
      enable: {
        d: 'Enable a feature',
        p: { id: 'string!' },
        run: async (guild, p) => {
          const f = toggleFeature(guild.id, p.id, true);
          if (!f) throw new Error('feature not found');
          return `${f.id} enabled`;
        },
      },
      disable: {
        d: 'Disable a feature',
        p: { id: 'string!' },
        run: async (guild, p) => {
          const f = toggleFeature(guild.id, p.id, false);
          if (!f) throw new Error('feature not found');
          return `${f.id} disabled`;
        },
      },
      test: {
        d: 'Run a feature once against you',
        p: { id: 'string!' },
        run: async (guild, p, ctx) => {
          const feature = findFeature(guild.id, p.id);
          if (!feature) throw new Error('feature not found');
          const done = await runSpec(guild, feature, { member: ctx.actor });
          return `ran ${done.length} actions`;
        },
      },
    },
  },
};

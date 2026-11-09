import channel from './channel.js';
import messaging from './messaging.js';
import member from './member.js';
import role from './role.js';
import server from './server.js';
import automation from './automation.js';
import ticket from './ticket.js';
import feature from './feature.js';

export const RES = Object.assign({}, channel, messaging, member, role, server, automation, ticket, feature);
export default RES;

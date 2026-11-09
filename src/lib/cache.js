const snipes = new Map();
const edits = new Map();

export const cache = {
  sniped(channelId, message) {
    if (!message.content && !message.attachments.size) return;
    snipes.set(channelId, {
      content: message.content,
      author: message.author,
      at: Date.now(),
      attachments: [...message.attachments.values()].map((a) => a.url),
    });
  },

  edited(channelId, oldMessage, newMessage) {
    if (!oldMessage?.content || oldMessage.content === newMessage.content) return;
    edits.set(channelId, {
      before: oldMessage.content,
      after: newMessage.content,
      author: newMessage.author,
      at: Date.now(),
    });
  },

  snipe(channelId) {
    return snipes.get(channelId) || null;
  },

  edit(channelId) {
    return edits.get(channelId) || null;
  },
};

const lastActionByConversation = new Map();

export function shouldSendIsaAction(conversationId, action) {
  if (!conversationId || !action) {
    return false;
  }

  return lastActionByConversation.get(String(conversationId)) !== action;
}

export function rememberIsaAction(conversationId, action) {
  if (!conversationId || !action) {
    return;
  }

  lastActionByConversation.set(String(conversationId), action);
}

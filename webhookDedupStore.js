const ENTRY_TTL_MS = 10 * 60 * 1000;
const processedEvents = new Map();

function pruneExpiredEntries() {
  const now = Date.now();

  for (const [key, expiresAt] of processedEvents.entries()) {
    if (expiresAt <= now) {
      processedEvents.delete(key);
    }
  }
}

function buildKey({ deliveryId, event, conversationId, status, messageId }) {
  return JSON.stringify({
    deliveryId: deliveryId || null,
    event: event || null,
    conversationId: conversationId || null,
    status: status || null,
    messageId: messageId || null,
  });
}

export function hasProcessedWebhook(keyData) {
  pruneExpiredEntries();
  const key = buildKey(keyData);
  const expiresAt = processedEvents.get(key);

  if (!expiresAt) {
    return false;
  }

  if (expiresAt <= Date.now()) {
    processedEvents.delete(key);
    return false;
  }

  return true;
}

export function rememberProcessedWebhook(keyData) {
  pruneExpiredEntries();
  processedEvents.set(buildKey(keyData), Date.now() + ENTRY_TTL_MS);
}

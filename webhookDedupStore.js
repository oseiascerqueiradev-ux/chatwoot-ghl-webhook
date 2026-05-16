const ENTRY_TTL_MS = 10 * 60 * 1000;
const processedEvents = new Map();
const processingEvents = new Map();

function pruneExpiredEntries() {
  const now = Date.now();

  for (const [key, expiresAt] of processedEvents.entries()) {
    if (expiresAt <= now) {
      processedEvents.delete(key);
    }
  }

  for (const [key, expiresAt] of processingEvents.entries()) {
    if (expiresAt <= now) {
      processingEvents.delete(key);
    }
  }
}

function buildKey({ deliveryId, event, conversationId, status, messageId }) {
  if (event === "message_created" && messageId) {
    return JSON.stringify({
      event,
      conversationId: conversationId || null,
      messageId,
    });
  }

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

export function claimWebhookProcessing(keyData) {
  pruneExpiredEntries();
  const key = buildKey(keyData);

  if (processedEvents.has(key) || processingEvents.has(key)) {
    return false;
  }

  processingEvents.set(key, Date.now() + ENTRY_TTL_MS);
  return true;
}

export function releaseWebhookProcessing(keyData) {
  processingEvents.delete(buildKey(keyData));
}

export function rememberProcessedWebhook(keyData) {
  pruneExpiredEntries();
  const key = buildKey(keyData);
  processingEvents.delete(key);
  processedEvents.set(key, Date.now() + ENTRY_TTL_MS);
}

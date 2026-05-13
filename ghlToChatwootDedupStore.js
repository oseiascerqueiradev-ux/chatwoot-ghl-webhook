const DEFAULT_TTL_MS = 10 * 60 * 1000;
const processed = new Map();

function now() {
  return Date.now();
}

function cleanupExpired() {
  const cutoff = now();

  for (const [key, expiresAt] of processed.entries()) {
    if (expiresAt <= cutoff) {
      processed.delete(key);
    }
  }
}

export function buildGhlToChatwootDedupKey({ event, contactId, conversationId, messageId, content }) {
  return [
    event || "event",
    contactId || "sem-contato",
    conversationId || "sem-conversa",
    messageId || String(content || "").slice(0, 120),
  ].join(":");
}

export function hasProcessedGhlToChatwoot(key) {
  cleanupExpired();
  return processed.has(key);
}

export function rememberProcessedGhlToChatwoot(key, ttlMs = DEFAULT_TTL_MS) {
  if (!key) {
    return;
  }

  cleanupExpired();
  processed.set(key, now() + ttlMs);
}

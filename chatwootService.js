import { logger } from "./logger.js";

function getBaseUrl() {
  return process.env.CHATWOOT_BASE_URL;
}

function getApiToken() {
  return process.env.CHATWOOT_API_TOKEN;
}

function headers() {
  return {
    "Content-Type": "application/json",
    api_access_token: getApiToken(),
  };
}

async function chatwootFetch(path, options = {}) {
  const url = `${getBaseUrl()}${path}`;
  const res = await fetch(url, { headers: headers(), ...options });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Chatwoot API erro ${res.status} em ${path}: ${body}`);
  }

  return res.json();
}

function unwrapPayload(data) {
  if (Array.isArray(data?.payload)) {
    return data.payload;
  }

  if (Array.isArray(data?.data?.payload)) {
    return data.data.payload;
  }

  return [];
}

export async function getConversationDetails(accountId, conversationId) {
  logger.debug(`Buscando conversa ${conversationId}`);
  return chatwootFetch(`/api/v1/accounts/${accountId}/conversations/${conversationId}`);
}

export async function getConversationMessages(accountId, conversationId) {
  logger.debug(`Buscando mensagens da conversa ${conversationId}`);
  const data = await chatwootFetch(
    `/api/v1/accounts/${accountId}/conversations/${conversationId}/messages`
  );
  const msgs = data?.payload || [];
  return msgs.sort((a, b) => a.created_at - b.created_at);
}

export async function searchChatwootContacts(accountId, query) {
  if (!query) {
    return [];
  }

  const params = new URLSearchParams({ q: String(query) });
  const data = await chatwootFetch(`/api/v1/accounts/${accountId}/contacts/search?${params}`);
  return unwrapPayload(data);
}

export async function createChatwootContact(accountId, data) {
  const payload = {
    inbox_id: Number(process.env.CHATWOOT_GHL_INBOX_ID),
    name: data.name || "Lead GHL",
    identifier: data.identifier,
    custom_attributes: data.customAttributes || {},
    additional_attributes: data.additionalAttributes || {},
  };

  if (data.phone) {
    payload.phone_number = data.phone;
  }

  if (data.email) {
    payload.email = data.email;
  }

  logger.info("Criando contato no Chatwoot a partir do GHL", {
    hasPhone: Boolean(payload.phone_number),
    hasEmail: Boolean(payload.email),
    identifier: payload.identifier,
  });

  return chatwootFetch(`/api/v1/accounts/${accountId}/contacts`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function getContactConversations(accountId, contactId) {
  const data = await chatwootFetch(`/api/v1/accounts/${accountId}/contacts/${contactId}/conversations`);
  return unwrapPayload(data);
}

export async function createChatwootConversation(accountId, data) {
  const payload = {
    source_id: data.sourceId,
    inbox_id: Number(process.env.CHATWOOT_GHL_INBOX_ID),
    contact_id: data.contactId,
    status: data.status || "open",
    custom_attributes: data.customAttributes || {},
    additional_attributes: data.additionalAttributes || {},
  };

  logger.info("Criando conversa no Chatwoot a partir do GHL", {
    contactId: data.contactId,
    sourceId: data.sourceId,
  });

  return chatwootFetch(`/api/v1/accounts/${accountId}/conversations`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function createChatwootMessage(accountId, conversationId, data) {
  const payload = {
    content: data.content,
    message_type: data.messageType || "incoming",
    private: Boolean(data.private),
    content_type: "text",
    content_attributes: data.contentAttributes || {},
  };

  logger.info("Criando mensagem no Chatwoot a partir do GHL", {
    conversationId,
    messageType: payload.message_type,
    isPrivate: payload.private,
  });

  return chatwootFetch(`/api/v1/accounts/${accountId}/conversations/${conversationId}/messages`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

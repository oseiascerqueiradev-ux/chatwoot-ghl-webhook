import { logger } from "./logger.js";

const BASE_URL = "https://services.leadconnectorhq.com";

function getGhlAccessToken() {
  return process.env.GHL_PRIVATE_INTEGRATION_TOKEN || process.env.GHL_API_KEY;
}

function ghlHeaders() {
  return {
    Authorization: `Bearer ${getGhlAccessToken()}`,
    "Content-Type": "application/json",
    Version: "2021-07-28",
    locationId: process.env.GHL_LOCATION_ID,
  };
}

async function ghlFetch(path, options = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: ghlHeaders(),
    ...options,
  });

  const text = await response.text();
  let data = null;

  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }

  if (!response.ok) {
    throw new Error(`GHL API erro ${response.status} em ${path}: ${text}`);
  }

  return data;
}

export async function ghlSearchContacts(params = {}) {
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value != null && String(value).trim() !== "") {
      query.set(key, String(value));
    }
  }

  const suffix = query.toString() ? `?${query.toString()}` : "";
  const data = await ghlFetch(`/contacts/${suffix}`, {
    method: "GET",
  });

  return Array.isArray(data?.contacts) ? data.contacts : [];
}

function extractContactId(payload) {
  return (
    payload?.contact?.id ||
    payload?.data?.contact?.id ||
    payload?.data?.id ||
    payload?.id ||
    null
  );
}

function buildCustomFields(data) {
  const customFields = [];

  if (data.conversationId) {
    customFields.push({
      key: "chatwoot_conversation_id",
      field_value: String(data.conversationId),
    });
  }

  if (data.channel) {
    customFields.push({
      key: "chatwoot_canal",
      field_value: data.channel,
    });
  }

  if (data.labels?.length) {
    customFields.push({
      key: "chatwoot_labels",
      field_value: data.labels.join(", "),
    });
  }

  if (data.status) {
    customFields.push({
      key: "chatwoot_status",
      field_value: data.status,
    });
  }

  if (data.inboxId != null) {
    customFields.push({
      key: "chatwoot_inbox_id",
      field_value: String(data.inboxId),
    });
  }

  if (data.assigneeName) {
    customFields.push({
      key: "chatwoot_responsavel",
      field_value: data.assigneeName,
    });
  }

  if (data.lastMessageAt) {
    customFields.push({
      key: "chatwoot_ultima_mensagem_em",
      field_value: data.lastMessageAt,
    });
  }

  if (data.lastMessageDirection) {
    customFields.push({
      key: "chatwoot_ultima_direcao",
      field_value: data.lastMessageDirection,
    });
  }

  return customFields;
}

export async function upsertContact(data) {
  const payload = {
    locationId: process.env.GHL_LOCATION_ID,
    firstName: data.name || "Lead Chatwoot",
  };

  if (data.phone) {
    payload.phone = data.phone;
  }

  if (data.email) {
    payload.email = data.email;
  }

  const customFields = buildCustomFields(data);
  if (customFields.length > 0) {
    payload.customFields = customFields;
  }

  logger.info("Enviando contato para o GHL", {
    hasPhone: Boolean(payload.phone),
    hasEmail: Boolean(payload.email),
    conversationId: data.conversationId,
  });

  const result = await ghlFetch("/contacts/upsert", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  const contactId = extractContactId(result);
  if (!contactId) {
    throw new Error(
      `Nao foi possivel identificar o contactId retornado pelo GHL: ${JSON.stringify(result)}`
    );
  }

  return { contactId, raw: result };
}

export async function createContactNote(contactId, body) {
  logger.debug(`Criando nota para o contato ${contactId}`);

  return ghlFetch(`/contacts/${contactId}/notes`, {
    method: "POST",
    body: JSON.stringify({ body }),
  });
}

export async function addContactTags(contactId, tags) {
  const uniqueTags = [...new Set((tags || []).filter(Boolean))];

  if (!uniqueTags.length) {
    return null;
  }

  logger.info("Adicionando tags ao contato no GHL", {
    contactId,
    tagCount: uniqueTags.length,
  });

  return ghlFetch(`/contacts/${contactId}/tags`, {
    method: "POST",
    body: JSON.stringify({ tags: uniqueTags }),
  });
}

function shouldEnableOpportunitySync() {
  return String(process.env.ENABLE_GHL_OPPORTUNITY_SYNC || "").toLowerCase() === "true";
}

function normalizeOpportunityTimestamp(opportunity) {
  const value =
    opportunity?.updatedAt ||
    opportunity?.lastStatusChangeAt ||
    opportunity?.lastStageChangeAt ||
    opportunity?.createdAt ||
    null;

  if (!value) {
    return 0;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

async function findOpenOpportunitiesForContact({ contactId, pipelineId }) {
  const locationId = process.env.GHL_LOCATION_ID;
  const data = await ghlFetch(`/opportunities/search?locationId=${locationId}`, {
    method: "POST",
    body: JSON.stringify({
      locationId,
      limit: 500,
    }),
  });

  const opportunities = Array.isArray(data?.opportunities) ? data.opportunities : [];
  return opportunities
    .filter(
      (opportunity) =>
        opportunity.contactId === contactId &&
        opportunity.pipelineId === pipelineId &&
        String(opportunity.status || "").toLowerCase() === "open"
    )
    .sort((a, b) => normalizeOpportunityTimestamp(b) - normalizeOpportunityTimestamp(a));
}

export async function findOpenOpportunitiesByContactId(contactId) {
  const locationId = process.env.GHL_LOCATION_ID;
  const data = await ghlFetch(`/opportunities/search?locationId=${locationId}`, {
    method: "POST",
    body: JSON.stringify({
      locationId,
      limit: 500,
    }),
  });

  const opportunities = Array.isArray(data?.opportunities) ? data.opportunities : [];
  return opportunities
    .filter(
      (opportunity) =>
        opportunity.contactId === contactId &&
        String(opportunity.status || "").toLowerCase() === "open"
    )
    .sort((a, b) => normalizeOpportunityTimestamp(b) - normalizeOpportunityTimestamp(a));
}

export async function findContactByPhoneOrEmail({ phone, email }) {
  const candidates = [];

  if (phone) {
    candidates.push(...(await ghlSearchContacts({ locationId: process.env.GHL_LOCATION_ID, query: phone })));
  }

  if (!candidates.length && email) {
    candidates.push(...(await ghlSearchContacts({ locationId: process.env.GHL_LOCATION_ID, query: email })));
  }

  return candidates[0] || null;
}

async function markOpportunityAsLost(opportunityId) {
  logger.info("Marcando oportunidade duplicada como perdida no GHL", {
    opportunityId,
  });

  return ghlFetch(`/opportunities/${opportunityId}`, {
    method: "PUT",
    body: JSON.stringify({
      status: "lost",
    }),
  });
}

function getMappedStageId(status) {
  const normalizedStatus = String(status || "").toLowerCase();

  if (normalizedStatus === "open") {
    return process.env.GHL_OPPORTUNITY_STAGE_ID_OPEN || null;
  }

  if (normalizedStatus === "pending") {
    return process.env.GHL_OPPORTUNITY_STAGE_ID_PENDING || null;
  }

  if (normalizedStatus === "resolved") {
    return process.env.GHL_OPPORTUNITY_STAGE_ID_RESOLVED || null;
  }

  return null;
}

export async function updateOpportunityFromChatwoot(opportunityId, { status, conversationId }) {
  const mappedStageId = getMappedStageId(status);

  if (!mappedStageId) {
    logger.info("Nenhum stage mapeado para o status do Chatwoot; mantendo oportunidade atual", {
      opportunityId,
      conversationId,
      status,
    });
    return null;
  }

  logger.info("Atualizando oportunidade no GHL a partir do status do Chatwoot", {
    opportunityId,
    conversationId,
    status,
    mappedStageId,
  });

  return ghlFetch(`/opportunities/${opportunityId}`, {
    method: "PUT",
    body: JSON.stringify({
      pipelineStageId: mappedStageId,
      status: "open",
    }),
  });
}

export async function createOpportunityForContact({
  contactId,
  conversationId,
  contactName,
  channel,
  status,
}) {
  if (!shouldEnableOpportunitySync()) {
    return null;
  }

  const pipelineId = process.env.GHL_OPPORTUNITY_PIPELINE_ID;
  const pipelineStageId = process.env.GHL_OPPORTUNITY_STAGE_ID;

  if (!pipelineId || !pipelineStageId) {
    logger.warn("Sync de oportunidade ativado sem pipeline/stage configurados; ignorando criacao", {
      contactId,
      conversationId,
    });
    return null;
  }

  const openOpportunities = await findOpenOpportunitiesForContact({ contactId, pipelineId });
  const [existingOpportunity, ...duplicates] = openOpportunities;

  for (const duplicate of duplicates) {
    try {
      await markOpportunityAsLost(duplicate.id);
    } catch (error) {
      logger.warn("Falha ao encerrar oportunidade duplicada no GHL", {
        contactId,
        conversationId,
        opportunityId: duplicate.id,
        error: error.message,
      });
    }
  }

  if (existingOpportunity) {
    logger.info("Oportunidade aberta ja existe para o contato no pipeline; reutilizando", {
      contactId,
      conversationId,
      opportunityId: existingOpportunity.id,
      pipelineId,
      duplicateCount: duplicates.length,
    });
    return existingOpportunity;
  }

  const nameParts = [
    contactName || "Lead Chatwoot",
    channel ? `[${channel}]` : null,
    conversationId ? `Conversa ${conversationId}` : null,
  ].filter(Boolean);

  const payload = {
    locationId: process.env.GHL_LOCATION_ID,
    contactId,
    pipelineId,
    pipelineStageId,
    status: "open",
    name: nameParts.join(" "),
    source: "Chatwoot",
  };

  logger.info("Criando oportunidade no GHL", {
    contactId,
    conversationId,
    pipelineId,
    pipelineStageId,
  });

  return ghlFetch("/opportunities/", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function sendConversationMessage({ contactId, conversationId, message, messageType }) {
  logger.info("Enviando mensagem do Chatwoot para o GHL", {
    contactId,
    conversationId,
    messageType,
  });

  const payload = {
    type: messageType || "SMS",
    message,
  };

  if (contactId) {
    payload.contactId = contactId;
  }

  if (conversationId) {
    payload.conversationId = conversationId;
  }

  // Inferencia a partir dos docs do endpoint de mensagens do GHL:
  // o endpoint aceita identificadores da conversa/contato e o conteudo textual.
  return ghlFetch("/conversations/messages", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

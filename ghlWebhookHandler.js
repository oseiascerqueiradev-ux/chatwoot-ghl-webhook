import {
  createChatwootContact,
  createChatwootConversation,
  createChatwootMessage,
  getContactConversations,
  searchChatwootContacts,
} from "./chatwootService.js";
import {
  buildGhlToChatwootDedupKey,
  hasProcessedGhlToChatwoot,
  rememberProcessedGhlToChatwoot,
} from "./ghlToChatwootDedupStore.js";
import { logger } from "./logger.js";

function pick(body, paths) {
  for (const path of paths) {
    const value = path.split(".").reduce((current, key) => current?.[key], body);
    if (value != null && typeof value !== "object" && String(value).trim() !== "") {
      return value;
    }
  }

  return null;
}

function normalizePhone(value) {
  if (!value) {
    return null;
  }

  const raw = String(value).trim();
  const digits = raw.replace(/\D/g, "");

  if (!digits) {
    return null;
  }

  return raw.startsWith("+") ? raw : `+${digits}`;
}

function normalizeDirection(body) {
  const raw = String(
    pick(body, [
      "direction",
      "message.direction",
      "messageDirection",
      "message_type",
      "message.type",
      "type",
    ]) || ""
  ).toLowerCase();

  if (["outbound", "outgoing", "sent", "agent", "user", "ai"].includes(raw)) {
    return "outgoing";
  }

  return "incoming";
}

function normalizeMedia(body) {
  const values = [
    pick(body, ["mediaUrl", "media_url", "attachmentUrl", "attachment_url", "fileUrl", "file_url"]),
    body.attachments,
    body.media,
    body.message?.attachments,
    body.message?.media,
    body.message?.attachment,
  ]
    .flatMap((value) => normalizeMediaInput(value))
    .filter(Boolean);

  return values
    .map((item) => {
      if (typeof item === "string") {
        return { url: item };
      }

      return {
        url: item.url || item.mediaUrl || item.media_url || item.fileUrl || item.file_url || item.link || null,
        type: item.type || item.contentType || item.content_type || item.mime_type || null,
        name: item.name || item.fileName || item.file_name || null,
      };
    })
    .filter((item) => item.url);
}

function normalizeMediaInput(value) {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return [];
    }

    if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
      try {
        const parsed = JSON.parse(trimmed);
        return Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        return [trimmed];
      }
    }

    return [trimmed];
  }

  if (typeof value === "object") {
    return [value];
  }

  return [];
}

function formatMedia(mediaItems) {
  if (!mediaItems.length) {
    return "";
  }

  return mediaItems
    .map((item, index) => {
      const type = item.type ? ` ${item.type}` : "";
      const name = item.name ? ` (${item.name})` : "";
      return `[Anexo ${index + 1}${type}${name}] ${item.url}`;
    })
    .join("\n");
}

function normalizePayload(body) {
  const contactId = pick(body, ["contactId", "contact_id", "contact.id", "contact.id"]);
  const conversationId = pick(body, [
    "conversationId",
    "conversation_id",
    "conversation.id",
    "message.conversationId",
    "message.conversation_id",
  ]);
  const messageId = pick(body, ["messageId", "message_id", "message.id", "id"]);
  const firstName = pick(body, ["firstName", "first_name", "contact.firstName", "contact.first_name"]);
  const lastName = pick(body, ["lastName", "last_name", "contact.lastName", "contact.last_name"]);
  const fullName = pick(body, ["fullName", "full_name", "name", "contact.name"]);
  const name = fullName || [firstName, lastName].filter(Boolean).join(" ") || "Lead GHL";
  const phone = normalizePhone(pick(body, ["phone", "phone_number", "contact.phone", "contact.phone_number"]));
  const email = pick(body, ["email", "contact.email"]);
  const rawContent = pick(body, [
    "message",
    "body",
    "text",
    "content",
    "message.body",
    "message.text",
    "message.content",
  ]);
  const media = normalizeMedia(body);
  const mediaText = formatMedia(media);
  const content = [rawContent, mediaText].filter(Boolean).join("\n\n") || "[Mensagem sem texto recebida do GHL]";
  const textContent = rawContent || "";
  const caption = rawContent || "";

  return {
    event: pick(body, ["event", "type", "trigger"]) || "ghl_message",
    contactId,
    conversationId,
    messageId,
    name,
    phone,
    email,
    content,
    textContent,
    caption,
    media,
    messageType: normalizeDirection(body),
    raw: body,
  };
}

function isAuthorized(req) {
  const secret = process.env.GHL_TO_CHATWOOT_WEBHOOK_SECRET;
  if (!secret) {
    return true;
  }

  return (
    req.headers["x-ghl-webhook-secret"] === secret ||
    req.headers["x-webhook-secret"] === secret ||
    req.query?.secret === secret
  );
}

function extractContactId(result) {
  return (
    result?.id ||
    result?.payload?.id ||
    result?.payload?.contact?.id ||
    result?.payload?.[0]?.id ||
    result?.contact?.id ||
    null
  );
}

function findSourceId(contact, inboxId) {
  const contactInboxes = contact?.contact_inboxes || contact?.payload?.contact?.contact_inboxes || [];
  const contactInbox = contactInboxes.find(
    (item) => String(item?.inbox?.id) === String(inboxId)
  );

  return contactInbox?.source_id || contact?.payload?.contact_inbox?.source_id || null;
}

async function findOrCreateContact(accountId, payload) {
  const inboxId = process.env.CHATWOOT_GHL_INBOX_ID;
  const identifier = payload.contactId ? `ghl:${payload.contactId}` : payload.phone || payload.email;
  const candidates = [
    payload.contactId ? `ghl:${payload.contactId}` : null,
    payload.phone,
    payload.email,
  ].filter(Boolean);

  for (const query of candidates) {
    const contacts = await searchChatwootContacts(accountId, query);
    const match = contacts.find(
      (contact) =>
        contact.identifier === identifier ||
        (payload.phone && contact.phone_number === payload.phone) ||
        (payload.email && contact.email === payload.email)
    );

    if (match?.id) {
      return {
        contactId: match.id,
        sourceId: findSourceId(match, inboxId) || identifier,
        raw: match,
      };
    }
  }

  const created = await createChatwootContact(accountId, {
    name: payload.name,
    phone: payload.phone,
    email: payload.email,
    identifier,
    customAttributes: {
      ghl_contact_id: payload.contactId || null,
      origem: "ghl",
    },
  });

  return {
    contactId: extractContactId(created),
    sourceId: findSourceId(created, inboxId) || identifier,
    raw: created,
  };
}

function findExistingConversation(conversations, payload) {
  const ghlConversationId = payload.conversationId ? String(payload.conversationId) : null;
  const sourceId = ghlConversationId ? `ghl:${ghlConversationId}` : null;

  return conversations.find((conversation) => {
    if (sourceId && conversation.source_id === sourceId) {
      return true;
    }

    if (ghlConversationId && String(conversation.custom_attributes?.ghl_conversation_id) === ghlConversationId) {
      return true;
    }

    return (
      String(conversation.inbox_id) === String(process.env.CHATWOOT_GHL_INBOX_ID) &&
      ["open", "pending"].includes(String(conversation.status || "").toLowerCase())
    );
  });
}

async function findOrCreateConversation(accountId, contactId, sourceId, payload) {
  const conversations = await getContactConversations(accountId, contactId);
  const existing = findExistingConversation(conversations, payload);

  if (existing?.id) {
    return existing;
  }

  return createChatwootConversation(accountId, {
    contactId,
    sourceId: payload.conversationId ? `ghl:${payload.conversationId}` : sourceId,
    status: "open",
    customAttributes: {
      origem: "ghl",
      ghl_contact_id: payload.contactId || null,
      ghl_conversation_id: payload.conversationId || null,
    },
  });
}

export default async function ghlWebhookHandler(req, res) {
  try {
    if (!isAuthorized(req)) {
      logger.warn("Webhook GHL -> Chatwoot rejeitado por segredo invalido");
      return res.sendStatus(401);
    }

    if (!process.env.CHATWOOT_GHL_INBOX_ID) {
      logger.warn("Webhook GHL -> Chatwoot recebido sem CHATWOOT_GHL_INBOX_ID configurado");
      return res.status(202).json({ ok: false, reason: "missing_chatwoot_ghl_inbox_id" });
    }

    const accountId = process.env.CHATWOOT_ACCOUNT_ID;
    const payload = normalizePayload(req.body || {});
    const dedupKey = buildGhlToChatwootDedupKey(payload);

    logger.info("Webhook GHL -> Chatwoot recebido", {
      event: payload.event,
      contactId: payload.contactId,
      conversationId: payload.conversationId,
      messageId: payload.messageId,
      messageType: payload.messageType,
    });

    if (hasProcessedGhlToChatwoot(dedupKey)) {
      logger.info("Webhook GHL -> Chatwoot duplicado ignorado", {
        dedupKey,
      });
      return res.sendStatus(200);
    }

    const contact = await findOrCreateContact(accountId, payload);
    if (!contact.contactId) {
      throw new Error("Nao foi possivel identificar/criar contato no Chatwoot");
    }

    const conversation = await findOrCreateConversation(accountId, contact.contactId, contact.sourceId, payload);
    if (!conversation?.id) {
      throw new Error("Nao foi possivel identificar/criar conversa no Chatwoot");
    }

    const message = await createChatwootMessage(accountId, conversation.id, {
      content: payload.content,
      textContent: payload.textContent,
      caption: payload.caption,
      messageType: payload.messageType,
      attachments: payload.media,
      contentAttributes: {
        origem: "ghl",
        ghl_contact_id: payload.contactId || null,
        ghl_conversation_id: payload.conversationId || null,
        ghl_message_id: payload.messageId || null,
        media: payload.media,
      },
    });

    rememberProcessedGhlToChatwoot(dedupKey);

    return res.status(200).json({
      ok: true,
      contactId: contact.contactId,
      conversationId: conversation.id,
      messageId: message?.id || null,
    });
  } catch (error) {
    logger.error("Erro no webhook GHL -> Chatwoot", {
      error: error.message,
      stack: error.stack,
    });
    return res.sendStatus(500);
  }
}

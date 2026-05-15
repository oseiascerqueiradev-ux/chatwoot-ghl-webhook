import { getConversationDetails, getConversationMessages } from "./chatwootService.js";
import {
  addContactTags,
  createContactNote,
  createOpportunityForContact,
  sendConversationMessage,
  updateOpportunityFromChatwoot,
  upsertContact,
} from "./ghlService.js";
import { syncIsaFromLabels } from "./isaService.js";
import { logger } from "./logger.js";
import { hasProcessedWebhook, rememberProcessedWebhook } from "./webhookDedupStore.js";

function getHeader(req, name) {
  return req.headers[name] || req.headers[name.toLowerCase()];
}

function isSupportedEvent(event) {
  return (
    event === "conversation_created" ||
    event === "message_created" ||
    event === "conversation_status_changed" ||
    event === "conversation_updated"
  );
}

function getAttachmentLabel(attachment) {
  const contentType = String(attachment.contentType || "").toLowerCase();

  if (contentType.startsWith("audio") || contentType === "mp3" || contentType === "wav") {
    return "audio";
  }

  if (contentType.startsWith("image") || ["jpg", "jpeg", "png", "gif", "webp"].includes(contentType)) {
    return "imagem";
  }

  if (contentType.startsWith("video") || ["mp4", "mpeg", "mov"].includes(contentType)) {
    return "video";
  }

  return "arquivo";
}

function extractAccountId(body) {
  return (
    body.account?.id ||
    body.account_id ||
    body.conversation?.account_id ||
    process.env.CHATWOOT_ACCOUNT_ID
  );
}

function extractConversationId(body) {
  if (body.conversation?.id) {
    return body.conversation.id;
  }

  if (body.conversation_id) {
    return body.conversation_id;
  }

  if (body.conversation?.display_id) {
    return body.conversation.display_id;
  }

  return body.event === "message_created" ? null : body.id || null;
}

function extractMessageId(body) {
  return body.message?.id || body.message_id || (body.event === "message_created" ? body.id : null);
}

function extractSender(details, fallbackBody) {
  const sender =
    details?.meta?.sender ||
    details?.contact ||
    fallbackBody.contact ||
    fallbackBody.sender ||
    {};

  return {
    name: sender.name || "Lead Chatwoot",
    phone: sender.phone_number || sender.phone || null,
    email: sender.email || null,
  };
}

function normalizeChannel(details, fallbackBody) {
  return details?.channel || fallbackBody.channel || fallbackBody.conversation?.channel || "desconhecido";
}

function normalizeLabels(details, fallbackBody) {
  const labels = details?.labels || fallbackBody.labels || [];
  return Array.isArray(labels) ? labels : [];
}

function normalizeStatus(details, fallbackBody) {
  return details?.status || fallbackBody.conversation?.status || fallbackBody.status || null;
}

function normalizeInboxId(details, fallbackBody) {
  return details?.inbox_id || fallbackBody.conversation?.inbox_id || fallbackBody.inbox_id || null;
}

function normalizeAssigneeName(details, fallbackBody) {
  return (
    details?.meta?.assignee?.name ||
    details?.assignee?.name ||
    fallbackBody.meta?.assignee?.name ||
    fallbackBody.assignee?.name ||
    null
  );
}

function normalizeTimestamp(value) {
  if (!value) {
    return null;
  }

  if (typeof value === "number") {
    return new Date(value * 1000).toISOString();
  }

  if (typeof value === "string") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  return null;
}

function formatTimestamp(value) {
  const normalized = normalizeTimestamp(value);
  return normalized || "sem-data";
}

function getLatestVisibleMessage(messages) {
  const visibleMessages = messages.filter((message) => !message.private);
  return visibleMessages.length ? visibleMessages[visibleMessages.length - 1] : null;
}

function getWebhookMessage(body) {
  if (body.event !== "message_created") {
    return null;
  }

  if (body.message && typeof body.message === "object") {
    return body.message;
  }

  return {
    id: body.id,
    content: body.content,
    message_type: body.message_type,
    created_at: body.created_at,
    private: body.private,
    sender: body.sender,
    sender_type: body.sender_type,
    attachments: body.attachments,
    attachment: body.attachment,
    content_attributes: body.content_attributes,
  };
}

function findMessageById(messages, messageId) {
  if (!messageId) {
    return null;
  }

  return messages.find((message) => String(message.id) === String(messageId)) || null;
}

function isContactMessage(message) {
  if (!message) {
    return false;
  }

  const messageType = String(message.message_type || "").toLowerCase();
  return (
    message.sender?.type === "contact" ||
    message.sender_type === "Contact" ||
    messageType === "incoming" ||
    message.message_type === 0
  );
}

function isAgentMessage(message) {
  if (!message) {
    return false;
  }

  const messageType = String(message.message_type || "").toLowerCase();
  return (
    message.sender?.type === "user" ||
    message.sender_type === "User" ||
    messageType === "outgoing" ||
    message.message_type === 1
  );
}

function isActivityMessage(message) {
  if (!message) {
    return false;
  }

  return message.message_type === 2 || String(message.message_type || "").toLowerCase() === "activity";
}

function shouldSyncChatwootReplyToGhl({ event, inboxId, message }) {
  if (event !== "message_created") {
    return false;
  }

  if (message?.content_attributes?.origem === "ghl") {
    return false;
  }

  if (String(process.env.ENABLE_CHATWOOT_TO_GHL_REPLY_SYNC || "").toLowerCase() !== "true") {
    return false;
  }

  if (String(inboxId) !== String(process.env.CHATWOOT_GHL_INBOX_ID || "")) {
    return false;
  }

  return Boolean(message?.content?.trim()) && !message.private && isAgentMessage(message);
}

async function syncChatwootReplyToGhl({ details, conversationId, message }) {
  const customAttributes = details?.custom_attributes || {};
  const ghlContactId = customAttributes.ghl_contact_id || null;
  const ghlConversationId = customAttributes.ghl_conversation_id || null;

  if (!ghlContactId && !ghlConversationId) {
    logger.warn("Resposta do Chatwoot nao possui IDs do GHL para envio", {
      conversationId,
      chatwootMessageId: message?.id,
    });
    return null;
  }

  return sendConversationMessage({
    contactId: ghlContactId,
    conversationId: ghlConversationId,
    message: message.content.trim(),
    messageType: process.env.GHL_OUTBOUND_MESSAGE_TYPE || "WhatsApp",
  });
}

function getMessageDirection(message) {
  if (!message) {
    return null;
  }

  const messageType = String(message.message_type || "").toLowerCase();

  if (message.sender?.type === "user" || message.sender_type === "User" || messageType === "outgoing" || message.message_type === 1) {
    return "saida_agente";
  }

  if (message.sender?.type === "contact" || message.sender_type === "Contact" || messageType === "incoming" || message.message_type === 0) {
    return "entrada_contato";
  }

  if (message.message_type === 0) {
    return "mensagem";
  }

  return null;
}

function slugifyTagPart(value) {
  if (!value) {
    return null;
  }

  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || null;
}

function buildGhlTags({ channel, status, labels, inboxId, event, latestMessage }) {
  const tags = ["chatwoot", "origem:chatwoot"];
  const channelTag = slugifyTagPart(channel);
  const statusTag = slugifyTagPart(status);

  if (channelTag) {
    tags.push(`canal:${channelTag}`);
  }

  if (statusTag) {
    tags.push(`status:${statusTag}`);
  }

  if (inboxId != null) {
    tags.push(`inbox:${String(inboxId)}`);
  }

  for (const label of labels || []) {
    const normalized = slugifyTagPart(label);
    if (normalized) {
      tags.push(`label:${normalized}`);
    }
  }

    if (event === "conversation_created") {
      tags.push("chatwoot:nova-conversa");
    }

    if (event === "conversation_updated") {
      tags.push("chatwoot:conversa-atualizada");
    }

  if (event === "message_created" && isContactMessage(latestMessage)) {
    tags.push("chatwoot:cliente-respondeu");
  }

  return [...new Set(tags)];
}

function formatMessageLine(message) {
  const createdAt = formatTimestamp(message?.created_at);

  const senderName =
    message?.sender?.name ||
    (message?.sender?.type === "user" ? "Agente" : "Contato") ||
    "Mensagem";

  const content = message?.content?.trim() || "[sem conteudo]";
  const attachments = formatAttachmentsForTranscript(extractMessageAttachments(message));

  return attachments
    ? `[${createdAt}] ${senderName}: ${content}\n${attachments}`
    : `[${createdAt}] ${senderName}: ${content}`;
}

function extractMessageAttachments(message) {
  const attachments = [];

  if (Array.isArray(message?.attachments)) {
    attachments.push(...message.attachments);
  }

  if (message?.attachment && typeof message.attachment === "object") {
    attachments.push(message.attachment);
  }

  return attachments
    .filter(Boolean)
    .map((attachment) => ({
      url:
        attachment.data_url ||
        attachment.thumb_url ||
        attachment.file_url ||
        attachment.url ||
        attachment.download_url ||
        null,
      fileName: attachment.file_name || attachment.filename || attachment.name || null,
      contentType: attachment.extension || attachment.content_type || attachment.file_type || null,
    }))
    .filter((attachment) => attachment.url || attachment.fileName || attachment.contentType);
}

function formatAttachmentsForTranscript(attachments) {
  if (!attachments.length) {
    return "";
  }

  return attachments
    .map((attachment, index) => {
      const label = getAttachmentLabel(attachment);
      const name = attachment.fileName ? ` (${attachment.fileName})` : "";
      const url = attachment.url ? `: ${attachment.url}` : "";
      return `  [Anexo ${index + 1}] ${label}${name}${url}`;
    })
    .join("\n");
}

function buildConversationNote({ details, messages, conversationId, channel, labels }) {
  const header = [
    "Historico importado do Chatwoot",
    `Conversa ID: ${conversationId}`,
    `Canal: ${channel}`,
    `Labels: ${labels.length ? labels.join(", ") : "nenhuma"}`,
    details?.status ? `Status: ${details.status}` : null,
    "",
    "Mensagens:",
  ].filter(Boolean);

  const visibleMessages = messages.filter((message) => !message.private);
  const transcript = visibleMessages.length
    ? visibleMessages.map(formatMessageLine)
    : ["Sem mensagens publicas na conversa."];

  return [...header, ...transcript].join("\n");
}

function buildMessageUpdateNote({ conversationId, channel, labels, status, latestMessage }) {
  const header = [
    "Atualizacao de mensagem no Chatwoot",
    `Conversa ID: ${conversationId}`,
    `Canal: ${channel}`,
    `Labels: ${labels.length ? labels.join(", ") : "nenhuma"}`,
    status ? `Status: ${status}` : null,
    "",
  ].filter(Boolean);

  if (!latestMessage) {
    return [...header, "Nenhuma mensagem publica encontrada na conversa."].join("\n");
  }

  return [...header, formatMessageLine(latestMessage)].join("\n");
}

function buildStatusUpdateNote({ conversationId, channel, labels, status }) {
  return [
    "Atualizacao de status no Chatwoot",
    `Conversa ID: ${conversationId}`,
    `Canal: ${channel}`,
    `Labels: ${labels.length ? labels.join(", ") : "nenhuma"}`,
    status ? `Novo status: ${status}` : "Novo status: desconhecido",
  ].join("\n");
}

export default async function webhookHandler(req, res) {
  try {
    const body = req.body;
    const event = body.event;

    logger.info("Webhook recebido do Chatwoot", {
      event,
      deliveryId: getHeader(req, "x-chatwoot-delivery"),
    });

    if (!isSupportedEvent(event)) {
      return res.sendStatus(200);
    }

    const accountId = extractAccountId(body);
    const conversationId = extractConversationId(body);
    const deliveryId = getHeader(req, "x-chatwoot-delivery");
    const incomingStatus = body.conversation?.status || body.status || null;
    const messageId = extractMessageId(body);

    if (!accountId || !conversationId) {
      logger.warn("Webhook sem accountId ou conversationId suficiente", {
        event,
        accountId,
        conversationId,
      });
      return res.sendStatus(202);
    }

    const dedupKey = {
      deliveryId,
      event,
      conversationId,
      status: incomingStatus,
      messageId,
    };

    if (hasProcessedWebhook(dedupKey)) {
      logger.info("Webhook duplicado ignorado", {
        event,
        deliveryId,
        conversationId,
        status: incomingStatus,
        messageId,
      });
      return res.sendStatus(200);
    }

    const [details, messages] = await Promise.all([
      getConversationDetails(accountId, conversationId),
      getConversationMessages(accountId, conversationId),
    ]);

    const webhookMessage = getWebhookMessage(body);
    const eventMessage = findMessageById(messages, messageId) || webhookMessage;
    const sender = extractSender(details, body);
    const channel = normalizeChannel(details, body);
    const labels = normalizeLabels(details, body);
    const status = normalizeStatus(details, body);
    const inboxId = normalizeInboxId(details, body);
    const assigneeName = normalizeAssigneeName(details, body);
    const latestMessage = getLatestVisibleMessage(messages);
    const noteMessage = event === "message_created" ? eventMessage : latestMessage;
    const lastMessageAt = normalizeTimestamp(
      latestMessage?.created_at || details?.last_activity_at || body.conversation?.last_activity_at
    );
    const lastMessageDirection = getMessageDirection(latestMessage);

    const { contactId } = await upsertContact({
      ...sender,
      conversationId,
      channel,
      labels,
      status,
      inboxId,
      assigneeName,
      lastMessageAt,
      lastMessageDirection,
    });

    const tags = buildGhlTags({
      channel,
      status,
      labels,
      inboxId,
      event,
      latestMessage,
    });

    if (shouldSyncChatwootReplyToGhl({ event, inboxId, message: noteMessage })) {
      try {
        await syncChatwootReplyToGhl({
          details,
          conversationId,
          message: noteMessage,
        });

        logger.info("Resposta do Chatwoot enviada para o GHL", {
          conversationId,
          messageId,
        });
      } catch (error) {
        logger.error("Falha ao enviar resposta do Chatwoot para o GHL", {
          conversationId,
          messageId,
          error: error.message,
        });
        return res.sendStatus(500);
      }

      rememberProcessedWebhook(dedupKey);
      return res.sendStatus(200);
    }

    try {
      await syncIsaFromLabels({
        accountId,
        conversationId,
        ghlContactId: contactId,
        event,
        labels,
        sender,
        channel,
        status,
        inboxId,
        assigneeName,
      });
    } catch (error) {
      logger.warn("Falha ao enviar webhook de controle da Isa", {
        conversationId,
        event,
        error: error.message,
      });
    }

    try {
      await addContactTags(contactId, tags);
    } catch (error) {
      logger.warn("Falha ao adicionar tags no contato do GHL", {
        contactId,
        conversationId,
        error: error.message,
      });
    }

    if (event === "conversation_created") {
      try {
        const opportunity = await createOpportunityForContact({
          contactId,
          conversationId,
          contactName: sender.name,
          channel,
          status,
        });

        if (opportunity?.id) {
          await updateOpportunityFromChatwoot(opportunity.id, {
            status,
            conversationId,
          });
        }
      } catch (error) {
        logger.warn("Falha ao criar oportunidade no GHL", {
          contactId,
          conversationId,
          error: error.message,
        });
      }
    } else {
      try {
        const opportunity = await createOpportunityForContact({
          contactId,
          conversationId,
          contactName: sender.name,
          channel,
          status,
        });

        if (opportunity?.id) {
          await updateOpportunityFromChatwoot(opportunity.id, {
            status,
            conversationId,
          });
        }
      } catch (error) {
        logger.warn("Falha ao atualizar oportunidade no GHL", {
          contactId,
          conversationId,
          error: error.message,
        });
      }
    }

    if (event === "conversation_updated") {
      logger.info("Atualizacao de conversa processada sem criar nota incremental no GHL", {
        contactId,
        conversationId,
        event,
        labels,
      });
      rememberProcessedWebhook(dedupKey);
      return res.sendStatus(200);
    }

    const note =
      event === "conversation_created"
        ? buildConversationNote({
            details,
            messages,
            conversationId,
            channel,
            labels,
          })
        : event === "message_created"
          ? buildMessageUpdateNote({
              conversationId,
              channel,
              labels,
              status,
              latestMessage: noteMessage,
            })
          : event === "conversation_status_changed"
            ? buildStatusUpdateNote({
                conversationId,
                channel,
                labels,
                status,
              })
            : buildMessageUpdateNote({
              conversationId,
              channel,
              labels,
              status,
              latestMessage,
            });

    if (event === "message_created" && (!noteMessage || isActivityMessage(noteMessage) || !isContactMessage(noteMessage))) {
      logger.info("Mensagem ignorada para nota incremental no GHL", {
        conversationId,
        event,
        hasMessage: Boolean(noteMessage),
        isActivityMessage: isActivityMessage(noteMessage),
        isContactMessage: isContactMessage(noteMessage),
      });
      rememberProcessedWebhook(dedupKey);
      return res.sendStatus(200);
    }

    await createContactNote(contactId, note);

    logger.info("Conversa sincronizada com o GHL", {
      contactId,
      conversationId,
      event,
      status,
      inboxId,
      assigneeName,
    });

    rememberProcessedWebhook(dedupKey);

    res.sendStatus(200);
  } catch (error) {
    logger.error("Erro no processamento do webhook", {
      error: error.message,
      stack: error.stack,
    });
    res.sendStatus(500);
  }
}

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
  const requestHeaders = {
    ...headers(),
    ...(options.headers || {}),
  };

  const res = await fetch(url, {
    ...options,
    headers: requestHeaders,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Chatwoot API erro ${res.status} em ${path}: ${body}`);
  }

  return res.json();
}

async function chatwootFormFetch(path, formData) {
  const url = `${getBaseUrl()}${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      api_access_token: getApiToken(),
    },
    body: formData,
  });

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
  if (Array.isArray(data.attachments) && data.attachments.length) {
    try {
      return await createChatwootAttachmentMessage(accountId, conversationId, data);
    } catch (error) {
      logger.warn("Falha ao criar mensagem com anexo no Chatwoot; usando fallback em texto", {
        conversationId,
        attachmentCount: data.attachments.length,
        error: error.message,
      });
    }
  }

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

function inferFileType(contentType = "", fileName = "") {
  const normalizedContentType = String(contentType || "").toLowerCase();
  const normalizedFileName = String(fileName || "").toLowerCase();

  if (
    normalizedContentType.startsWith("image/") ||
    /\.(jpg|jpeg|png|gif|webp|bmp|heic|heif)$/.test(normalizedFileName)
  ) {
    return "image";
  }

  if (
    normalizedContentType.startsWith("audio/") ||
    /\.(mp3|mpeg|m4a|ogg|oga|opus|wav|webm|aac)$/.test(normalizedFileName)
  ) {
    return "audio";
  }

  if (
    normalizedContentType.startsWith("video/") ||
    /\.(mp4|mov|mpeg|mpg|webm|avi)$/.test(normalizedFileName)
  ) {
    return "video";
  }

  return "file";
}

function extensionFromContentType(contentType) {
  const normalized = String(contentType || "").toLowerCase().split(";")[0];
  const map = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/heic": "heic",
    "image/heif": "heif",
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
    "audio/mp4": "m4a",
    "audio/aac": "aac",
    "audio/ogg": "ogg",
    "audio/opus": "opus",
    "audio/wav": "wav",
    "audio/webm": "webm",
    "video/mp4": "mp4",
    "video/quicktime": "mov",
    "application/pdf": "pdf",
  };

  return map[normalized] || "bin";
}

function fileNameFromUrl(url, fallbackContentType, index) {
  try {
    const parsed = new URL(url);
    const lastPathPart = parsed.pathname.split("/").filter(Boolean).pop();
    if (lastPathPart && lastPathPart.includes(".")) {
      return decodeURIComponent(lastPathPart).slice(0, 120);
    }
  } catch {
    // Usa fallback abaixo quando a URL nao for parseavel.
  }

  return `anexo-${index + 1}.${extensionFromContentType(fallbackContentType)}`;
}

async function downloadAttachment(attachment, index) {
  const maxBytes = Number(process.env.CHATWOOT_ATTACHMENT_MAX_BYTES || 25 * 1024 * 1024);
  const timeoutMs = Number(process.env.CHATWOOT_ATTACHMENT_DOWNLOAD_TIMEOUT_MS || 15000);
  const response = await fetch(attachment.url, {
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    throw new Error(`Download do anexo retornou ${response.status}`);
  }

  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > maxBytes) {
    throw new Error(`Anexo maior que o limite configurado (${contentLength} bytes)`);
  }

  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength > maxBytes) {
    throw new Error(`Anexo maior que o limite configurado (${arrayBuffer.byteLength} bytes)`);
  }

  const contentType =
    attachment.type ||
    response.headers.get("content-type") ||
    "application/octet-stream";
  const fileName = attachment.name || fileNameFromUrl(attachment.url, contentType, index);

  return {
    blob: new Blob([arrayBuffer], { type: contentType }),
    contentType,
    fileName,
  };
}

async function createChatwootAttachmentMessage(accountId, conversationId, data) {
  const formData = new FormData();
  const downloadedAttachments = await Promise.all(
    data.attachments.map((attachment, index) => downloadAttachment(attachment, index))
  );
  const primaryAttachment = downloadedAttachments[0];
  const fileType = inferFileType(primaryAttachment.contentType, primaryAttachment.fileName);

  formData.append("content", data.caption || data.textContent || data.content || "");
  formData.append("message_type", data.messageType || "incoming");
  formData.append("private", String(Boolean(data.private)));
  formData.append("file_type", fileType);

  for (const downloaded of downloadedAttachments) {
    formData.append("attachments[]", downloaded.blob, downloaded.fileName);
  }

  if (data.contentAttributes) {
    formData.append("content_attributes", JSON.stringify(data.contentAttributes));
  }

  logger.info("Criando mensagem com anexo no Chatwoot a partir do GHL", {
    conversationId,
    messageType: data.messageType || "incoming",
    fileType,
    attachmentCount: downloadedAttachments.length,
    fileName: primaryAttachment.fileName,
    contentType: primaryAttachment.contentType,
  });

  return chatwootFormFetch(
    `/api/v1/accounts/${accountId}/conversations/${conversationId}/messages`,
    formData
  );
}

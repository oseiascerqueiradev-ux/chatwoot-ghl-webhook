import { rememberIsaAction, shouldSendIsaAction } from "./isaActionStore.js";
import { logger } from "./logger.js";

function normalizeLabel(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function parseLabelAliases(envName, fallback) {
  const raw = process.env[envName] || fallback;
  return new Set(
    raw
      .split(",")
      .map((label) => normalizeLabel(label))
      .filter(Boolean)
  );
}

function getLabelConfig() {
  return {
    stop: parseLabelAliases("ISA_STOP_LABELS", "Stop Isa,stop-isa,stop_isa"),
    start: parseLabelAliases("ISA_START_LABELS", "Star Isa,Start Isa,star-isa,start-isa,star_isa,start_isa"),
  };
}

function getActionWebhookUrl(action) {
  if (action === "stop") {
    return process.env.ISA_STOP_WEBHOOK_URL || process.env.STOP_ISA_WEBHOOK_URL || null;
  }

  if (action === "start") {
    return process.env.ISA_START_WEBHOOK_URL || process.env.START_ISA_WEBHOOK_URL || null;
  }

  return null;
}

export function getIsaActionFromLabels(labels = []) {
  const normalizedLabels = new Set(labels.map((label) => normalizeLabel(label)).filter(Boolean));
  const config = getLabelConfig();

  for (const label of normalizedLabels) {
    if (config.stop.has(label)) {
      return "stop";
    }
  }

  for (const label of normalizedLabels) {
    if (config.start.has(label)) {
      return "start";
    }
  }

  return null;
}

export async function syncIsaFromLabels({
  accountId,
  conversationId,
  ghlContactId,
  event,
  labels,
  sender,
  channel,
  status,
  inboxId,
  assigneeName,
}) {
  const action = getIsaActionFromLabels(labels);
  if (!action) {
    return null;
  }

  if (!shouldSendIsaAction(conversationId, action)) {
    logger.info("Acao da Isa ja enviada para esta conversa; ignorando repeticao", {
      conversationId,
      action,
    });
    return null;
  }

  const webhookUrl = getActionWebhookUrl(action);
  if (!webhookUrl) {
    logger.warn("Etiqueta da Isa detectada, mas webhook da acao nao esta configurado", {
      conversationId,
      action,
      requiredEnv: action === "stop" ? "ISA_STOP_WEBHOOK_URL" : "ISA_START_WEBHOOK_URL",
    });
    return null;
  }

  const payload = {
    action,
    source: "chatwoot",
    event,
    accountId,
    conversationId,
    ghlContactId,
    locationId: process.env.GHL_LOCATION_ID || null,
    contact: {
      name: sender?.name || null,
      phone: sender?.phone || null,
      email: sender?.email || null,
    },
    channel,
    status,
    inboxId,
    assigneeName,
    labels,
    timestamp: new Date().toISOString(),
  };

  logger.info("Enviando webhook de controle da Isa", {
    conversationId,
    action,
  });

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Webhook Isa ${action} retornou ${response.status}: ${text}`);
  }

  rememberIsaAction(conversationId, action);
  return { action, status: response.status };
}

import { logger } from "./logger.js";

const GHL_TOKEN_ENV_VARS = ["GHL_PRIVATE_INTEGRATION_TOKEN", "GHL_API_KEY"];

const REQUIRED_ENV_VARS = [
  "CHATWOOT_BASE_URL",
  "CHATWOOT_API_TOKEN",
  "CHATWOOT_ACCOUNT_ID",
  "GHL_LOCATION_ID",
];

function isBlank(value) {
  return typeof value !== "string" || value.trim() === "";
}

export function validateEnv() {
  const missing = REQUIRED_ENV_VARS.filter((name) => isBlank(process.env[name]));

  if (missing.length > 0) {
    throw new Error(`Variaveis de ambiente obrigatorias ausentes: ${missing.join(", ")}`);
  }

  const hasGhlToken = GHL_TOKEN_ENV_VARS.some((name) => !isBlank(process.env[name]));
  if (!hasGhlToken) {
    throw new Error(
      "Variavel de ambiente obrigatoria ausente: defina GHL_PRIVATE_INTEGRATION_TOKEN ou GHL_API_KEY"
    );
  }

  if (isBlank(process.env.CHATWOOT_WEBHOOK_SECRET)) {
    logger.warn("CHATWOOT_WEBHOOK_SECRET ausente; a assinatura do webhook nao sera validada");
  }

  if (!isBlank(process.env.GHL_API_KEY) && isBlank(process.env.GHL_PRIVATE_INTEGRATION_TOKEN)) {
    logger.warn(
      "GHL_API_KEY esta em modo legado; prefira GHL_PRIVATE_INTEGRATION_TOKEN para Private Integrations"
    );
  }
}

export function getPublicConfig() {
  const enableOpportunitySync =
    typeof process.env.ENABLE_GHL_OPPORTUNITY_SYNC === "string" &&
    process.env.ENABLE_GHL_OPPORTUNITY_SYNC.toLowerCase() === "true";

  const opportunityStageMap = {
    open: process.env.GHL_OPPORTUNITY_STAGE_ID_OPEN || null,
    pending: process.env.GHL_OPPORTUNITY_STAGE_ID_PENDING || null,
    resolved: process.env.GHL_OPPORTUNITY_STAGE_ID_RESOLVED || null,
  };

  return {
    port: Number(process.env.PORT || 3000),
    logLevel: process.env.LOG_LEVEL || "info",
    chatwootBaseUrl: process.env.CHATWOOT_BASE_URL,
    chatwootAccountId: process.env.CHATWOOT_ACCOUNT_ID,
    chatwootGhlInboxId: process.env.CHATWOOT_GHL_INBOX_ID || null,
    hasWebhookSecret: !isBlank(process.env.CHATWOOT_WEBHOOK_SECRET),
    hasGhlToChatwootWebhookSecret: !isBlank(process.env.GHL_TO_CHATWOOT_WEBHOOK_SECRET),
    enableChatwootToGhlReplySync:
      String(process.env.ENABLE_CHATWOOT_TO_GHL_REPLY_SYNC || "").toLowerCase() === "true",
    hasGhlAccessToken: GHL_TOKEN_ENV_VARS.some((name) => !isBlank(process.env[name])),
    ghlAuthMode: !isBlank(process.env.GHL_PRIVATE_INTEGRATION_TOKEN)
      ? "private_integration"
      : !isBlank(process.env.GHL_API_KEY)
        ? "legacy_api_key"
        : "missing",
    ghlLocationId: process.env.GHL_LOCATION_ID,
    enableGhlOpportunitySync: enableOpportunitySync,
    ghlOpportunityPipelineId: process.env.GHL_OPPORTUNITY_PIPELINE_ID || null,
    ghlOpportunityStageId: process.env.GHL_OPPORTUNITY_STAGE_ID || null,
    ghlOpportunityStageMap: opportunityStageMap,
    hasIsaStopWebhookUrl: !isBlank(process.env.ISA_STOP_WEBHOOK_URL || process.env.STOP_ISA_WEBHOOK_URL),
    hasIsaStartWebhookUrl: !isBlank(process.env.ISA_START_WEBHOOK_URL || process.env.START_ISA_WEBHOOK_URL),
  };
}

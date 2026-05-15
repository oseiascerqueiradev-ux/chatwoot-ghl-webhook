import dotenv from "dotenv";

dotenv.config();

const REQUIRED_ENV = [
  "CHATWOOT_BASE_URL",
  "CHATWOOT_API_TOKEN",
  "CHATWOOT_ACCOUNT_ID",
  "CHATWOOT_WEBHOOK_SECRET",
  "CHATWOOT_GHL_INBOX_ID",
  "GHL_TO_CHATWOOT_WEBHOOK_SECRET",
  "GHL_PRIVATE_INTEGRATION_TOKEN",
  "GHL_LOCATION_ID",
];

const EXPECTED_CHATWOOT_WEBHOOK_EVENTS = [
  "conversation_created",
  "message_created",
  "conversation_status_changed",
  "conversation_updated",
];

function isPresent(value) {
  return typeof value === "string" && value.trim() !== "";
}

function ok(label, details = "") {
  console.log(`OK   ${label}${details ? ` - ${details}` : ""}`);
}

function warn(label, details = "") {
  console.log(`WARN ${label}${details ? ` - ${details}` : ""}`);
}

function fail(label, details = "") {
  console.log(`FAIL ${label}${details ? ` - ${details}` : ""}`);
  process.exitCode = 1;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();

  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  return { response, data };
}

async function checkHealth() {
  const healthUrl = process.env.READINESS_HEALTH_URL || "https://chatwoot-ghl-webhook.onrender.com/health";

  try {
    const { response, data } = await fetchJson(healthUrl);
    if (!response.ok || !data?.ok) {
      fail("Render health", `status ${response.status}`);
      return;
    }

    ok("Render health", healthUrl);

    const config = data.config || {};
    if (config.chatwootGhlInboxId) {
      ok("Chatwoot API inbox no Render", String(config.chatwootGhlInboxId));
    } else {
      fail("Chatwoot API inbox no Render", "CHATWOOT_GHL_INBOX_ID ausente");
    }

    if (config.enableChatwootToGhlReplySync) {
      ok("Resposta Chatwoot -> GHL habilitada");
    } else {
      warn("Resposta Chatwoot -> GHL desabilitada", "ENABLE_CHATWOOT_TO_GHL_REPLY_SYNC=false");
    }

    if (config.chatwootSignatureMode === "warn") {
      warn("Assinatura Chatwoot em modo warn", "bom para operar agora; depois alinhar segredo e usar enforce");
    } else if (config.chatwootSignatureMode === "enforce") {
      ok("Assinatura Chatwoot em modo enforce");
    } else {
      warn("Modo de assinatura Chatwoot nao informado no health");
    }
  } catch (error) {
    fail("Render health", error.message);
  }
}

async function checkChatwootWebhook() {
  const baseUrl = process.env.CHATWOOT_BASE_URL?.replace(/\/$/, "");
  const accountId = process.env.CHATWOOT_ACCOUNT_ID;
  const token = process.env.CHATWOOT_API_TOKEN;
  const targetUrl =
    process.env.READINESS_CHATWOOT_WEBHOOK_URL ||
    "https://chatwoot-ghl-webhook.onrender.com/webhook/chatwoot";

  if (!baseUrl || !accountId || !token) {
    warn("Webhook Chatwoot", "credenciais locais ausentes; pulando consulta");
    return;
  }

  try {
    const { response, data } = await fetchJson(`${baseUrl}/api/v1/accounts/${accountId}/webhooks`, {
      headers: {
        api_access_token: token,
      },
    });

    if (!response.ok) {
      fail("Webhook Chatwoot", `API respondeu status ${response.status}`);
      return;
    }

    const webhooks = data?.payload?.webhooks || data?.webhooks || [];
    const target = webhooks.find((webhook) => webhook.url === targetUrl);

    if (!target) {
      fail("Webhook Chatwoot cadastrado", targetUrl);
      return;
    }

    ok("Webhook Chatwoot cadastrado", targetUrl);

    const subscriptions = new Set(target.subscriptions || []);
    const missingEvents = EXPECTED_CHATWOOT_WEBHOOK_EVENTS.filter((event) => !subscriptions.has(event));
    if (missingEvents.length) {
      fail("Eventos do webhook Chatwoot", `faltando: ${missingEvents.join(", ")}`);
    } else {
      ok("Eventos do webhook Chatwoot", EXPECTED_CHATWOOT_WEBHOOK_EVENTS.join(", "));
    }

    if (target.secret === process.env.CHATWOOT_WEBHOOK_SECRET) {
      ok("Secret Chatwoot local igual ao webhook cadastrado");
    } else {
      warn("Secret Chatwoot divergente", "Render esta em warn; alinhar antes de mudar para enforce");
    }
  } catch (error) {
    fail("Webhook Chatwoot", error.message);
  }
}

function checkEnv() {
  for (const name of REQUIRED_ENV) {
    if (isPresent(process.env[name])) {
      ok(`Env ${name}`);
    } else {
      fail(`Env ${name}`, "ausente");
    }
  }

  if (String(process.env.ENABLE_CHATWOOT_TO_GHL_REPLY_SYNC || "").toLowerCase() === "true") {
    ok("Env ENABLE_CHATWOOT_TO_GHL_REPLY_SYNC=true");
  } else {
    warn("Env ENABLE_CHATWOOT_TO_GHL_REPLY_SYNC", "respostas do Chatwoot nao voltarao ao GHL");
  }
}

async function main() {
  console.log("Revisao de prontidao Chatwoot + GHL");
  console.log("Esta verificacao e somente leitura: nao cria contatos e nao envia mensagens.\n");

  checkEnv();
  console.log("");
  await checkHealth();
  console.log("");
  await checkChatwootWebhook();
}

main().catch((error) => {
  fail("Revisao de prontidao", error.message);
});

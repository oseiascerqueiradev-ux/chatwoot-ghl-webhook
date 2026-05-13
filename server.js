import express from "express";
import dotenv from "dotenv";
import { getPublicConfig, validateEnv } from "./config.js";
import ghlWebhookHandler from "./ghlWebhookHandler.js";
import { logger } from "./logger.js";
import { verifySignature } from "./signature.js";
import webhookHandler from "./webhookHandler.js";

dotenv.config();
validateEnv();

const config = getPublicConfig();

const app = express();
app.use(
  express.json({
    verify: (req, res, buffer) => {
      req.rawBody = buffer.toString("utf8");
    },
  })
);

app.use((req, res, next) => {
  if (req.path !== "/webhook/chatwoot") {
    return next();
  }

  const secret = process.env.CHATWOOT_WEBHOOK_SECRET;
  if (!secret) {
    return next();
  }

  const signature = req.headers["x-chatwoot-signature"];
  const timestamp = req.headers["x-chatwoot-timestamp"];
  const isValid = verifySignature(req.rawBody, timestamp, signature, secret);

  if (!isValid) {
    logger.warn("Webhook rejeitado por assinatura invalida");
    return res.sendStatus(401);
  }

  next();
});

app.post("/webhook/chatwoot", webhookHandler);
app.post("/webhook/ghl", ghlWebhookHandler);

app.get("/", (req, res) => {
  res.json({
    ok: true,
    service: "chatwoot-ghl-webhook",
  });
});

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    config: {
      port: config.port,
      logLevel: config.logLevel,
      chatwootBaseUrl: config.chatwootBaseUrl,
      chatwootAccountId: config.chatwootAccountId,
      chatwootGhlInboxId: config.chatwootGhlInboxId,
      hasWebhookSecret: config.hasWebhookSecret,
      hasGhlToChatwootWebhookSecret: config.hasGhlToChatwootWebhookSecret,
      enableChatwootToGhlReplySync: config.enableChatwootToGhlReplySync,
      hasGhlAccessToken: config.hasGhlAccessToken,
      ghlAuthMode: config.ghlAuthMode,
      ghlLocationId: config.ghlLocationId,
      enableGhlOpportunitySync: config.enableGhlOpportunitySync,
      ghlOpportunityPipelineId: config.ghlOpportunityPipelineId,
      ghlOpportunityStageId: config.ghlOpportunityStageId,
      ghlOpportunityStageMap: config.ghlOpportunityStageMap,
      hasIsaStopWebhookUrl: config.hasIsaStopWebhookUrl,
      hasIsaStartWebhookUrl: config.hasIsaStartWebhookUrl,
    },
  });
});

app.listen(config.port, () => {
  logger.info("Server rodando", {
    port: config.port,
    chatwootBaseUrl: config.chatwootBaseUrl,
    chatwootAccountId: config.chatwootAccountId,
    chatwootGhlInboxId: config.chatwootGhlInboxId,
    hasWebhookSecret: config.hasWebhookSecret,
    hasGhlToChatwootWebhookSecret: config.hasGhlToChatwootWebhookSecret,
    enableChatwootToGhlReplySync: config.enableChatwootToGhlReplySync,
    ghlAuthMode: config.ghlAuthMode,
    ghlLocationId: config.ghlLocationId,
    enableGhlOpportunitySync: config.enableGhlOpportunitySync,
    ghlOpportunityPipelineId: config.ghlOpportunityPipelineId,
    ghlOpportunityStageId: config.ghlOpportunityStageId,
    ghlOpportunityStageMap: config.ghlOpportunityStageMap,
    hasIsaStopWebhookUrl: config.hasIsaStopWebhookUrl,
    hasIsaStartWebhookUrl: config.hasIsaStartWebhookUrl,
  });
});

import dotenv from "dotenv";
import fs from "node:fs/promises";

dotenv.config();

const targetUrl = process.env.TEST_GHL_WEBHOOK_URL || "http://localhost:3000/webhook/ghl";
const payloadPath = process.argv[2] || "sample-ghl-message-webhook.json";
const rawPayload = await fs.readFile(payloadPath, "utf8");

const headers = {
  "Content-Type": "application/json",
};

if (process.env.GHL_TO_CHATWOOT_WEBHOOK_SECRET) {
  headers["x-ghl-webhook-secret"] = process.env.GHL_TO_CHATWOOT_WEBHOOK_SECRET;
}

const response = await fetch(targetUrl, {
  method: "POST",
  headers,
  body: rawPayload,
});

const text = await response.text();

console.log("Status:", response.status);
console.log(text || "[sem corpo]");

if (!response.ok) {
  process.exitCode = 1;
}

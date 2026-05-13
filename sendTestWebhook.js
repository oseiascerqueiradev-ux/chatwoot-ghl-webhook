import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

const webhookUrl = process.env.TEST_WEBHOOK_URL || "http://localhost:3000/webhook/chatwoot";
const webhookSecret = process.env.CHATWOOT_WEBHOOK_SECRET || "";
const samplePath = path.resolve(process.cwd(), "sample-chatwoot-conversation-created.json");

async function main() {
  const rawBody = await fs.readFile(samplePath, "utf8");
  const timestamp = Math.floor(Date.now() / 1000).toString();

  const headers = {
    "Content-Type": "application/json",
    "X-Chatwoot-Timestamp": timestamp,
  };

  if (webhookSecret) {
    headers["X-Chatwoot-Signature"] = buildSignature(rawBody, timestamp, webhookSecret);
  }

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers,
    body: rawBody,
  });

  const responseText = await response.text();

  console.log(
    JSON.stringify(
      {
        ok: response.ok,
        status: response.status,
        webhookUrl,
        signed: Boolean(webhookSecret),
        responseBody: responseText || null,
      },
      null,
      2
    )
  );
}

function buildSignature(rawBody, timestamp, secret) {
  return `sha256=${crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex")}`;
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: error.message,
      },
      null,
      2
    )
  );
  process.exit(1);
});

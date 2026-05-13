import crypto from "crypto";

const MAX_TIMESTAMP_AGE_SECONDS = 5 * 60;

export function verifySignature(rawBody, timestamp, receivedSignature, secret) {
  if (!rawBody || !timestamp || !receivedSignature || !secret) {
    return false;
  }

  const ageInSeconds = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (!Number.isFinite(ageInSeconds) || ageInSeconds > MAX_TIMESTAMP_AGE_SECONDS) {
    return false;
  }

  const expected =
    "sha256=" +
    crypto.createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");

  try {
    return crypto.timingSafeEqual(Buffer.from(receivedSignature), Buffer.from(expected));
  } catch {
    return false;
  }
}

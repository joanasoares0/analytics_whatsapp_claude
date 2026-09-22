// netlify/functions/whatsapp-webhook.mjs — receives, validates, delegates.
//
// GET  — Meta's verification handshake, against WHATSAPP_VERIFY_TOKEN.
// POST — validates the signature (WHATSAPP_APP_SECRET), delegates to
//        respond-background, and answers 200 within a couple of seconds.
//
// Meta expects that 200 quickly; anything slower counts as a failure and the
// same message is sent again, so the owner would be answered two or three
// times. All this function does is accept and hand off.
//
// The delegating fetch MUST be awaited: without the await the runtime freezes
// on return and the request never leaves.

import { createHmac, timingSafeEqual } from "node:crypto";

const BACKGROUND = "/.netlify/functions/respond-background";

function verifySignature(rawBody, header, secret) {
  if (!secret) return true; // optional in the demo, recommended in production
  if (!header?.startsWith("sha256=")) return false;

  const expected = Buffer.from(createHmac("sha256", secret).update(rawBody).digest("hex"));
  const received = Buffer.from(header.slice("sha256=".length));
  return expected.length === received.length && timingSafeEqual(expected, received);
}

/** Dig the first text message out of Meta's envelope. Anything else is ignored. */
function extractMessage(payload) {
  const value = payload?.entry?.[0]?.changes?.[0]?.value;
  const message = value?.messages?.[0];
  if (!message || message.type !== "text") return null;
  return { from: message.from, text: message.text?.body ?? "", id: message.id };
}

export default async (request) => {
  const url = new URL(request.url);

  if (request.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
      return new Response(challenge, { status: 200 });
    }
    return new Response("Forbidden", { status: 403 });
  }

  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const rawBody = await request.text();

  if (!verifySignature(rawBody, request.headers.get("x-hub-signature-256"), process.env.WHATSAPP_APP_SECRET)) {
    return new Response("Bad signature", { status: 401 });
  }

  let message;
  try {
    message = extractMessage(JSON.parse(rawBody));
  } catch {
    message = null;
  }

  // Status callbacks (delivered, read) land here too. Acknowledge and move on.
  if (!message) return new Response("ok", { status: 200 });

  await fetch(new URL(BACKGROUND, url.origin), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(message),
  });

  return new Response("ok", { status: 200 });
};

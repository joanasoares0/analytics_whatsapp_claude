// netlify/functions/whatsapp-webhook.mjs — receives, validates, delegates.
//
// GET  — Meta's verification handshake, against WHATSAPP_VERIFY_TOKEN.
// POST — validates the signature (WHATSAPP_APP_SECRET), then delegates to
//        respond-background and answers 200 within a couple of seconds.
//
// Meta expects a 200 quickly; anything slower counts as a failure and the same
// message gets resent, so the owner would be answered two or three times.
// The delegating fetch MUST be awaited: without the await the runtime freezes
// on return and the request never leaves.

// TODO: implement.

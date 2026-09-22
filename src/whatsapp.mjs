// src/whatsapp.mjs — sending through the Meta Cloud API.
//
// Also holds toWhatsApp(), which normalizes whatever the model wrote. The
// prompt asks for WhatsApp formatting; this makes sure of it. Formatting is
// deterministic, so it belongs in code, not in a hope.

import { optional, required } from "./env.mjs";

const GRAPH_VERSION = "v21.0";

// Meta's error codes worth translating, from the ones that actually came up.
const HINTS = {
  131005:
    "That is the temporary token from the 'Try it' screen — a user token. " +
    "Meta accepts reads from anywhere with it and refuses sends from a datacenter. " +
    "Use a System User token with whatsapp_business_messaging and whatsapp_business_management.",
  131030: "The destination number is not on Meta's test recipient list. Add it in the app dashboard.",
  131047: "The 24h window is closed: the owner has to send a message before the agent can reply freely.",
  190: "The access token expired or was revoked. Issue a new System User token.",
};

// The owner does not know what a column is and should not have to. The prompt
// forbids technical names in the answer; this is the guarantee, because "the
// prompt forbids it" is a hope and a dictionary is not.
const JARGON = [
  [/\bavg_order_value\b/gi, "average order value"],
  [/\bavg_discount_pct\b/gi, "average discount"],
  [/\battainment_pct\b/gi, "attainment"],
  [/\bactual_revenue\b/gi, "revenue"],
  [/\bplanned_target\b/gi, "target"],
  [/\bnet_total\b/gi, "revenue"],
  [/\bgross_total\b/gi, "gross revenue"],
  [/\bdiscount_pct\b/gi, "discount"],
  [/\bunit_price\b/gi, "unit price"],
  [/\bsale_date\b/gi, "date"],
  [/\bmonths_tenure\b/gi, "months at the company"],
  [/\bhome_region\b/gi, "region"],
  [/\btransaction_id\b/gi, "order"],
  [/\bqty\b/gi, "quantity"],
  [/\bvw_salesperson_performance\b/gi, "the performance figures"],
  [/\bvw_sales\b/gi, "the sales figures"],
];

/**
 * Turn the model's text into WhatsApp formatting.
 * WhatsApp bold is ONE asterisk; two is Markdown and shows up with the
 * asterisks visible on the phone.
 */
export function toWhatsApp(text) {
  let out = String(text ?? "");
  for (const [pattern, plain] of JARGON) out = out.replace(pattern, plain);
  return out
    .replace(/\r\n/g, "\n")
    .replace(/\*\*\*(.+?)\*\*\*/gs, "*$1*") // ***both*** -> bold
    .replace(/\*\*(.+?)\*\*/gs, "*$1*") // **bold** -> *bold*
    .replace(/__(.+?)__/gs, "_$1_") // __italic__ -> _italic_
    .replace(/^#{1,6}\s*/gm, "") // headings have no meaning here
    // The four blocks are structure, not a numbered form: "1) *Headline*" -> "*Headline*"
    .replace(/^\s*\d+[).]\s+(?=[*•📈📉⚠🎯])/gmu, "")
    .replace(/^\s*[-*]\s+/gm, "• ") // markdown bullets -> the agreed bullet
    .replace(/^\s*\|.*\|\s*$/gm, "") // a markdown table is unreadable on a phone
    .replace(/https?:\/\/\S+/g, "") // the chart goes as an attachment, never as a link
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function send(payload) {
  const phoneNumberId = required("WHATSAPP_PHONE_NUMBER_ID");
  const token = required("WHATSAPP_ACCESS_TOKEN");

  const response = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", ...payload }),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = body.error || {};
    const hint = HINTS[error.code] ? `\n${HINTS[error.code]}` : "";
    throw new Error(`WhatsApp send failed (${response.status} #${error.code}): ${error.message}${hint}`);
  }
  return body;
}

export async function sendText(to, text) {
  return send({ to, type: "text", text: { preview_url: false, body: toWhatsApp(text) } });
}

export async function sendImage(to, url, caption) {
  return send({ to, type: "image", image: { link: url, ...(caption ? { caption } : {}) } });
}

/** The owner's own number, for the test scripts. */
export const myNumber = () => optional("MY_NUMBER");

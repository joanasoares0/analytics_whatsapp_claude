// netlify/functions/respond-background.mjs — runs the analysis and answers.
//
// A Netlify background function: the `-background` suffix in the file name is
// what buys the 15 minute ceiling, which is what makes an 8-15 second analysis
// possible without Meta timing the webhook out. Do not rename it.
//
// Question → agent → text + charts → Meta Cloud API → the owner's phone.

import { answer } from "../../src/agent.mjs";
import { sendImage, sendText } from "../../src/whatsapp.mjs";

const SORRY =
  "⚠️ *I could not finish that analysis*\n\n" +
  "Something broke on the way to the database. Ask again in a moment.";

export default async (request) => {
  let from;
  try {
    const message = await request.json();
    from = message.from;
    const question = (message.text ?? "").trim();
    if (!from || !question) return new Response("nothing to do", { status: 202 });

    const result = await answer(question);

    // The text first: it is what the owner reads. The charts follow it.
    await sendText(from, result.text);
    for (const url of result.charts) {
      await sendImage(from, url);
    }

    return new Response("ok", { status: 202 });
  } catch (error) {
    console.error("respond-background failed:", error);
    if (from) {
      try {
        await sendText(from, SORRY);
      } catch (sendError) {
        console.error("could not even apologise:", sendError);
      }
    }
    return new Response("failed", { status: 202 });
  }
};

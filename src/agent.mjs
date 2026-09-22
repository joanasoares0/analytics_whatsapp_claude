// src/agent.mjs — the system prompt + the tool-use loop.
//
// THE AGENT'S BEHAVIOR LIVES HERE. If an answer comes out wrong, the fix is the
// text of the SYSTEM prompt below — never keyword routing, never
// `if (question.includes(...))`. See agent.md for the contract this has to meet:
// number → comparison → cause → action, in that order.
//
// Exposes the two tools the model is given, and nothing else:
//   query_data(sql)                            runs SELECT/WITH on the two views
//   create_chart(type, title, format, items)   returns the URL of a PNG
//
// At most 8 turns around the loop.

// TODO: implement.

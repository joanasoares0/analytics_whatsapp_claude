// src/db.mjs — Postgres access. SELECT only, with retry.
//
// Reads SUPABASE_DB_URL from .env. The database user holds SELECT on the
// two views and nothing else, so the read-only guarantee is a permission, not
// something enforced here — this module just does not offer a way to write.

// TODO: implement.

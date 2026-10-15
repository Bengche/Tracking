import express from "express";
import db from "./db.js";
import { authenticateToken } from "./adminAuth.js";
import { SIGNATURE_RE, MAX_SIGNATURE_CHARS } from "./validation.js";
import { config } from "./config.js";

const router = express.Router();

const FIELDS = {
  legal_name: 120,
  registered_address: 400,
  registration_number: 60,
  tax_id: 60,
  signatory_name: 120,
  signatory_title: 120,
};

const EMPTY = {
  legal_name: null,
  registered_address: null,
  registration_number: null,
  tax_id: null,
  signatory_name: null,
  signatory_title: null,
  signature: null,
};

/** Company details printed on every PDF. Missing values stay null; nothing is invented. */
export async function loadCompany() {
  const { rows } = await db.query("SELECT value FROM settings WHERE key = 'company'");
  const stored = rows[0]?.value || {};
  const company = { ...EMPTY, ...stored };
  return {
    ...company,
    // The legal name falls back to the configured trading name so documents always carry an issuer.
    display_name: company.legal_name || config.company.name,
  };
}

router.get("/company", authenticateToken, async (req, res) => {
  const { display_name: _display, ...company } = await loadCompany();
  res.json({ success: true, company });
});

router.put("/company", authenticateToken, async (req, res) => {
  const body = req.body || {};
  const fields = {};
  const current = await loadCompany();
  const next = { ...EMPTY };
  for (const key of Object.keys(EMPTY)) next[key] = current[key] ?? null;

  for (const [key, max] of Object.entries(FIELDS)) {
    if (body[key] === undefined) continue;
    const raw = typeof body[key] === "string" ? body[key].trim() : body[key];
    if (raw === null || raw === "") next[key] = null;
    else if (typeof raw !== "string") fields[key] = "Must be text.";
    else if (raw.length > max) fields[key] = `Must be ${max} characters or fewer.`;
    else next[key] = raw;
  }

  if (body.signature !== undefined) {
    const sig = body.signature;
    if (sig === null || sig === "") next.signature = null;
    else if (typeof sig !== "string" || !SIGNATURE_RE.test(sig) || sig.length > MAX_SIGNATURE_CHARS) {
      fields.signature = "The signature must be a PNG image of up to about 400 KB.";
    } else next.signature = sig;
  }
  if (next.signature && !next.signatory_name) fields.signatory_name = "Enter the signatory's name to go with the signature.";

  if (Object.keys(fields).length) {
    return res.status(400).json({ error: "Please correct the highlighted fields.", fields });
  }
  await db.query(
    `INSERT INTO settings (key, value, updated_at) VALUES ('company', $1::jsonb, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [JSON.stringify(next)],
  );
  res.json({ success: true, company: next });
});

export default router;

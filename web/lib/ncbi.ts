// Server-side wrapper around NCBI EUtils efetch. Returns FASTA text.

const EUTILS_BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";

export class NcbiError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
  }
}

export function isLikelyAccession(s: string): boolean {
  const trimmed = s.trim();
  if (!trimmed) return false;
  // Common prefixes: NC_, NZ_, NW_, GCA_, GCF_, CP, AP, BX, CY, etc.
  // Be permissive — let NCBI reject the bad ones.
  return /^[A-Z]{1,3}_?[A-Z0-9.]{4,30}$/.test(trimmed);
}

export async function fetchAccessionFasta(accession: string): Promise<{ fasta: string; bytes: number }> {
  if (!isLikelyAccession(accession)) {
    throw new NcbiError(`accession looks malformed: ${accession}`);
  }
  const url = new URL(`${EUTILS_BASE}/efetch.fcgi`);
  url.searchParams.set("db", "nuccore");
  url.searchParams.set("id", accession.trim());
  url.searchParams.set("rettype", "fasta");
  url.searchParams.set("retmode", "text");

  const apiKey = process.env.NCBI_API_KEY;
  if (apiKey) url.searchParams.set("api_key", apiKey);

  const r = await fetch(url, { headers: { "user-agent": "NP-Master/0.3 (https://np-master-web.vercel.app)" } });
  if (!r.ok) {
    throw new NcbiError(`NCBI returned ${r.status}`, r.status);
  }
  const text = await r.text();
  if (!text.startsWith(">")) {
    throw new NcbiError(`NCBI response not a FASTA (first 100 chars: ${text.slice(0, 100)})`);
  }
  return { fasta: text, bytes: new TextEncoder().encode(text).length };
}

export async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

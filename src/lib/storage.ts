import "server-only";
import { supabaseAdmin } from "@/lib/supabase";

/** Private bucket holding customer sales-tax exemption certificates. */
export const TAX_EXEMPT_BUCKET = "tax-exempt-certs";

export const TAX_EXEMPT_DOC_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;

export const TAX_EXEMPT_DOC_MAX_BYTES = 10 * 1024 * 1024; // 10 MB

let bucketReady = false;

/** Create the private bucket on first use; a re-create error just means it exists. */
export async function ensureTaxExemptBucket(): Promise<void> {
  if (bucketReady) return;
  const admin = supabaseAdmin();
  const { error } = await admin.storage.createBucket(TAX_EXEMPT_BUCKET, { public: false });
  // "already exists" (409 / "Bucket already exists") is the normal path.
  if (error && !/exist/i.test(error.message)) throw new Error(error.message);
  bucketReady = true;
}

/** Filesystem-safe version of an uploaded filename. */
export function safeFileName(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/_+/g, "_").slice(-120) || "file";
}

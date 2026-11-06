import { HttpError } from "@/lib/auth";

// Transactional email through Brevo's REST API (server-only).
// BREVO_API_KEY      — an API key (SMTP & API → API Keys in Brevo).
// BREVO_SENDER_EMAIL — a sender verified in Brevo (Senders, Domains & Dedicated IPs).
// BREVO_SENDER_NAME  — optional display name (default "Chef and Beyond").

export function brevoConfigured(): boolean {
  return !!process.env.BREVO_API_KEY && !!process.env.BREVO_SENDER_EMAIL;
}

export async function sendBrevoEmail(opts: {
  to: string[];
  subject: string;
  html: string;
  replyTo?: string;
  cc?: string[];
}): Promise<void> {
  const apiKey = process.env.BREVO_API_KEY;
  const senderEmail = process.env.BREVO_SENDER_EMAIL;
  if (!apiKey || !senderEmail) {
    throw new HttpError(
      503,
      "Email isn't set up yet — add BREVO_API_KEY and BREVO_SENDER_EMAIL to the server environment.",
    );
  }
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": apiKey, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      sender: { email: senderEmail, name: process.env.BREVO_SENDER_NAME || "Chef and Beyond" },
      to: opts.to.map((email) => ({ email })),
      ...(opts.cc?.length ? { cc: opts.cc.map((email) => ({ email })) } : {}),
      ...(opts.replyTo ? { replyTo: { email: opts.replyTo } } : {}),
      subject: opts.subject,
      htmlContent: opts.html,
    }),
  });
  if (!res.ok) {
    let detail = "";
    try {
      detail = ((await res.json()) as { message?: string }).message ?? "";
    } catch {
      /* non-JSON error body */
    }
    throw new HttpError(502, `Brevo rejected the email${detail ? `: ${detail}` : ` (${res.status})`}`);
  }
}

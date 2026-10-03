import "server-only";

// Transactional email via the Resend REST API — the same service and account
// the web store uses (chefandbeyond.com is verified there). Inert when
// RESEND_API_KEY is unset: sendEmail() returns { ok: false } with a message
// the UI can show, and nothing else breaks.
//
// Env (Vercel → Settings → Environment Variables):
//   RESEND_API_KEY   required to send
//   EMAIL_FROM       optional sender; defaults to the sales mailbox below.
//                    Must be an address on a domain verified in Resend.

const DEFAULT_FROM = "Chef and Beyond <sales@chefandbeyond.com>";

export type SendResult = { ok: boolean; id?: string; error?: string };

export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
  attachments?: { filename: string; content: string }[]; // content = base64
}): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, error: "Email isn't set up yet (RESEND_API_KEY is missing on the server)." };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM || DEFAULT_FROM,
        to: [opts.to],
        subject: opts.subject,
        html: opts.html,
        ...(opts.replyTo ? { reply_to: opts.replyTo } : {}),
        ...(opts.attachments?.length ? { attachments: opts.attachments } : {}),
      }),
    });
    const data = (await res.json().catch(() => null)) as { id?: string; message?: string } | null;
    if (!res.ok) return { ok: false, error: data?.message ?? `Email service error ${res.status}.` };
    return { ok: true, id: data?.id };
  } catch {
    return { ok: false, error: "Could not reach the email service." };
  }
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** The short cover note that goes with the attached invoice PDF. */
export function invoiceEmailBody(o: {
  label: string; // "Invoice #1042" / "Receipt #1042"
  firstName: string;
  total: string;
  balanceDue: string | null; // formatted, or null when fully paid
  dueDate: string | null;
  storeName: string;
  phone: string;
}): { subject: string; html: string } {
  const paidLine = o.balanceDue
    ? `Balance due: <strong>${esc(o.balanceDue)}</strong>${o.dueDate ? ` by ${esc(o.dueDate)}` : ""}.`
    : `Total: <strong>${esc(o.total)}</strong> — paid in full. Thank you!`;
  return {
    subject: `${o.label} from ${o.storeName} — ${o.total}`,
    html: `
      <div style="font-family:system-ui,sans-serif;max-width:520px;color:#1f262b">
        <h2 style="font-size:20px;margin:0 0 12px">Your ${esc(o.label.toLowerCase())} is attached</h2>
        <p>Hi ${esc(o.firstName) || "there"},</p>
        <p>${esc(o.label)} from ${esc(o.storeName)} is attached as a PDF. ${paidLine}</p>
        <p style="color:#6a7681;font-size:13px">Questions? Reply to this email${o.phone ? ` or call ${esc(o.phone)}` : ""}.</p>
      </div>`,
  };
}

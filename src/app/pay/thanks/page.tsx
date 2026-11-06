const COPY: Record<string, { title: string; body: string }> = {
  success: {
    title: "Payment received",
    body: "Thank you! Your payment went through — a receipt is on its way from Stripe.",
  },
  paid: { title: "Already paid", body: "This invoice has been paid in full. Thank you!" },
  cancelled: {
    title: "Payment cancelled",
    body: "No charge was made. You can use the Pay now button in your email whenever you're ready.",
  },
  error: {
    title: "Something went wrong",
    body: "We couldn't start the payment. Please try again, or contact us and we'll help.",
  },
  invalid: {
    title: "Link not valid",
    body: "This payment link isn't valid. Please contact us and we'll help.",
  },
};

export default async function PayThanks({ searchParams }: { searchParams: Promise<{ s?: string }> }) {
  const { s } = await searchParams;
  const c = COPY[s ?? ""] ?? COPY.invalid;
  return (
    <main className="mx-auto grid min-h-screen max-w-md place-items-center p-6 text-center">
      <div className="card w-full p-8">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-email.png" alt="Chef and Beyond" className="mx-auto mb-5 h-14 w-auto" />
        <h1 className="text-xl font-semibold">{c.title}</h1>
        <p className="mt-2 text-sm text-zinc-600">{c.body}</p>
      </div>
    </main>
  );
}

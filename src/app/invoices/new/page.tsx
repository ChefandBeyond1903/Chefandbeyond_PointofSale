import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { InvoiceForm } from "../InvoiceForm";

export default async function NewInvoicePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/invoices/new");
  if (user.role === "CASHIER") redirect("/invoices");
  return <InvoiceForm role={user.role} />;
}

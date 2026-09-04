import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { InvoicesView } from "./InvoicesView";

export default async function InvoicesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/invoices");
  return (
    <InvoicesView
      canManage={user.role !== "CASHIER"}
      isAdmin={user.role === "ADMIN"}
    />
  );
}

import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { PurchaseOrderForm } from "../PurchaseOrderForm";

export default async function NewPurchaseOrderPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/purchase-orders/new");
  if (user.role !== "MANAGER") redirect("/");
  return <PurchaseOrderForm />;
}

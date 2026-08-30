import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { PurchaseOrderForm } from "../PurchaseOrderForm";

export default async function EditPurchaseOrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/purchase-orders");
  const { id } = await params;
  return <PurchaseOrderForm id={id} readOnly={user.role === "CASHIER"} />;
}

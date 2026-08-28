import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { PurchaseOrdersView } from "./PurchaseOrdersView";

export default async function PurchaseOrdersPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/purchase-orders");
  if (user.role !== "MANAGER") redirect("/");
  return <PurchaseOrdersView />;
}

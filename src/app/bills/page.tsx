import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { BillsView } from "./BillsView";

export default async function BillsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/bills");
  return <BillsView canManage={user.role !== "CASHIER"} />;
}

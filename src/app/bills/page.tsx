import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { BillsView } from "./BillsView";

export default async function BillsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/bills");
  if (user.role === "CASHIER") redirect("/");
  return <BillsView canManage isAdmin={user.role === "ADMIN"} />;
}

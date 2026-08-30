import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { ReportsView } from "./ReportsView";

export default async function ReportsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/reports");
  if (user.role === "CASHIER") redirect("/");
  return <ReportsView isAdmin={user.role === "ADMIN"} />;
}

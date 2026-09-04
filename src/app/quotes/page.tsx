import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { QuotesView } from "./QuotesView";

export default async function QuotesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/quotes");
  return (
    <QuotesView
      canManage={user.role !== "CASHIER"}
      isAdmin={user.role === "ADMIN"}
    />
  );
}

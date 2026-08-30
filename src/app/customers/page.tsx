import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { CustomersView } from "./CustomersView";

export default async function CustomersPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/customers");
  return <CustomersView canManage={user.role !== "CASHIER"} />;
}

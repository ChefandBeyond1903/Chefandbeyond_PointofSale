import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { VendorsView } from "./VendorsView";

export default async function VendorsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/vendors");
  return <VendorsView canManage={user.role !== "CASHIER"} />;
}

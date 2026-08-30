import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { InventoryView } from "./InventoryView";

export default async function InventoryPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/inventory");
  return <InventoryView />;
}

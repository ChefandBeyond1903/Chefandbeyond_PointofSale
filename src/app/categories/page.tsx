import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { CategoriesView } from "./CategoriesView";

export default async function CategoriesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/categories");
  return <CategoriesView canManage={user.role !== "CASHIER"} />;
}

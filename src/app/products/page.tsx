import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { ProductManager } from "./ProductManager";

export default async function ProductsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/products");
  if (user.role !== "MANAGER") redirect("/");
  return <ProductManager />;
}

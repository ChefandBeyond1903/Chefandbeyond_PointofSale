import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { UserManager } from "./UserManager";

export default async function UsersPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/users");
  if (user.role === "CASHIER") redirect("/");
  return <UserManager currentUserId={user.id} currentRole={user.role} />;
}

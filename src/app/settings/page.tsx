import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { SettingsView } from "./SettingsView";

export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/settings");
  if (user.role === "CASHIER") redirect("/");
  return <SettingsView isAdmin={user.role === "ADMIN"} />;
}

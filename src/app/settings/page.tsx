import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { SettingsView } from "./SettingsView";

export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/settings");
  if (user.role !== "MANAGER") redirect("/");
  return <SettingsView />;
}

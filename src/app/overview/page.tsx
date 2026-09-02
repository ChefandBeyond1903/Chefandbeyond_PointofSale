import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { OverviewView } from "./OverviewView";

export default async function OverviewPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/overview");
  if (user.role !== "ADMIN") redirect("/");
  return <OverviewView />;
}

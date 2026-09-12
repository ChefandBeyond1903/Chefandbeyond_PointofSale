import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { TransfersView } from "./TransfersView";

export default async function TransfersPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/transfers");
  return <TransfersView />;
}

import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { PayrollView } from "./PayrollView";

// Payroll holds wages and tax details — admin only.
export default async function PayrollPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/payroll");
  if (user.role !== "ADMIN") redirect("/");
  return <PayrollView />;
}

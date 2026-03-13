import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import CardBrowser from "./CardBrowser";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <div className="container mx-auto p-6">
      <h1 className="text-3xl font-bold mb-6">TCG Tracker</h1>
      <CardBrowser />
    </div>
  );
}

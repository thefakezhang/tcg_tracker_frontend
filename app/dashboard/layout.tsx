import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DashboardShell } from "./DashboardShell";
import { BuyerShell } from "./BuyerShell";
import { principalFromAccessToken } from "@/lib/principal";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const userInfo = {
    email: user.email ?? "",
    name: user.user_metadata?.full_name ?? user.user_metadata?.name,
  };

  // A buying agent gets his list and nothing else. This is presentation, not
  // access control - the database refuses him everything else regardless - but
  // showing him the operator sidebar would be a menu of guaranteed errors.
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (principalFromAccessToken(session?.access_token) === "buyer") {
    return <BuyerShell email={userInfo.email} />;
  }

  return <DashboardShell user={userInfo}>{children}</DashboardShell>;
}

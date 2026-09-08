// The operator looking at the buying agent's screen.
//
// There was no way to. The shell is chosen from the role claim and every
// buyer_* reader scopes on the caller's email, so an operator opening the
// agent's URL got their own empty list - and could only learn what he was
// seeing by asking him. That is how an agent spent his first day on a
// Google-translated page with an unreadable dropdown before anyone knew.
//
// This is the real screen, not a mock of it: the same component, reading the
// same RPCs. Migration 000441 lets an administrator READ any sent plan through
// them, and still refuses every write, so nothing here can put words in his
// mouth - what he recorded is his account of what he did.
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { principalFromAccessToken } from "@/lib/principal";
import { BuyerShell } from "../BuyerShell";

export default async function BuyerViewPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: { session } } = await supabase.auth.getSession();
  const principal = principalFromAccessToken(session?.access_token);
  // A buyer reaching this URL is just on their own screen by another name.
  if (principal !== "administrator" && principal !== "buyer") redirect("/dashboard");

  return <BuyerShell email={user.email ?? ""} viewingAs={principal === "administrator"} />;
}

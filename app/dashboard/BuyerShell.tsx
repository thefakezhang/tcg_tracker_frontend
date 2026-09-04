"use client";

import BuyerOrderView from "./BuyerOrderView";
import BuyerFloatStrip from "./BuyerFloatStrip";
import { createClient } from "@/lib/supabase/client";

// What a buying agent sees: his list, and nothing else.
//
// CUJ B says he signs in and lands directly on his assigned list - no
// navigation, no dashboard. Showing him the operator sidebar would be worse
// than useless: every other view would fail at the database, so he would be
// clicking through a menu of errors.
export function BuyerShell({ email }: { email: string }) {
  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between border-b px-4 py-2">
        <h1 className="font-semibold">Purchase list</h1>
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <span>{email}</span>
          <button
            className="underline underline-offset-2"
            onClick={async () => {
              await createClient().auth.signOut();
              window.location.href = "/login";
            }}
          >
            Sign out
          </button>
        </div>
      </header>
      <BuyerFloatStrip />
      <BuyerOrderView />
    </div>
  );
}

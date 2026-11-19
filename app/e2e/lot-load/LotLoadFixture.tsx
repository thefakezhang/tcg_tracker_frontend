"use client";

import { useState } from "react";
import LotManager from "@/app/dashboard/trip/LotManager";
import { Button } from "@/components/ui/button";

export default function LotLoadFixture() {
  const [open, setOpen] = useState(true);
  return <main className="mx-auto max-w-6xl p-4">
    <Button className="mb-4" onClick={() => setOpen((value) => !value)}>{open ? "Close lots" : "Open lots"}</Button>
    {open && <LotManager tripId={7} leg="import" />}
  </main>;
}

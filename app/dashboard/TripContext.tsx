"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export interface Trip {
  trip_id: number;
  name: string;
  status: string;
  started_at: string | null;
  ended_at: string | null;
  notes: string | null;
  created_at: string;
}

interface TripContextValue {
  trips: Trip[];
  activeTripId: number | null;
  setActiveTripId: (id: number | null) => void;
  fetchTrips: () => Promise<void>;
  createTrip: (
    name: string,
    startedAt: string | null,
    endedAt: string | null,
    notes: string | null
  ) => Promise<void>;
  deleteTrip: (tripId: number) => Promise<void>;
}

const TripContext = createContext<TripContextValue | null>(null);

export function TripProvider({ children }: { children: React.ReactNode }) {
  const [trips, setTrips] = useState<Trip[]>([]);
  const [activeTripId, setActiveTripId] = useState<number | null>(null);

  const fetchTrips = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("trips")
      .select("trip_id, name, status, started_at, ended_at, notes, created_at")
      .order("created_at", { ascending: false });
    setTrips((data as Trip[]) ?? []);
  }, []);

  useEffect(() => {
    fetchTrips();
  }, [fetchTrips]);

  const createTrip = useCallback(
    async (
      name: string,
      startedAt: string | null,
      endedAt: string | null,
      notes: string | null
    ) => {
      const supabase = createClient();
      await supabase.from("trips").insert({
        name,
        started_at: startedAt,
        ended_at: endedAt,
        notes,
        status: "active",
      });
      await fetchTrips();
    },
    [fetchTrips]
  );

  const deleteTrip = useCallback(
    async (tripId: number) => {
      const supabase = createClient();
      // export_goods / export_good_sales / trip_expenses cascade via FK;
      // acquisition_lots.trip_id is ON DELETE SET NULL (inventory history kept).
      await supabase.from("trips").delete().eq("trip_id", tripId);
      if (activeTripId === tripId) setActiveTripId(null);
      await fetchTrips();
    },
    [fetchTrips, activeTripId]
  );

  return (
    <TripContext
      value={{
        trips,
        activeTripId,
        setActiveTripId,
        fetchTrips,
        createTrip,
        deleteTrip,
      }}
    >
      {children}
    </TripContext>
  );
}

export function useTrips() {
  const ctx = useContext(TripContext);
  if (!ctx) throw new Error("useTrips must be used within TripProvider");
  return ctx;
}

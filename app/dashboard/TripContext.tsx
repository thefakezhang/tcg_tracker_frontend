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
  updateTrip: (
    tripId: number,
    fields: Partial<Pick<Trip, "name" | "started_at" | "ended_at" | "status" | "notes">>
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

  const updateTrip = useCallback(
    async (
      tripId: number,
      fields: Partial<Pick<Trip, "name" | "started_at" | "ended_at" | "status" | "notes">>
    ) => {
      const supabase = createClient();
      await supabase.from("trips").update(fields).eq("trip_id", tripId);
      await fetchTrips();
    },
    [fetchTrips]
  );

  const deleteTrip = useCallback(
    async (tripId: number) => {
      const supabase = createClient();
      // export_goods / export_good_sales / trip_expenses cascade via FK;
      // acquisition_lots.trip_id is ON DELETE SET NULL (inventory history kept).
      // Navigation away from a deleted trip is the caller's responsibility so it
      // can be deferred until the confirm dialog has fully closed (otherwise the
      // dashboard + dialog unmount mid-close and base-ui leaves the body's
      // pointer-events lock on, freezing the page until a refresh).
      await supabase.from("trips").delete().eq("trip_id", tripId);
      await fetchTrips();
    },
    [fetchTrips]
  );

  return (
    <TripContext
      value={{
        trips,
        activeTripId,
        setActiveTripId,
        fetchTrips,
        createTrip,
        updateTrip,
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

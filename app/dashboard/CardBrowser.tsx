"use client";

import { useEffect, useState, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type Tab = "pokemon" | "mtg";

const TABLE_MAP: Record<Tab, string> = {
  pokemon: "pokemon_card_definitions",
  mtg: "mtg_card_definitions",
};

interface CardDefinition {
  card_id: string;
  regional_name: string;
  set_code: string;
}

export default function CardBrowser() {
  const [activeTab, setActiveTab] = useState<Tab>("pokemon");
  const [search, setSearch] = useState("");
  const [data, setData] = useState<CardDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(() => {
      fetchCards();
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [activeTab, search]);

  async function fetchCards() {
    setLoading(true);
    setError(null);

    const supabase = createClient();
    let query = supabase
      .from(TABLE_MAP[activeTab])
      .select("card_id, regional_name, set_code");

    if (search.trim()) {
      query = query.ilike("regional_name", `%${search.trim()}%`);
    }

    const { data, error } = await query;

    if (error) {
      setError(error.message);
      setData([]);
    } else {
      setData(data ?? []);
    }
    setLoading(false);
  }

  return (
    <div className="space-y-4">
      <Tabs
        value={activeTab}
        onValueChange={(value) => {
          setActiveTab(value as Tab);
          setSearch("");
        }}
      >
        <TabsList variant="line">
          <TabsTrigger value="pokemon">Pokemon</TabsTrigger>
          <TabsTrigger value="mtg">MTG</TabsTrigger>
        </TabsList>
      </Tabs>

      <Input
        type="text"
        placeholder="Search by name..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-sm"
      />

      {error && (
        <p className="text-destructive text-sm">Error: {error}</p>
      )}

      {loading ? (
        <p className="text-muted-foreground">Loading...</p>
      ) : (
        <div className="rounded-md border max-w-2xl">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Set Code</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={2} className="text-center">
                    No results found
                  </TableCell>
                </TableRow>
              ) : (
                data.map((card) => (
                  <TableRow key={card.card_id}>
                    <TableCell>{card.regional_name}</TableCell>
                    <TableCell>{card.set_code}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

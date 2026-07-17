"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { type Game, useGame } from "./GameContext";
import { useTranslation, type TranslationKey } from "@/lib/i18n";
import { useLanguage } from "./LanguageContext";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AccountMenuContent } from "./AccountMenuContent";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ChevronsUpDown, ListChecks, Loader2, Luggage, Package, Plus, ShoppingCart, Sparkles, Squirrel } from "lucide-react";
import { VIEWS, type ViewDef } from "./views";
import { useBuyList } from "./BuyListContext";
import { useTrips } from "./TripContext";
import { useSaving } from "@/lib/use-saving";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldGroup } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { useCurrency } from "./CurrencyContext";

const GAME_ICONS: Record<Game, React.ReactNode> = {
  pokemon: <Squirrel className="size-4" />,
  mtg: <Sparkles className="size-4" />,
  pokemon_sealed: <Package className="size-4" />,
};

const GAMES: Game[] = ["pokemon", "mtg", "pokemon_sealed"];

interface AppSidebarProps {
  user: { email: string; name?: string };
}

// One sidebar nav button for a registry-defined view. Centralizes the paired
// setActiveTripId + clear-buylist that every top-level nav item used to do by hand.
function ViewButton({ v }: { v: ViewDef }) {
  const { t } = useTranslation();
  const { activeTripId, setActiveTripId } = useTrips();
  const { setActiveBuylistId } = useBuyList();
  const Icon = v.icon;
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={activeTripId === v.sentinel}
        onClick={() => { setActiveTripId(v.sentinel); setActiveBuylistId(null); }}
      >
        <Icon className="size-4" />
        {t(v.sidebarKey)}
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

export function AppSidebar({ user }: AppSidebarProps) {
  const { activeGame, setActiveGame } = useGame();
  const { language, setLanguage } = useLanguage();
  const { displayCurrency, setDisplayCurrency } = useCurrency();
  const { buylists, activeBuylistId, setActiveBuylistId, createBuylist } = useBuyList();
  const { trips, activeTripId, setActiveTripId, createTrip } = useTrips();
  const { t } = useTranslation();
  const { saving, save } = useSaving();
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [tripOpen, setTripOpen] = useState(false);
  const [tripName, setTripName] = useState("");
  const [tripStart, setTripStart] = useState("");
  const [tripEnd, setTripEnd] = useState("");

  const displayName = user.name ?? user.email;
  const initials = displayName
    .split(/[\s@]+/)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? "")
    .join("");

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  }

  return (
    <Sidebar>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <span className="flex items-center gap-2 px-2 py-1.5 text-lg font-bold">
              <ListChecks className="size-5" />
              {t("app.title")}
            </span>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>{t("sidebar.cardListings")}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {GAMES.map((game) => (
                <SidebarMenuItem key={game}>
                  <SidebarMenuButton
                    isActive={activeGame === game && activeBuylistId === null && activeTripId === null}
                    onClick={() => { setActiveGame(game); setActiveBuylistId(null); setActiveTripId(null); }}
                  >
                    {GAME_ICONS[game]}
                    {t(`game.${game}` as TranslationKey)}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>{t("sidebar.buyLists")}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {buylists.map((bl) => (
                <SidebarMenuItem key={bl.buylist_id}>
                  <SidebarMenuButton
                    isActive={activeBuylistId === bl.buylist_id}
                    onClick={() => { setActiveBuylistId(bl.buylist_id); setActiveTripId(null); }}
                  >
                    <ShoppingCart className="size-4" />
                    <span className="truncate">{bl.name}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
              <SidebarMenuItem>
                <SidebarMenuButton onClick={() => setCreateOpen(true)}>
                  <Plus className="size-4" />
                  {t("buyList.create")}
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>{t("curation.title")}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {VIEWS.filter((v) => v.group === "curation.title").map((v) => (
                <ViewButton key={v.sentinel} v={v} />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>{t("catalog.section")}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {VIEWS.filter((v) => v.group === "catalog.section").map((v) => (
                <ViewButton key={v.sentinel} v={v} />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>{t("customers.section")}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {VIEWS.filter((v) => v.group === "customers.section").map((v) => (
                <ViewButton key={v.sentinel} v={v} />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>{t("sidebar.trips")}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {VIEWS.filter((v) => v.group === "sidebar.trips").map((v) => (
                <ViewButton key={v.sentinel} v={v} />
              ))}
              {trips.map((tr) => (
                <SidebarMenuItem key={tr.trip_id}>
                  <SidebarMenuButton
                    isActive={activeTripId === tr.trip_id}
                    onClick={() => { setActiveTripId(tr.trip_id); setActiveBuylistId(null); }}
                  >
                    <Luggage className="size-4" />
                    <span className="truncate">{tr.name}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
              <SidebarMenuItem>
                <SidebarMenuButton onClick={() => setTripOpen(true)}>
                  <Plus className="size-4" />
                  {t("trips.create")}
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("buyList.create")}</DialogTitle>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <Label htmlFor="buylist-name">{t("buyList.name")}</Label>
              <Input
                id="buylist-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                autoFocus
              />
            </Field>
            <Field>
              <Label htmlFor="buylist-description">{t("buyList.description")}</Label>
              <Textarea
                id="buylist-description"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                rows={3}
              />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              {t("buyList.cancel")}
            </Button>
            <Button
              disabled={!newName.trim()}
              onClick={async () => {
                await createBuylist(newName.trim(), newDescription.trim() || null);
                setNewName("");
                setNewDescription("");
                setCreateOpen(false);
              }}
            >
              {t("buyList.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={tripOpen} onOpenChange={setTripOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("trips.create")}</DialogTitle>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <Label htmlFor="trip-name">{t("trips.name")}</Label>
              <Input id="trip-name" value={tripName} onChange={(e) => setTripName(e.target.value)} autoFocus />
            </Field>
            <Field>
              <Label htmlFor="trip-start">{t("trips.startedAt")}</Label>
              <Input id="trip-start" type="date" value={tripStart} onChange={(e) => setTripStart(e.target.value)} />
            </Field>
            <Field>
              <Label htmlFor="trip-end">{t("trips.endedAt")}</Label>
              <Input id="trip-end" type="date" value={tripEnd} onChange={(e) => setTripEnd(e.target.value)} />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button variant="outline" disabled={saving} onClick={() => setTripOpen(false)}>{t("trips.cancel")}</Button>
            <Button
              disabled={!tripName.trim() || saving}
              onClick={async () => {
                const ok = await save(() => createTrip(tripName.trim(), tripStart || null, tripEnd || null, null));
                if (!ok) return;
                setTripName(""); setTripStart(""); setTripEnd("");
                setTripOpen(false);
              }}
            >
              {saving ? <Loader2 className="size-4 animate-spin" /> : t("trips.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <SidebarMenuButton className="h-auto py-2">
                    <Avatar className="size-6">
                      <AvatarFallback className="text-xs">
                        {initials}
                      </AvatarFallback>
                    </Avatar>
                    <span className="truncate">{displayName}</span>
                    <ChevronsUpDown className="ml-auto size-4" />
                  </SidebarMenuButton>
                }
              />
              <AccountMenuContent
                t={t}
                language={language}
                onLanguageChange={setLanguage}
                currency={displayCurrency}
                onCurrencyChange={setDisplayCurrency}
                onLogout={handleLogout}
              />
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}

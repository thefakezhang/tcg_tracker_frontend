"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { type Game, useGame } from "./GameContext";
import { useTranslation, type TranslationKey } from "@/lib/i18n";
import {
  type Language,
  useLanguage,
  LANGUAGE_LABELS,
} from "./LanguageContext";
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
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Boxes, ChevronsUpDown, DollarSign, Globe, ListChecks, Loader2, LogOut, Luggage, Map, Package, Plus, ShoppingCart, Sparkles, Squirrel, Trash2 } from "lucide-react";
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
import {
  type DisplayCurrency,
  useCurrency,
  CURRENCY_LABELS,
} from "./CurrencyContext";

const GAME_ICONS: Record<Game, React.ReactNode> = {
  pokemon: <Squirrel className="size-4" />,
  mtg: <Sparkles className="size-4" />,
  pokemon_sealed: <Package className="size-4" />,
};

const GAMES: Game[] = ["pokemon", "mtg", "pokemon_sealed"];

interface AppSidebarProps {
  user: { email: string; name?: string };
}

const LANGUAGES = Object.keys(LANGUAGE_LABELS) as Language[];
const CURRENCIES = Object.keys(CURRENCY_LABELS) as DisplayCurrency[];

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
          <SidebarGroupLabel>{t("sidebar.trips")}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={activeTripId === 0}
                  onClick={() => { setActiveTripId(0); setActiveBuylistId(null); }}
                >
                  <Map className="size-4" />
                  {t("trips.overviewTitle")}
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={activeTripId === -1}
                  onClick={() => { setActiveTripId(-1); setActiveBuylistId(null); }}
                >
                  <Boxes className="size-4" />
                  {t("inventory.title")}
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={activeTripId === -2}
                  onClick={() => { setActiveTripId(-2); setActiveBuylistId(null); }}
                >
                  <DollarSign className="size-4" />
                  {t("sales.allTitle")}
                </SidebarMenuButton>
              </SidebarMenuItem>
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
              <DropdownMenuContent side="top" align="start">
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <Globe className="mr-2 size-4" />
                    {t("sidebar.language")}
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    <DropdownMenuRadioGroup
                      value={language}
                      onValueChange={(v) => setLanguage(v as Language)}
                    >
                      {LANGUAGES.map((lang) => (
                        <DropdownMenuRadioItem key={lang} value={lang}>
                          {LANGUAGE_LABELS[lang]}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <DollarSign className="mr-2 size-4" />
                    {t("sidebar.convertCurrency")}
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    <DropdownMenuRadioGroup
                      value={displayCurrency}
                      onValueChange={(v) => setDisplayCurrency(v as DisplayCurrency)}
                    >
                      {CURRENCIES.map((c) => (
                        <DropdownMenuRadioItem key={c} value={c}>
                          {CURRENCY_LABELS[c]}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleLogout}>
                  <LogOut className="mr-2 size-4" />
                  {t("sidebar.logOut")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}

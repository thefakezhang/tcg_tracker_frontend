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
import { ChevronsUpDown, DollarSign, Globe, ListChecks, LogOut, Sparkles, Squirrel } from "lucide-react";
import {
  type DisplayCurrency,
  useCurrency,
  CURRENCY_LABELS,
} from "./CurrencyContext";

const GAME_ICONS: Record<Game, React.ReactNode> = {
  pokemon: <Squirrel className="size-4" />,
  mtg: <Sparkles className="size-4" />,
};

const GAMES: Game[] = ["pokemon", "mtg"];

interface AppSidebarProps {
  user: { email: string; name?: string };
}

const LANGUAGES = Object.keys(LANGUAGE_LABELS) as Language[];
const CURRENCIES = Object.keys(CURRENCY_LABELS) as DisplayCurrency[];

export function AppSidebar({ user }: AppSidebarProps) {
  const { activeGame, setActiveGame } = useGame();
  const { language, setLanguage } = useLanguage();
  const { displayCurrency, setDisplayCurrency } = useCurrency();
  const { t } = useTranslation();
  const router = useRouter();

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
                    isActive={activeGame === game}
                    onClick={() => setActiveGame(game)}
                  >
                    {GAME_ICONS[game]}
                    {t(`game.${game}` as TranslationKey)}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
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

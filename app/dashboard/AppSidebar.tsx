"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { type Game, useGame, GAME_LABELS } from "./GameContext";
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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ChevronsUpDown, ListChecks, LogOut, Sparkles, Squirrel } from "lucide-react";

const GAME_ICONS: Record<Game, React.ReactNode> = {
  pokemon: <Squirrel className="size-4" />,
  mtg: <Sparkles className="size-4" />,
};

const GAMES = Object.keys(GAME_LABELS) as Game[];

interface AppSidebarProps {
  user: { email: string; name?: string };
}

export function AppSidebar({ user }: AppSidebarProps) {
  const { activeGame, setActiveGame } = useGame();
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
              TCG Tracker
            </span>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Card Listings</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {GAMES.map((game) => (
                <SidebarMenuItem key={game}>
                  <SidebarMenuButton
                    isActive={activeGame === game}
                    onClick={() => setActiveGame(game)}
                  >
                    {GAME_ICONS[game]}
                    {GAME_LABELS[game]}
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
                <DropdownMenuItem onClick={handleLogout}>
                  <LogOut className="mr-2 size-4" />
                  Log out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}

"use client";

import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar";
import { GameProvider, useGame, GAME_LABELS } from "./GameContext";
import { AppSidebar } from "./AppSidebar";

interface DashboardShellProps {
  user: { email: string; name?: string };
  children: React.ReactNode;
}

function DashboardHeader() {
  const { activeGame } = useGame();
  return (
    <header className="flex h-12 items-center gap-2 border-b px-4">
      <SidebarTrigger />
      <h1 className="text-lg font-semibold">{GAME_LABELS[activeGame]}</h1>
    </header>
  );
}

export function DashboardShell({ user, children }: DashboardShellProps) {
  return (
    <GameProvider>
      <SidebarProvider>
        <AppSidebar user={user} />
        <SidebarInset>
          <DashboardHeader />
          <main className="p-6">{children}</main>
        </SidebarInset>
      </SidebarProvider>
    </GameProvider>
  );
}

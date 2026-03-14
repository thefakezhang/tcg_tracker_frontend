"use client";

import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar";
import { GameProvider, useGame, GAME_LABELS } from "./GameContext";
import { HeaderProvider, useHeader } from "./HeaderContext";
import { LanguageProvider } from "./LanguageContext";
import { AppSidebar } from "./AppSidebar";

interface DashboardShellProps {
  user: { email: string; name?: string };
  children: React.ReactNode;
}

function DashboardHeader() {
  const { activeGame } = useGame();
  const { headerActions } = useHeader();
  return (
    <header className="flex h-12 items-center border-b pl-5 pr-6">
      <SidebarTrigger />
      <h1 className="ml-2 text-lg font-semibold">{GAME_LABELS[activeGame]}</h1>
      {headerActions && (
        <div className="ml-auto flex items-center gap-2">{headerActions}</div>
      )}
    </header>
  );
}

export function DashboardShell({ user, children }: DashboardShellProps) {
  return (
    <LanguageProvider>
      <GameProvider>
        <HeaderProvider>
          <SidebarProvider>
            <AppSidebar user={user} />
            <SidebarInset>
              <DashboardHeader />
              <main className="p-6">{children}</main>
            </SidebarInset>
          </SidebarProvider>
        </HeaderProvider>
      </GameProvider>
    </LanguageProvider>
  );
}

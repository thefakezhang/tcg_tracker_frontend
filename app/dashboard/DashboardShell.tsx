"use client";

import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { GameProvider, useGame } from "./GameContext";
import { HeaderProvider, useHeader } from "./HeaderContext";
import { LanguageProvider } from "./LanguageContext";
import { CurrencyProvider } from "./CurrencyContext";
import { BuyListProvider, useBuyList } from "./BuyListContext";
import { useTranslation, type TranslationKey } from "@/lib/i18n";
import { AppSidebar } from "./AppSidebar";

interface DashboardShellProps {
  user: { email: string; name?: string };
  children: React.ReactNode;
}

function DashboardHeader() {
  const { activeGame } = useGame();
  const { headerActions } = useHeader();
  const { activeBuylistId, buylists } = useBuyList();
  const { t } = useTranslation();

  const activeBuylist = activeBuylistId
    ? buylists.find((b) => b.buylist_id === activeBuylistId)
    : null;
  const title = activeBuylist?.name ?? t(`game.${activeGame}` as TranslationKey);
  const description = activeBuylist?.description;

  return (
    <header className="flex h-12 items-center border-b pl-5 pr-6">
      <SidebarTrigger />
      {description ? (
        <Tooltip>
          <TooltipTrigger render={<h1 className="ml-2 text-lg font-semibold cursor-default" />}>
            {title}
          </TooltipTrigger>
          <TooltipContent>{description}</TooltipContent>
        </Tooltip>
      ) : (
        <h1 className="ml-2 text-lg font-semibold">{title}</h1>
      )}
      {headerActions && (
        <div className="ml-auto flex items-center gap-2">{headerActions}</div>
      )}
    </header>
  );
}

export function DashboardShell({ user, children }: DashboardShellProps) {
  return (
    <LanguageProvider>
      <CurrencyProvider>
      <GameProvider>
        <BuyListProvider>
        <HeaderProvider>
          <SidebarProvider>
            <AppSidebar user={user} />
            <SidebarInset>
              <DashboardHeader />
              <main className="p-6">{children}</main>
            </SidebarInset>
          </SidebarProvider>
        </HeaderProvider>
        </BuyListProvider>
      </GameProvider>
      </CurrencyProvider>
    </LanguageProvider>
  );
}

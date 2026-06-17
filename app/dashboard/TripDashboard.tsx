"use client";

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useTranslation } from "@/lib/i18n";
import ImportTab from "./trip/ImportTab";
import SalesTab from "./trip/SalesTab";
import ExportTab from "./trip/ExportTab";
import ExpensesTab from "./trip/ExpensesTab";
import PnlTab from "./trip/PnlTab";

export default function TripDashboard({ tripId }: { tripId: number }) {
  const { t } = useTranslation();
  return (
    <Tabs defaultValue="import" className="space-y-4">
      <TabsList>
        <TabsTrigger value="export">{t("trips.tabExport")}</TabsTrigger>
        <TabsTrigger value="import">{t("trips.tabImport")}</TabsTrigger>
        <TabsTrigger value="sales">{t("trips.tabSales")}</TabsTrigger>
        <TabsTrigger value="expenses">{t("trips.tabExpenses")}</TabsTrigger>
        <TabsTrigger value="pnl">{t("trips.tabPnl")}</TabsTrigger>
      </TabsList>
      <TabsContent value="export"><ExportTab tripId={tripId} /></TabsContent>
      <TabsContent value="import"><ImportTab tripId={tripId} /></TabsContent>
      <TabsContent value="sales"><SalesTab tripId={tripId} /></TabsContent>
      <TabsContent value="expenses"><ExpensesTab tripId={tripId} /></TabsContent>
      <TabsContent value="pnl"><PnlTab tripId={tripId} /></TabsContent>
    </Tabs>
  );
}

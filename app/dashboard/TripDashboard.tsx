"use client";

import { useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Field, FieldGroup } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { useTranslation, type TranslationKey } from "@/lib/i18n";
import { useTrips } from "./TripContext";
import ImportTab from "./trip/ImportTab";
import SalesTab from "./trip/SalesTab";
import ExportTab from "./trip/ExportTab";
import ExpensesTab from "./trip/ExpensesTab";
import PnlTab from "./trip/PnlTab";

const STATUSES = ["planning", "active", "closed"] as const;

export default function TripDashboard({ tripId }: { tripId: number }) {
  const { t } = useTranslation();
  const { trips, updateTrip, deleteTrip, setActiveTripId } = useTrips();
  const trip = trips.find((tr) => tr.trip_id === tripId);

  const [editOpen, setEditOpen] = useState(false);
  const [name, setName] = useState("");
  const [startedAt, setStartedAt] = useState("");
  const [endedAt, setEndedAt] = useState("");
  const [status, setStatus] = useState<string>("active");

  function openEdit() {
    if (!trip) return;
    setName(trip.name);
    setStartedAt(trip.started_at ?? "");
    setEndedAt(trip.ended_at ?? "");
    setStatus(trip.status);
    setEditOpen(true);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold">{trip?.name}</h2>
        {trip && <Badge variant="secondary">{t(`trips.status${trip.status[0].toUpperCase()}${trip.status.slice(1)}` as TranslationKey)}</Badge>}
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={openEdit}>
            <Pencil className="size-4 mr-1" />{t("trips.edit")}
          </Button>
          <AlertDialog>
            <AlertDialogTrigger render={<Button variant="outline" size="sm" />}>
              <Trash2 className="size-4" />
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("trips.deleteConfirm")}</AlertDialogTitle>
                <AlertDialogDescription>{t("trips.deleteConfirmDesc")}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t("trips.cancel")}</AlertDialogCancel>
                <AlertDialogAction onClick={async () => { await deleteTrip(tripId); setActiveTripId(0); }}>
                  {t("trips.delete")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

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

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>{t("trips.editTrip")}</DialogTitle></DialogHeader>
          <FieldGroup>
            <Field><Label>{t("trips.name")}</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
            <Field><Label>{t("trips.startedAt")}</Label>
              <Input type="date" value={startedAt} onChange={(e) => setStartedAt(e.target.value)} /></Field>
            <Field><Label>{t("trips.endedAt")}</Label>
              <Input type="date" value={endedAt} onChange={(e) => setEndedAt(e.target.value)} /></Field>
            <Field><Label>{t("trips.status")}</Label>
              <select value={status} onChange={(e) => setStatus(e.target.value)}
                className="h-9 rounded-md border bg-background px-2 text-sm">
                {STATUSES.map((s) => (
                  <option key={s} value={s}>{t(`trips.status${s[0].toUpperCase()}${s.slice(1)}` as TranslationKey)}</option>
                ))}
              </select>
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>{t("trips.cancel")}</Button>
            <Button disabled={!name.trim()} onClick={async () => {
              await updateTrip(tripId, {
                name: name.trim(),
                started_at: startedAt || null,
                ended_at: endedAt || null,
                status,
              });
              setEditOpen(false);
            }}>{t("trips.saveChanges")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

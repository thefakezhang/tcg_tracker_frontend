"use client";

import { useCallback, useEffect, useState } from "react";
import { Save } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface EditableProfile {
  platform: string;
  fee_pct: string;
  fixed_fee: string;
  shipping_jpy: string;
  grading_cost_jpy: string;
  grading_days: string;
  margin_pct: string;
  floor_usd: string;
  updated_at: string;
}

export default function ExitCostSettings() {
  const { t } = useTranslation();
  const [profiles, setProfiles] = useState<EditableProfile[]>([]);
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await createClient().from("exit_cost_profiles")
      .select("platform, fee_pct, fixed_fee, shipping_jpy, grading_cost_jpy, grading_days, margin_pct, floor_usd, updated_at")
      .order("platform");
    setProfiles(((data ?? []) as Record<string, unknown>[]).map((row) => ({
      platform: String(row.platform),
      fee_pct: String(Number(row.fee_pct) * 100),
      fixed_fee: String(row.fixed_fee ?? 0),
      shipping_jpy: String(row.shipping_jpy ?? 0),
      grading_cost_jpy: row.grading_cost_jpy == null ? "" : String(row.grading_cost_jpy),
      grading_days: row.grading_days == null ? "" : String(row.grading_days),
      margin_pct: String(Number(row.margin_pct) * 100),
      floor_usd: String(row.floor_usd ?? 0),
      updated_at: String(row.updated_at),
    })));
  }, []);

  useEffect(() => { load(); }, [load]);

  function edit(platform: string, field: keyof EditableProfile, value: string) {
    setProfiles((rows) => rows.map((row) => row.platform === platform ? { ...row, [field]: value } : row));
  }

  async function save(row: EditableProfile) {
    setSaving(row.platform);
    setSaved(null);
    const nullable = (value: string) => value.trim() === "" ? null : Number(value);
    const { error } = await createClient().from("exit_cost_profiles").update({
      fee_pct: Number(row.fee_pct) / 100,
      fixed_fee: Number(row.fixed_fee),
      shipping_jpy: Number(row.shipping_jpy),
      grading_cost_jpy: nullable(row.grading_cost_jpy),
      grading_days: nullable(row.grading_days),
      margin_pct: Number(row.margin_pct) / 100,
      floor_usd: Number(row.floor_usd),
      updated_at: new Date().toISOString(),
    }).eq("platform", row.platform);
    setSaving(null);
    if (!error) {
      setSaved(row.platform);
      await load();
    }
  }

  const input = (row: EditableProfile, field: keyof EditableProfile, suffix?: string) => (
    <div className="flex min-w-24 items-center gap-1">
      <Input className="h-8 min-w-20" type="number" min="0" step="0.01" value={row[field]} onChange={(event) => edit(row.platform, field, event.target.value)} />
      {suffix && <span className="text-xs text-muted-foreground">{suffix}</span>}
    </div>
  );

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="text-sm">{t("economics.costProfiles")}</CardTitle>
        <p className="text-xs text-muted-foreground">{t("economics.costProfilesHelp")}</p>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <Table>
          <TableHeader><TableRow>
            <TableHead>{t("economics.platform")}</TableHead><TableHead>{t("economics.fee")}</TableHead>
            <TableHead>{t("economics.fixedFee")}</TableHead><TableHead>{t("economics.shipping")}</TableHead>
            <TableHead>{t("economics.gradingCost")}</TableHead><TableHead>{t("economics.gradingDays")}</TableHead>
            <TableHead>{t("economics.margin")}</TableHead><TableHead>{t("economics.floor")}</TableHead><TableHead />
          </TableRow></TableHeader>
          <TableBody>{profiles.map((row) => (
            <TableRow key={row.platform}>
              <TableCell className="font-medium capitalize">{row.platform}</TableCell>
              <TableCell>{input(row, "fee_pct", "%")}</TableCell>
              <TableCell>{input(row, "fixed_fee", "USD")}</TableCell>
              <TableCell>{input(row, "shipping_jpy", "JPY")}</TableCell>
              <TableCell>{input(row, "grading_cost_jpy", "JPY")}</TableCell>
              <TableCell>{input(row, "grading_days", t("economics.days"))}</TableCell>
              <TableCell>{input(row, "margin_pct", "%")}</TableCell>
              <TableCell>{input(row, "floor_usd", "USD")}</TableCell>
              <TableCell><Button size="sm" disabled={saving === row.platform} onClick={() => save(row)}><Save className="size-3" />{saved === row.platform ? t("economics.saved") : t("economics.save")}</Button></TableCell>
            </TableRow>
          ))}</TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

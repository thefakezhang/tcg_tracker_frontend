"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/lib/i18n";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import type { GlAccount } from "./JournalEntryDialog";

interface RegRow {
  entry_date: string;
  source: string;
  source_ref: string;
  memo: string | null;
  amount_usd: number;
  running_usd: number;
}

const usd = (n: number) =>
  `$${(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const selectClass =
  "h-7 rounded border bg-transparent px-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring";
const OPERATIONAL = new Set(["lot", "sale", "expense"]);

// GnuCash-style register: every line that hit one account, with a running balance.
// For a cash account, each operational line can be reclassified to another cash
// account (this is how commingled income is moved to Cash: Personal).
export default function AccountRegisterModal({
  account, accounts, onClose, onReclassified,
}: {
  account: GlAccount | null;
  accounts: GlAccount[];
  onClose: () => void;
  onReclassified: () => void;
}) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<RegRow[]>([]);
  const [loading, setLoading] = useState(false);

  const load = () => {
    if (!account) return;
    setLoading(true);
    createClient()
      .rpc("get_account_register", { p_account_id: account.account_id })
      .then(({ data }) => { setRows((data as RegRow[]) ?? []); setLoading(false); });
  };
  useEffect(load, [account]);

  const cashAccounts = accounts.filter((a) => a.is_cash);
  const canReclass = !!account?.is_cash;

  async function reclassify(sourceRef: string, targetId: number) {
    const supabase = createClient();
    if (targetId === account?.account_id) {
      // moving back to this account = drop any override
      await supabase.from("gl_source_cash_account").delete().eq("source_ref", sourceRef);
    } else {
      await supabase.from("gl_source_cash_account").upsert(
        { source_ref: sourceRef, account_id: targetId }, { onConflict: "source_ref" }
      );
    }
    load();
    onReclassified();
  }

  return (
    <Dialog open={!!account} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {account?.name}
            {account?.code && <span className="ml-2 text-xs text-muted-foreground">{account.code}</span>}
          </DialogTitle>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">{t("gl.regDate")}</TableHead>
                <TableHead>{t("gl.regDetail")}</TableHead>
                {canReclass && <TableHead className="w-40">{t("gl.reclassTo")}</TableHead>}
                <TableHead className="text-right w-24">{t("gl.regAmount")}</TableHead>
                <TableHead className="text-right w-24">{t("gl.regBalance")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r, i) => (
                <TableRow key={i}>
                  <TableCell className="text-xs">{r.entry_date}</TableCell>
                  <TableCell className="text-xs">
                    <span className="text-muted-foreground">{r.source}</span>
                    {r.memo ? ` · ${r.memo}` : r.source_ref ? ` · ${r.source_ref}` : ""}
                  </TableCell>
                  {canReclass && (
                    <TableCell>
                      {OPERATIONAL.has(r.source) ? (
                        <select
                          className={selectClass}
                          value={account?.account_id}
                          onChange={(e) => reclassify(r.source_ref, Number(e.target.value))}
                        >
                          {cashAccounts.map((a) => (
                            <option key={a.account_id} value={a.account_id}>{a.name}</option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  )}
                  <TableCell className={`text-right tabular-nums ${r.amount_usd < 0 ? "text-destructive" : ""}`}>{usd(r.amount_usd)}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{usd(r.running_usd)}</TableCell>
                </TableRow>
              ))}
              {!loading && rows.length === 0 && (
                <TableRow><TableCell colSpan={canReclass ? 5 : 4} className="text-muted-foreground">{t("gl.regEmpty")}</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </DialogContent>
    </Dialog>
  );
}

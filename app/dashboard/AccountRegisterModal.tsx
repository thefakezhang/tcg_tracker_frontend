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

// GnuCash-style register: every line that hit one account, with a running balance.
export default function AccountRegisterModal({
  account, onClose,
}: {
  account: GlAccount | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<RegRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!account) return;
    setLoading(true);
    createClient()
      .rpc("get_account_register", { p_account_id: account.account_id })
      .then(({ data }) => { setRows((data as RegRow[]) ?? []); setLoading(false); });
  }, [account]);

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
                <TableHead className="w-28">{t("gl.regDate")}</TableHead>
                <TableHead>{t("gl.regDetail")}</TableHead>
                <TableHead className="text-right w-28">{t("gl.regAmount")}</TableHead>
                <TableHead className="text-right w-28">{t("gl.regBalance")}</TableHead>
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
                  <TableCell className={`text-right tabular-nums ${r.amount_usd < 0 ? "text-destructive" : ""}`}>{usd(r.amount_usd)}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{usd(r.running_usd)}</TableCell>
                </TableRow>
              ))}
              {!loading && rows.length === 0 && (
                <TableRow><TableCell colSpan={4} className="text-muted-foreground">{t("gl.regEmpty")}</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </DialogContent>
    </Dialog>
  );
}

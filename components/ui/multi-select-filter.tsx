"use client";

import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuSeparator,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";

interface MultiSelectFilterProps {
  /** Option values, in the order they should appear. */
  options: readonly string[];
  /** Optional value -> display label map (falls back to the raw value). */
  labels?: Record<string, string>;
  /** Currently-selected values. */
  selected: Set<string>;
  /** Toggle a single value on/off. */
  onToggle: (value: string) => void;
  /** Clear the whole selection. */
  onClear: () => void;
  /** Trigger summary when nothing is selected, e.g. "All sources". Should name
   *  the axis so the control is self-describing without a separate label. */
  allLabel: string;
  /** Label for the clear row inside the menu. */
  clearLabel: string;
}

/**
 * A compact multi-select dropdown: one trigger button that summarizes the
 * current selection and opens a checkbox menu. Replaces a splayed row of filter
 * pills so a long option list stays on a single line and does not push the
 * layout around as options grow.
 *
 * The menu stays open while toggling (base-ui CheckboxItem defaults
 * closeOnClick to false), so several options can be picked in one open.
 */
export function MultiSelectFilter({
  options,
  labels,
  selected,
  onToggle,
  onClear,
  allLabel,
  clearLabel,
}: MultiSelectFilterProps) {
  const labelOf = (v: string) => labels?.[v] ?? v;
  // Name the picks when there are few; collapse to a count once the trigger
  // would otherwise get long.
  const summary =
    selected.size === 0
      ? allLabel
      : selected.size <= 2
        ? options.filter((o) => selected.has(o)).map(labelOf).join(", ")
        : `${selected.size} selected`;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" size="sm" className="shrink-0" />}>
        <span>{summary}</span>
        <ChevronDown className="size-3.5 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="max-h-72 overflow-auto">
        {options.map((o) => (
          <DropdownMenuCheckboxItem key={o} checked={selected.has(o)} onCheckedChange={() => onToggle(o)}>
            {labelOf(o)}
          </DropdownMenuCheckboxItem>
        ))}
        {selected.size > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onClear}>{clearLabel}</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

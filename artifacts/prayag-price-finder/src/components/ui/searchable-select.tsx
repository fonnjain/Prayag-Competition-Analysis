import { useMemo, useState } from "react";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

export type SearchableSelectOption = {
  value: string;
  label: string;
  count?: number;
  disabled?: boolean;
};

export type SearchableSelectProps = {
  options: SearchableSelectOption[];
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  allowClear?: boolean;
  disabled?: boolean;
  widthClass?: string;
  triggerClassName?: string;
  "aria-label"?: string;
  "data-testid"?: string;
  /** Max options rendered at once; the list only mounts while open. */
  renderLimit?: number;
};

/**
 * Searchable single-select combobox (Popover + cmdk).
 * Values are matched verbatim — no trimming or case folding of option values.
 * Filtering is done here (shouldFilter=false) so huge lists stay cheap: only the
 * first `renderLimit` matches are mounted, and nothing mounts while closed.
 */
export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  emptyText = "No matches",
  allowClear = false,
  disabled = false,
  widthClass = "w-[280px]",
  triggerClassName,
  renderLimit = 200,
  ...rest
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = value == null ? undefined : options.find((o) => o.value === value);
  const label = rest["aria-label"] ?? placeholder;
  const testId = rest["data-testid"] ?? "select-searchable";

  const matches = useMemo(() => {
    if (!open) return [];
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q),
    );
  }, [open, options, query]);
  const shown = matches.length > renderLimit ? matches.slice(0, renderLimit) : matches;

  const choose = (next: string | null) => {
    onChange(next);
    setOpen(false);
    setQuery("");
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <div className={cn("relative", widthClass, "max-w-full")}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-label={selected ? `${label}: ${selected.label}` : label}
            disabled={disabled}
            data-testid={testId}
            className={cn(
              "w-full justify-between gap-2 font-normal",
              allowClear && selected && "pr-14",
              triggerClassName,
            )}
          >
            <span className={cn("truncate text-left", !selected && "text-muted-foreground")}>
              {selected ? selected.label : placeholder}
            </span>
            <span className="flex shrink-0 items-center gap-1.5">
              {selected?.count != null && (
                <span className="text-xs tabular-nums text-muted-foreground">{selected.count}</span>
              )}
              <ChevronsUpDown className="h-3.5 w-3.5 opacity-50" />
            </span>
          </Button>
        </PopoverTrigger>
        {allowClear && selected && !disabled && (
          <button
            type="button"
            onClick={() => onChange(null)}
            aria-label={`Clear ${label}`}
            data-testid={`${testId}-clear`}
            className="absolute right-8 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <PopoverContent
        align="start"
        className="p-0 w-[--radix-popover-trigger-width] min-w-[220px] max-w-[calc(100vw-1rem)] overflow-hidden"
      >
        <Command shouldFilter={false} loop>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            data-testid={`${testId}-search`}
          />
          <CommandList className="max-h-[min(300px,calc(var(--radix-popover-content-available-height)-3rem))]">
            <CommandEmpty>{emptyText}</CommandEmpty>
            {shown.length > 0 && (
              <CommandGroup>
                {shown.map((o, i) => (
                  <CommandItem
                    key={`${i}:${o.value}`}
                    value={`${i}:${o.value}`}
                    disabled={o.disabled}
                    onSelect={() => choose(o.value)}
                    data-testid={`${testId}-option-${o.value}`}
                    data-value={o.value}
                    data-count={o.count}
                    className="gap-2"
                  >
                    <Check
                      className={cn("h-3.5 w-3.5 shrink-0", o.value === value ? "opacity-100" : "opacity-0")}
                    />
                    <span className="flex-1 truncate">{o.label}</span>
                    {o.count != null && (
                      <span className="ml-auto text-xs tabular-nums text-muted-foreground">{o.count}</span>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {matches.length > shown.length && (
              <div className="px-3 py-2 text-xs text-muted-foreground">
                Showing {shown.length} of {matches.length}. Type to narrow.
              </div>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

"use client";

// Shared header/search/filter pieces for every list screen (Invoices, Quotes,
// Customers, Vendors, …) so they look and behave the same way instead of each
// having reinvented its own version.

/** The page-header row every list screen starts with: a title, then whatever
 * mix of search / filters / actions that screen needs, laid out the same way. */
export function ListHeader({
  title,
  children,
}: {
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <h1 className="text-xl font-semibold">{title}</h1>
      {children}
    </div>
  );
}

/**
 * The search box used across every list screen.
 * - "live" (default): filters as you type — for a client-side or cheap,
 *   debounced-by-the-caller search (Customers, Vendors).
 * - "submit": adds Search / Clear buttons and only searches when submitted —
 *   for a search that fans out across snapshot fields server-side and
 *   shouldn't refire on every keystroke (Invoices, Quotes).
 */
export function SearchBox({
  value,
  onChange,
  onSubmit,
  placeholder,
  mode = "live",
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit?: (v: string) => void;
  placeholder?: string;
  mode?: "live" | "submit";
}) {
  if (mode === "live") {
    return (
      <input
        className="input max-w-xs"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit?.(value);
      }}
      className="flex items-center gap-2"
    >
      <input
        className="input w-80 max-w-full"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <button type="submit" className="btn-primary">
        Search
      </button>
      {value && (
        <button
          type="button"
          className="btn-secondary"
          onClick={() => {
            onChange("");
            onSubmit?.("");
          }}
        >
          Clear
        </button>
      )}
    </form>
  );
}

/** A row of toggle-style filter chips, shared styling across every list. */
export function FilterChips<T extends string>({
  options,
  value,
  onChange,
  className = "",
}: {
  options: { key: T; label: string }[];
  value: T;
  onChange: (key: T) => void;
  className?: string;
}) {
  return (
    <div className={`flex flex-wrap items-center gap-1 ${className}`}>
      {options.map((o) => (
        <button
          key={o.key}
          onClick={() => onChange(o.key)}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            value === o.key
              ? "bg-zinc-100 text-zinc-900"
              : "text-zinc-500 hover:bg-zinc-50 hover:text-zinc-800"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A single on/off filter button (e.g. "Overdue", "Owes money") in the same
 * style as FilterChips, for a toggle that isn't part of a mutually-exclusive
 * set. `tone` colors the "on" state — default (zinc) for a neutral toggle,
 * "warn" for one flagging something that needs attention. */
export function FilterToggle({
  active,
  onClick,
  tone = "default",
  children,
  title,
}: {
  active: boolean;
  onClick: () => void;
  tone?: "default" | "warn";
  children: React.ReactNode;
  title?: string;
}) {
  const onClass = tone === "warn" ? "bg-red-100 text-red-700" : "bg-zinc-100 text-zinc-900";
  return (
    <button
      onClick={onClick}
      title={title}
      className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
        active ? onClass : "text-zinc-500 hover:bg-zinc-50 hover:text-zinc-800"
      }`}
    >
      {children}
    </button>
  );
}

// One shared loading/empty row for every list table, instead of each screen
// writing its own <tr><td colSpan>…</td></tr> with slightly different
// wording and padding.
export function LoadingRow({ colSpan }: { colSpan: number }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-8 text-center text-zinc-400">
        Loading…
      </td>
    </tr>
  );
}

export function EmptyRow({
  colSpan,
  children,
}: {
  colSpan: number;
  children: React.ReactNode;
}) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-8 text-center text-zinc-400">
        {children}
      </td>
    </tr>
  );
}

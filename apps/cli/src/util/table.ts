/**
 * Minimal table formatter for CLI output.
 * Prints a simple ASCII table with column headers and rows.
 */

export function formatTable(columns: string[], rows: Record<string, unknown>[]): string {
  if (columns.length === 0) return '(no columns)';
  if (rows.length === 0) return '(0 rows)';

  // Calculate column widths
  const widths = columns.map((col) => col.length);
  for (const row of rows) {
    for (let i = 0; i < columns.length; i++) {
      const val = formatValue(row[columns[i]]);
      widths[i] = Math.min(Math.max(widths[i], val.length), 60); // cap at 60 chars
    }
  }

  const lines: string[] = [];

  // Header
  const header = columns.map((col, i) => col.padEnd(widths[i])).join(' | ');
  lines.push(header);

  // Separator
  const sep = widths.map((w) => '-'.repeat(w)).join('-+-');
  lines.push(sep);

  // Rows
  for (const row of rows) {
    const line = columns
      .map((col, i) => {
        const val = formatValue(row[col]);
        return val.length > widths[i] ? val.slice(0, widths[i] - 1) + '…' : val.padEnd(widths[i]);
      })
      .join(' | ');
    lines.push(line);
  }

  return lines.join('\n');
}

function formatValue(val: unknown): string {
  if (val === null || val === undefined) return 'NULL';
  if (val instanceof Date) return val.toISOString();
  if (typeof val === 'object') return JSON.stringify(val);
  return String(val);
}

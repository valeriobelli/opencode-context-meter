# Inline context contributors

Approved layout: inline, up to six contributors per category, largest first, followed by an omitted-item count. Keep the current category totals and footer. The report describes the latest measured prompt, not growth since the previous turn.

- Skills: distinguish advertised catalog entries from loaded bodies still visible in the active prompt.
- MCP & tool definitions: show direct definitions by name and visible Code Mode entries grouped by identifiable MCP server. Do not count the full connected inventory. Keep shared or unrecognized text grouped.
- Tool outputs & files: rank retained tool results by identifiable tool name, separate from definitions. Keep opaque results or files grouped.
- System & instructions: show identifiable instruction sources by name.

Show estimated token sizes using the existing category scaling, without double-counting. Extend the location-scoped aggregate snapshot with names, types, and sizes only. Do not retain raw instructions, arguments, or results in the snapshot. Keep the existing stale-snapshot and compaction safeguards; omit unavailable detail rather than guessing. No model calls or compaction actions.

## Verification

- [ ] Verify ranking, six-item cap, omitted count, and accounting against category totals.
- [ ] Verify advertised skills versus loaded bodies, direct definitions versus retained outputs, and visible catalog entries versus full inventory.
- [ ] Verify an unrecognized catalog format stays grouped and an unavailable or stale snapshot does not show old server details.
- [ ] Check the inline layout in a disposable TUI session.

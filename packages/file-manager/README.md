# @nanime/file-manager

A host-controlled React file manager. You pass in a flat list of items and an
async operation handler. The component handles navigation, selection, sorting,
filtering, validation and dialogs, then asks you to perform each write. It
never mutates your data and has no idea what a server, database or torrent is.

- ESM build, `.d.ts` types, standalone CSS. Peer deps: `react`, `react-dom` (18.2+ or 19).
- No runtime dependencies, no Tailwind, no global styles. Every selector lives under `.nfm`.
- Three layouts: `ledger` (default: tree rail + table), `cascade` (parent columns + table), `outline` (tree-table + inspector).

## Install

Inside this repo it is consumed as a Bun workspace. From the repository root:

```sh
bun ci
bun run build:packages
bun run --cwd packages/file-manager check
bun run --cwd packages/file-manager smoke:consumer
```

To use it elsewhere, `bun pm pack` from the package folder and install the tarball,
or copy the source package out. Nothing in `src/` imports from outside the package.

## Use

```tsx
import { FileManager, sizeColumn, type FileItem, type FileOperation } from "@nanime/file-manager";
import "@nanime/file-manager/styles.css";

const [items, setItems] = useState<FileItem<Meta>[]>(initial);

async function onOperation(op: FileOperation) {
  const next = await api.apply(op);  // throw to reject; the dialog stays open with error.message
  setItems(next);                    // replace items once, after the write landed
  return op.type === "delete" ? { undo: () => api.restore(op.ids).then(setItems) } : undefined;
}

<FileManager
  items={items}
  onOperation={onOperation}
  columns={[sizeColumn(), { id: "codec", header: "Codec", filterable: true, value: (i) => i.metadata?.codec }]}
  getLock={(item) => (busyIds.has(item.id) ? { reason: "Still downloading.", tone: "busy" } : null)}
  onSelectionChange={(ids) => setSelected(ids)}
  labels={{ root: "Library" }}
/>;
```

### Items

```ts
interface FileItem<M> {
  id: string;              // stable across rename and move
  parentId: string | null; // null = root
  name: string;
  kind: "file" | "folder";
  size?: number;           // bytes
  modifiedAt?: number;     // epoch ms
  metadata?: M;            // anything; read it through columns
}
```

### Operations

`onOperation` receives one of:

| type | payload |
| --- | --- |
| `create-folder` | `parentId`, `name` |
| `rename` | `id`, `name` (file extension already preserved) |
| `move` | `ids` (top-level only, never partial), `targetId` (`null` = root) |
| `delete` | `ids` (top-level; descendants are implied) |

Before calling you, the component validates with the same exported helpers
(`validateName`, `validateRename`, `validateCreateFolder`, `planMove`,
`findLock`). Validate again on your side; the demo adapter does. Return
`{ undo }` to show an Undo action, `{ message }` to override the toast text.
While a call is pending, actions are disabled, so a double click sends one
request.

### Locks

`getLock(item)` returns `{ reason, blocks?, tone? }` or `null`. `blocks`
defaults to `rename`, `move` and `delete`. A lock on any descendant also blocks
moving, renaming or deleting the folder above it. The reason is shown next to
the disabled actions. Locks are host policy: the component doesn't know why
something is busy.

### Columns

`{ id, header, value, format?, render?, width?, align?, sortable?, filterable?, minViewport? }`.
`value` drives sorting and filtering; `render` only affects the cell. A
filterable column gets a searchable value list with Any, Not blank and Blank
modes. Column filters apply to files and switch the view to a recursive result
list under the current folder. `sizeColumn()` and `modifiedColumn()` are built in.

### Other props

`layout`, `folderId` + `onFolderChange` (controlled) or `defaultFolderId`,
`defaultExpandedIds`, `onOpenFile`, `labels`, `caseSensitiveNames` (default
false, so `Season 01` and `season 01` collide), `renderIcon`, `className`,
`style`, `theme`.

### Theme

Set CSS variables on `.nfm` or pass `theme`:

| prop | variable | default |
| --- | --- | --- |
| background | `--fm-bg` | `#000000` |
| surface | `--fm-surface` | `#0a0a0a` |
| muted | `--fm-muted` | `#171717` |
| border | `--fm-border` | `#262626` |
| ink | `--fm-ink` | `#fafafa` |
| inkMuted | `--fm-ink-muted` | `#a1a1aa` |
| accent | `--fm-accent` | `#ec4899` |
| accentInk | `--fm-accent-ink` | `#000000` |
| danger | `--fm-danger` | `#ef4444` |
| radius | `--fm-radius` | `10px` |
| font | `--fm-font` | system UI stack |

The component fills its parent's height, so give it a sized container. Below a
container width of 720px it switches to the touch layout: 44px targets, a folder
drawer, a sort and filter sheet, and a bottom action bar. On touch, tapping a
row opens folders and toggles files.

### Keyboard

Click to select, Ctrl/Cmd-click to toggle, Shift-click for a range, double-click
or Enter to open. Arrow keys move focus, Space toggles, Ctrl/Cmd+A selects
everything in view, Esc clears the selection. F2 renames the focused row (the
row checkbox counts) but is ignored in text fields. Delete opens the delete
confirmation.

## Demo

`bun run build:demo` writes an offline bundle to `demo/dist/` (React included).
Serve the folder with any static server. URL params: `layout=ledger|cascade|outline|compare`,
`latency=0`, `folder=<id>`, `broken=move` (adapter acknowledges moves without
writing; used by the mutation test). The prototype strip at the top switches
layouts, toggles latency, makes the next operation fail, and resets the
fictitious data.

## Adopting as a Bun workspace later

1. Add `"workspaces": ["packages/*"]` to the root `package.json`.
2. Add `"@nanime/file-manager": "workspace:*"` to the app's dependencies and run `bun install`.
3. Import from `@nanime/file-manager` and `@nanime/file-manager/styles.css`. Vite reads `dist/` through `exports`, so run `bun run --cwd packages/file-manager build` first, or add a `source` export condition if you'd rather compile from `src/`.
4. Keep the package free of `@/` aliases and app imports so it can still be extracted.

The Nanime adapter belongs in the app: map media entries to `FileItem`s (stable
ids, not paths), turn active downloads into `getLock` results, and send
`FileOperation`s to the server.

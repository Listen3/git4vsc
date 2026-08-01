# Custom Webview Dialogs

## 1. Decision

Git4VSC will add a small custom dialog system inside its existing Commit and Git Log Webviews. It will not attempt to inject UI into the VS Code workbench or imitate a window-wide modal outside a Webview.

Use custom dialogs only for workflows that:

- start inside a visible Git4VSC Webview;
- need richer layout than a native Quick Pick;
- benefit from keeping repository and commit context visible behind the dialog.

Keep native VS Code UI for:

- the status-bar branch menu and commands that can run while no Git4VSC Webview is visible;
- destructive confirmations such as hard reset, abort, delete and whole-commit revert;
- file and folder system pickers;
- notifications, errors and operation progress.

This follows the public extension UI boundary: Quick Picks are native selection UI, while fully custom UI belongs in an editor Webview or Webview View. A Webview dialog can cover only its own Webview rectangle.

References:

- [VS Code Quick Pick UX](https://code.visualstudio.com/api/ux-guidelines/quick-picks)
- [VS Code Webview UX](https://code.visualstudio.com/api/ux-guidelines/webviews)
- [VS Code Webview API](https://code.visualstudio.com/api/extension-guides/webview)

## 2. Current Popup Inventory

The extension currently has 11 Quick Pick calls, 10 Input Box calls and 37 message calls. They are not all migration candidates.

### Keep native

| Workflow | Reason |
| --- | --- |
| `BranchMenu.show()` and branch action menu | Global entry point from status bar, SCM and Command Palette |
| Destructive confirmations | Native modal semantics and consistent warning treatment |
| Repository path and worktree folder selection | Requires the system file picker |
| Information, warning and error notifications | Native workbench communication |
| Commands invoked without a visible Git4VSC view | No valid custom dialog host |

### Migrate from Git Log first

| Workflow | Target custom dialog |
| --- | --- |
| Commit compared with local: select changed file | Searchable file list |
| Branch/ref compared with local: select changed file | Searchable file list |
| Compare two refs: select commit | Searchable commit list with group separators |
| Reset mode | Compact choice dialog |
| Set tracked branch | Searchable branch list |
| Select remote | Compact searchable list |
| New worktree mode | Compact choice dialog; keep native folder picker afterward |

Text inputs for branch, tag and remote names are a later migration. Native Input Box is already appropriate unless validation or surrounding context becomes materially better in the Webview.

## 3. Architecture

### 3.1 Message protocol

Define serializable dialog types in `@git4vsc/shared-types`:

```ts
type DialogRequest =
  | { id: number; kind: 'list'; title: string; placeholder?: string; items: DialogListItem[] }
  | { id: number; kind: 'choice'; title: string; items: DialogChoice[] }
  | { id: number; kind: 'input'; title: string; value?: string; placeholder?: string; validation?: string };

interface DialogResult {
  id: number;
  value: string | string[] | null;
}
```

Items carry stable IDs and presentation data only. Git objects, callbacks and executable commands remain in the extension host.

Message flow:

1. A Webview action reaches `LogSession`.
2. The extension host loads any required Git data.
3. `WebviewDialogController` posts `dialog:open` and returns a promise.
4. `DialogHost` renders the request in the Webview.
5. The Webview posts `dialog:resolve` with an item ID or `null` on cancel.
6. The extension host validates the ID and performs the Git or editor action.

Only one dialog is active per Webview. Disposing the Webview cancels the pending request. No timeout or hidden native fallback is needed because the first migration phase is limited to actions originating in that visible Webview.

### 3.2 Code boundaries

```text
packages/shared-types/src/
  dialog.ts                 Serializable request/result contracts

packages/ui/src/dialogs/
  DialogHost.tsx            One active dialog and backdrop
  DialogFrame.tsx           Header, body, footer and focus boundary
  SearchableListDialog.tsx  File, commit, branch and remote lists
  ChoiceDialog.tsx          Reset/update/worktree choices
  InputDialog.tsx           Later text-input migration
  dialog-state.ts           Pure keyboard/selection reducer

apps/vscode-extension/src/
  webview-dialog-controller.ts  Promise bridge for postMessage
  log-panel.ts                  Loads data and consumes stable result IDs

apps/vscode-extension/webview/
  index.tsx                 Owns DialogHost and routes dialog messages
```

`DialogHost` is reusable by the Commit and Log roots, but the first integration is Log-only. This avoids changing both Webviews before the interaction model is proven.

## 4. Visual and Interaction Rules

- Backdrop uses a subtle theme-derived overlay; it must not obscure the repository context completely.
- List dialogs use `clamp(460px, 72vw, 760px)` width and at most `calc(100vh - 24px)` height.
- Choice and input dialogs use `clamp(360px, 58vw, 520px)` width.
- On a narrow or short Webview, the dialog becomes an inset sheet instead of overflowing.
- Dialog opening never changes the Commit Log grid, column widths or scroll position.
- Rows remain compact at 26-28 px and use VS Code selection, hover and focus colors.
- File rows show filename first and a muted path/status suffix.
- Commit rows show subject first and muted author/date/ref metadata.
- The primary action is enabled only when the current selection is valid.
- `Escape` cancels, `Enter` accepts, arrows move selection, typing focuses search, and double-click accepts a list item.
- Focus moves into the dialog, stays inside it while open, and returns to the invoking control after close.
- Use `role="dialog"`, `aria-modal="true"`, an accessible title and labelled search field.
- Respect high-contrast themes and `prefers-reduced-motion`; color is never the only state indicator.

## 5. Migration Plan

### Phase 1: foundation and one vertical slice

- Add shared dialog contracts, `DialogHost`, list reducer and extension-host controller.
- Migrate “Compare Commit with Local” file selection.
- Verify diff opening, cancel, focus restoration, theme switching and Webview disposal.

This phase establishes the protocol without introducing several dialog variants at once.

### Phase 2: remaining Git Log lists

- Migrate branch/ref-to-local file selection.
- Migrate compare-ref commit selection with labelled separators.
- Migrate tracked-branch and remote selection.
- Share one searchable virtual list implementation for large repositories.

### Phase 3: compact choices

- Add the choice dialog.
- Migrate Reset mode and new-worktree mode.
- Allow the update strategy dialog only when the update originated inside the visible Log Webview. Keep the status-bar and view-title command path native.

### Phase 4: optional text inputs

- Evaluate branch, tag and remote editing after the list dialogs are stable.
- Migrate only inputs that gain inline validation, explanatory context or a follow-up action.
- Keep simple global inputs native.

## 6. Acceptance Criteria

- Migrated Log workflows do not open the Command Center Quick Pick.
- Global commands still work when the Log Webview has never been opened.
- No custom UI escapes its Webview or depends on private VS Code DOM/API.
- A dialog cannot trigger a Git action with an unknown or stale result ID.
- Closing or disposing the Webview resolves pending dialog work as cancelled.
- Keyboard-only operation covers open, search, selection, confirmation and cancellation.
- Light, dark and high-contrast themes remain readable.
- Long lists remain responsive and do not reflow the underlying Commit Log.
- Unit tests cover reducer navigation/filtering and result validation.
- Extension Host tests cover dialog request/resolve/cancel and opening the selected diff.

## 7. First Implementation Slice

Start with the file list currently shown by `compareCommitWithLocal()` in `apps/vscode-extension/src/log-panel.ts`. It is the same workflow shown in the reported screenshot, has a clear single result, and does not modify repository state. It is therefore the lowest-risk place to validate the custom dialog foundation before migrating branch, reset or update operations.

# Cowart complete canvas acceptance

Owner: ChatGPT; Issue #23. Branch `chatgpt/23-canvas-feature-parity`, base `394bf0450e0613bead23f874f33d8f622aa0a7c3`.

The user requires the complete user-facing canvas behavior available in the original Cowart editor. The independent core delivered by #34 is a milestone, not completion. The following is an acceptance inventory, not a claim of passing tests. Implementations must be independent; no editor license checks or compiled bundles are modified.

| Area | Required behavior | Acceptance evidence required |
| --- | --- | --- |
| Original 30 toolbar entries | Annotation, select, hand, AI holder, media, draw, erase, text, arrow, note, 16 geometry variants, line, highlight, laser, frame | Each entry works by real pointer input; undo and refresh for persistent tools; laser never persists |
| Geometry and strokes | Rectangle/ellipse/triangle/diamond/hexagon/oval/rhombus/star/cloud/heart/check/cross/four arrows, pressure strokes, smooth and straight lines | Rendering, resize, rotate, export and reopen |
| Text and labels | Rich text, fonts, sizes, alignment, wrapping, lists, links, shape labels and note text | Styled text survives editing, export and refresh |
| Styles | Color, opacity, fill, stroke/dash, size, line spline, arrow routing/heads | New tool defaults and mixed selections; no destructive image-property changes |
| Connectors | Straight/curved/elbow, endpoint editing, labels, live target bindings | Moving/resizing/rotating targets, deleting/undoing, duplicate/page move/reload |
| Images | Original preview, multi import, crop, flips, link, download, ZIP, selected raster export | Nondestructive originals; AI input reflects visible crop/flip; saved sources remain authenticated |
| Arrange | Align six edges/centers, distribute, stack, stretch, four reorder operations, rotation, flip, group, frame, lock | Parent transforms, locked elements, one undo per operation |
| Clipboard | Cut/copy/paste/duplicate, text/image paste, internal selected subtree/assets | Cross-page and refresh; bindings remapped without leaking foreign references |
| Pages | Add/select/rename/duplicate/delete/reorder/move selection | Last page protected; children and connectors preserved; undo/reload |
| Import/export | Snapshot/selection JSON, SVG/PNG, transparent background, original image ZIP | Content matches live drawing; safe SVG handling and file limits |
| View/input | Zoom fit/selection/100%, keyboard shortcuts, pan/pinch, grid/snap, tool lock, focus, edge scroll | Desktop actual pointer/keyboard and small-screen accessibility |
| Menus/preferences | Working edit/arrange/style/page/view/export controls and shortcuts help | No placeholder buttons; settings survive reload |
| Legacy records | All original visible types, rich text, drawn paths, line handles, arrow bindings, frame hierarchy | Representative old documents render and edit without silent loss; unknown types explicitly retained |
| Studio compatibility | Seven integrated save/upload/recovery/original/large-upload/cancel fixes | Existing complete suite plus new feature tests on exact SHA and isolated HTTPS QA |

The original app did not enable collaborative multiplayer or cursor chat. SDK developer APIs and disabled AI video/slides/HTML generation are not implied by the canvas inventory. Real paid-provider verification still requires explicit user authorization. Main and production remain untouched, and #22 stays Draft.

Status: full parity in development. No complete acceptance or deployment is claimed by this document.

The expanded engine writes native schema version 2. Version 1 documents remain readable; a version 1 engine rejects version 2 snapshots rather than silently dropping new native transforms and types. Rolling back QA therefore requires the pre-upgrade data backup together with the previous image. Future native schema versions remain fail-closed.

## Expanded tool milestone and remaining gaps

The expanded milestone provides real implementations for all 30 toolbar entries (the media picker currently follows Studio's persistent PNG/JPEG/WebP formats), common styles, arrange/page/clipboard actions, crop/flip, rich text and SVG/PNG/JSON export. This is not yet a complete SDK-equivalence claim.

Remaining full-parity work includes SVG/vector and video media import/persistence, provider-specific embed URL handling/previews, object snapping and remaining original menu/preferences details, and the full legacy-document fixture/hardware/cross-device matrix. Unknown legacy types remain explicitly marked and retained. Sandbox embeds may be blocked by a target site's own frame policy. These gaps must stay visible until implemented and verified; a passing toolbar smoke alone cannot close the overall task.

The newer regression checks include real grouped style/opacity, clipboard and page operations, draggable crop/flip with sampled output pixels and unchanged source, connector bindings/edge positions/drag/undo, rich-text live saving and undo, plus SVG XML and PNG signatures. The existing Studio generation/edit/reference, recovery, upload/save-race and cancellation scripts remain required on the final exact SHA.


## Portable archive increment

Branch `chatgpt/23-canvas-portable-backup`, based on expanded integration `983c542`. The previous expanded milestone passed exact push CI run 40104063507 and isolated HTTPS tool, save/recovery/upload and queued-cancel checks; see Issue #23 for deployed evidence.

The new complete ZIP contains the document and unchanged original PNG/JPEG/WebP bytes, with a versioned manifest, CRC32 and SHA-256 checks. It reads only the authenticated account's immutable media. Export waits for the captured document save; failed saves do not download a stale archive. Desktop File System Access downloads stream directly to a chosen file, and failed downloads abort that write. Other browsers use a bounded 100 MiB fallback with an explicit message for larger archives.

Import validates all paths, file lists, sizes, checksums, schema and parent cycles before uploading. It uploads through the existing quota-checked account endpoint, then adds new pages in one undoable operation. Existing pages remain. IDs, assets, bindings and annotation references are remapped. Old history IDs become provenance only, preventing accidental reuse of another project's active source identity. Cancel/failure never applies a partial document; already uploaded content remains deduplicated for retry. No provider requests are made.

The archive uses uncompressed STORE ZIP to preserve original bytes and permit bounded memory. Current limits are 4,096 unique images, 12 MiB per image, 12 MiB document manifest, and 1 GiB plus archive overhead overall. Missing originals fail explicitly rather than producing an incomplete “backup.” Structure JSON remains available for emergency recovery and old snapshot interoperability; it is not a portable image archive. Importing a complete archive requires storage capacity for its images. This increment does not add SVG/video media support.

`tests/cowart-archive.test.js` covers standard Python ZIP interoperability, cross-account authenticated restore, exact source bytes, missing/foreign assets, corrupt files, future versions, hierarchy cycles, cancellation, concurrency and read-only export. `tests/canvas-archive-transfer.test.js` checks streaming/failure commit behavior and fallback bounds. `cowart/tests/archive-smoke.mjs` exercises actual download/import, fresh edits, source pixels, remapped annotation references, undo/redo, reload, damaged-file rejection before upload, save failure, small screens and zero paid requests. The four existing browser scripts remain required alongside it.

This branch is an implementation checkpoint until exact CI and isolated HTTPS deployment verification are recorded in #23. It does not close the overall full-parity task.

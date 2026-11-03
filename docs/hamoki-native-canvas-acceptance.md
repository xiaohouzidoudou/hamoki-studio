# Hamoki Canvas — independent image workspace

This implementation uses React, SVG and browser Canvas 2D. The document engine,
renderer and pointer handling are project code. It does not patch or bundle the
previous editor SDK or its license enforcement. React and fractional-indexing
remain dependencies with their own upstream licenses.

## Supported interactions

- PNG/JPEG/WebP file picker, multi-file drop and paste; original asset bytes are
  uploaded using the existing account/project media endpoint.
- Click selects; Shift-click adds/removes selections; blank drag marquee.
- Drag to move; Space-drag, middle drag and hand tool pan; wheel zooms at cursor.
  Touch supports drag and two-pointer pan/zoom. Input focus isolates shortcuts.
- Selection handles resize (images/groups preserve aspect), rotation handle,
  lock/unlock, duplicate, bring forward, group/ungroup, undo/redo and arrow keys.
- Image original preview by double click; outside click/Escape close; preview
  traps focus. Context actions edit, use as references, download and delete.
- AI holders, rectangles, ellipses, text and labeled arrows; page switching.
- Original single-file download and standard UTF-8 ZIP for selected images;
  selection raster export for AI references, with same-origin/bitmap sources.
- Existing Studio provider/role selection, one-job submission, recovery slot,
  unsaved result gate, cancellation and explicit next-round confirmation reused.

## Storage and old documents

The record envelope is retained as a data interchange format. Native snapshots
add `schema.hamokiCanvas: 1`. Existing page/asset/shape IDs and original metadata
are preserved. Unknown legacy shape types show a placeholder and warning; the
full raw record survives edits and saves. Old bindings/other records stay opaque.
Invalid record identities or a newer native format stop editing/saving instead
of creating a replacement empty document. A backup is available after the raw
snapshot has actually been read.

The native editor does not implement every former whiteboard shape/tool. Unknown
custom shapes remain preserved but cannot be edited faithfully. Native UI does
not currently expose crop handles; existing image crop/flip values are rendered
and raster exported. Existing clips/bindings and rich text styling beyond plain
text are not a claim of full visual parity. This is an image-workspace rewrite,
not a general editor SDK clone.

Versioned snapshot saving, stale revision 409, asset replacement checks and
quota protection remain the existing server/client pipeline. URL updates after
successful saves are remote changes, never a second user mutation. Failed saves
show an alert, explicit retry and complete backup export. Dirty unload warns.

## Regression matrix

- `tests/hamoki-canvas.test.js`: version isolation, gesture undo/redo, remote asset
  update isolation, grouping geometry, camera transforms, page isolation, opaque
  legacy round-trip, invalid/future format safety, source restriction and ZIP.
- `cowart/tests/native-canvas-smoke.mjs`: production bundle alive >10 seconds,
  old opaque record preservation, actual file import, move/resize/rotate,
  undo/redo, text/arrow, group/ungroup, actual ZIP download, explicit reference,
  save/reload and 390px viewport. No external network requests or model calls.
- Existing browser smoke: generation + two edits with mocked image APIs, exactly
  three submissions, response loss and close-tab recovery, offline query guard,
  Holder/role inputs and original protection. All existing core checks retained.
- Existing asset smoke: two 5MiB images, failed upload, >12MiB inline migration,
  delayed response + simultaneous editing, URL persistence and no reupload.
- Existing cancellation smoke: queued/running, declined confirmation, lost cancel
  response, original ID restoration after reload, terminal acknowledgement and
  zero extra image submission. Only a local simulated image upstream is used.

Local complete backend run: 186 tests passed. All four Chromium scripts passed
in the isolated development copy. Exact PR/integration CI and actual isolated
QA deployment/browser evidence must be read from Issue #23; source tests alone
do not constitute deployment. Production/main remain untouched. Real paid-model
E2E and production promotion still require their separate authorization/gates.

## Scope expanded after the core milestone

The user subsequently requested full original canvas behavior. This document records the #34 core milestone only. Follow `hamoki-canvas-feature-parity.md` and Issue #23 for the expanded implementation and acceptance; the earlier core test result does not establish full parity. The expanded engine uses native schema 2 so a schema-1 deployment cannot silently edit the new feature set.

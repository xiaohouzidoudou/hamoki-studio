# Vendored upstream rule engines

These are **unaltered upstream files**, not AI-generated replacements. The Hamoki Studio
backend loads them from `lib/creative-upstream.js` at process startup.

| Upstream | Pinned git commit | Copied material | License |
| --- | --- | --- | --- |
| [tnbao91/ai_asset](https://github.com/tnbao91/ai_asset) | `006a796da817d742b0308a9326c9254a8e875b7b` (toolkit v2.3.0) | `studio_primer.md`, all `schema/*.yaml`, all `style_tokens/*.yaml` | MIT; upstream LICENSE copied |
| [guiguiyan930-source/game-ui-design-workflow](https://github.com/guiguiyan930-source/game-ui-design-workflow) | `1ec604638dd1a27198576206eb3e47632725a078` | 4 original Skill directories: game-ui-workflow, game-ui-specification, game-ui-extension, game-ui-page-generator (plus their references) | MIT; upstream LICENSE copied |

Integration, not a competing homegrown pipeline:
- **STYLE:** official `§3 ANALYZER` from `studio_primer.md` + original
  `style_guide.schema.yaml`; YAML parsed and checked against its actual
  enum/type definitions; palette/color_map and review notes retained per project.
- **TARGET:** official `layout_spec.schema.yaml` and original
  `game-ui-page-generator/SKILL.md`; only page structure is taken from a prototype.
- **ASSET:** official `§4 SYNTHESIZER` + `asset_spec.schema.yaml` and
  `layout_spec.schema.yaml`, the original page generator Skill, and
  **runtime lookup of actual** `style_tokens/*.yaml` translated phrase entries.
- **CHECK:** official `§5 CHECKER` and original page generator Skill for image
  consistency + layout comparison, via the user's configured vision provider.
- **Actual generation:** existing GPT Image / Gemini job APIs in Hamoki Studio,
  manually authorized. Neither upstream repository includes a drop-in
  image-generation backend.

**Limits:** Upstream `ai_asset` is a prompt toolkit, not independently
executing code or a proven guarantee of outputs in this specific application.
Game UI workflows refer to GDD/PRD and art approvals; only their relevant
rules are integrated in the current Word-led workflow. No slicing or Unity
steps have been integrated, by design. Layer AI's tools were not vendored
because its grading service requires Layer-specific API access.

To upgrade, clone each exact upstream repo and compare revisions, license
terms and files before replacing these snapshots. Do not silently update
unstable `main` on production servers. Tests exercise the actual included
source and mocks; real model quality still requires user-authorized trials.

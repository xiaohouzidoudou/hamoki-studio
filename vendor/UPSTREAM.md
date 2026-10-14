# Vendored upstream rule engines

These are **unaltered upstream files**, not AI-generated replacements. The Hamoki Studio
backend loads them from `lib/creative-upstream.js` at process startup.

| Upstream | Pinned git commit | Copied material | License |
| --- | --- | --- | --- |
| [tnbao91/ai_asset](https://github.com/tnbao91/ai_asset) | `006a796da817d742b0308a9326c9254a8e875b7b` (toolkit v2.3.0) | `studio_primer.md`, all `schema/*.yaml`, all `style_tokens/*.yaml` | MIT; upstream LICENSE copied |
| [gamedev-skills/awesome-gamedev-agent-skills](https://github.com/gamedev-skills/awesome-gamedev-agent-skills) | 0a70cfc64672d512c5b5b6006b5dcb5cf90dbdbd | Original game-ui-ux/SKILL.md and references/layout-and-flow.md | Apache-2.0; original LICENSE |
| [majidmanzarpour/threejs-game-skills](https://github.com/majidmanzarpour/threejs-game-skills) | 8286774b22a2566bf894dbc825825c16921866af | Original threejs-game-ui-designer/SKILL.md and references/ui-patterns.md | MIT; original LICENSE |
| [guiguiyan930-source/game-ui-design-workflow](https://github.com/guiguiyan930-source/game-ui-design-workflow) | `1ec604638dd1a27198576206eb3e47632725a078` | 8 original Skill directories (including game-ui-product-design, game-ui-component-breakdown, game-ui-sprite-sheet-splitter, game-ui-asset-pipeline), original Python sprite/atlas/engine scripts, contracts and planning templates | MIT; upstream LICENSE copied |

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
rules are integrated in the current Word-led workflow. Sprite splitting, manual semantic/9-slice review, atlas and Unity/Cocos/Godot JSON handoff are now integrated behind private per-project API. Native Unity project import and automatic text removal are not integrated. Layer AI's tools were not vendored
because its grading service requires Layer-specific API access.

To upgrade, clone each exact upstream repo and compare revisions, license
terms and files before replacing these snapshots. Do not silently update
unstable `main` on production servers. Tests exercise the actual included
source and mocks; real model quality still requires user-authorized trials.

Extra integration for game UI:
- TARGET: game-ui-ux safe-area and text sizing plus threejs-game-ui-designer responsive constraints.
- ASSET: premium Three.js skill's visual hierarchy, authored menus and art cohesion plus game-ui-ux workflow rules, while locked Style DNA overrides generic examples.
- CHECK: original accessibility and recurring layout/overflow errors; visual checks only claim what images can prove.
- Vendored originals and licenses are unchanged. Only selected bounded passages enter AI prompts. These are design rules, not a Three.js renderer, Unity export pipeline, or runtime interaction implementation.

## Game UI Factory delivery integration
- Pin unchanged original component/product/splitter/asset-pipeline Skill source Markdown and original Python sprite/atlas/engine executables and YAML contracts.
- Original tools execute on validated generated sprite-sheet images with Pillow and PyYAML in the existing isolated Node container. Cropping/atlas/export never spends AI tokens.
- Private account-scoped per-project asset deliveries contain detected sprites, approved semantic PNG, ZIP, atlas and Unity/Cocos/Godot/generic JSON.
- ZIP also includes editable original GDD, PRD, and interaction templates. Templates are not generated or marked as approved planning documents.
- No automatic text removal or pixel recovery; only separate sprite-sheet elements with clean/solid or transparent background. Metadata is JSON handoff, not a native game project.

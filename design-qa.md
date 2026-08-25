# Design QA — Split Lens redesign

## Target and implementation

- Selected visual target: Option 3, “Split Lens” (`1487 × 1058` source, proportionally normalized to `1440 × 1024` for comparison).
- Browser implementation: `/research?conversation=22222222-2222-4222-8222-222222222222` at `1440 × 1024`.
- Final public capture: `docs/assets/aperture-research.jpg`.
- Full comparison evidence: `test-results/design-qa/research-full-comparison.jpg` (ignored from Git).
- Focused comparison evidence: `test-results/design-qa/research-core-comparison.jpg` and `test-results/design-qa/research-composer-comparison.jpg` (ignored from Git).

## Comparison history

### Pass 1

- P1: the original generic rounded-card shell did not reproduce the selected warm answer plane / dark evidence-map split.
- P1: the follow-up composer lived entirely inside the answer plane instead of bridging answer and evidence.
- P2: research and search lacked the editorial serif/sans contrast and fine-rule technical hierarchy in the target.
- P2: graph nodes were too small for the available canvas.

Resolution: rebuilt the global visual system around the selected split lens, added the paper and technical-grid assets, switched the shell to a narrow Phosphor icon rail, moved the composer across the surface boundary, and increased graph legibility.

### Pass 2

- P1: a newly introduced provenance strip collided with the fixed composer at the target viewport.
- P2: adjacent graph nodes touched at the default fit.
- P2: the development preview had retained an older CSS bundle during the first comparison capture.

Resolution: removed the redundant provenance strip, widened the graph layout radius, restarted the clean preview, and regenerated every desktop and mobile capture.

### Final comparison

- The implementation preserves the target’s dominant composition: narrow dark rail, warm editorial answer plane, dark inspectable evidence map, and a composer spanning both surfaces.
- Typography, density, line work, color roles, and interaction hierarchy are consistent across overview, search, research, documents, graph, integrations, workflows, activity, and mobile.
- The implementation intentionally uses live source cards and React Flow data instead of decorative connector artwork, preserving functional evidence navigation and graph interaction.
- No P0, P1, or P2 visual issues remain in the reviewed states.

## Interaction and runtime checks

- Screenshot audit exercised all primary routes, workflow drafting, desktop and mobile layouts, page errors, and console errors.
- Playwright exercised navigation, command search, progressive search, research submit/stream, workflow draft/create/run/pause/delete, integration sync, activity health, document evidence, graph rendering, and responsive graph behavior.
- Reduced-motion handling is present; navigation, buttons, forms, tabs, filters, cards, and graph controls have functional states.
- Demo captures contain only deterministic fictional Project Helios data and no connected-workspace content.

## Result

final result: passed

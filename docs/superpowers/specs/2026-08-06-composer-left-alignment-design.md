# Composer Left Alignment Design

## Goal

Align the left edge of the Composer placeholder text, the add button icon, and the project folder icon on one vertical baseline in normal and knowledge conversations.

## Design

Define one Composer-local horizontal inset and apply it consistently to the input, toolbar, and project context controls. The icons themselves, rather than their button hit areas or adjacent labels, are the alignment anchors. Preserve existing control sizes, vertical spacing, menu positioning, and interaction behavior.

The change belongs in the shared `apps/web` Composer styles, so Browser Bridge and Desktop Bridge consume the same implementation without platform branching.

## Verification

- Add a CSS contract covering the shared inset.
- Run the Composer and CSS tests plus the Web typecheck.
- At the same desktop content viewport, measure the placeholder text, add icon, and folder icon left edges in the running page and confirm they match.
- Check both the normal Composer and the knowledge conversation Composer.

Actual packaged Desktop E2E and embedded Web asset hash verification remain release gates and are outside this narrow visual adjustment.

# Composer Dark Surface Design

## Goal

Give the dark-mode Composer a clearer visual hierarchy between the page, the main input surface, and the project context footer while keeping the current layout and interactions unchanged.

## Visual Direction

- Keep the page background at the existing `#0c0d0f` token.
- Give the Composer input area a dedicated `#1a1b1e` surface.
- Raise the project context footer to `#232427` so it is visibly distinct from the input area.
- Use a Composer-local outer border of approximately 12% white opacity.
- Add a subtle internal separator between the input area and project footer at approximately 6% white opacity.
- Preserve the current 8px radius, dimensions, spacing, controls, and menu behavior.

The contrast is intentionally lower than the supplied reference's footer so the Composer remains integrated with Clawee's restrained dark theme.

## Scope

Implement the colors in the shared `apps/web` Composer CSS. Browser Bridge and Desktop Bridge consume the same frontend implementation. Do not branch on host platform and do not change the light theme.

## Verification

- Add CSS visual-contract assertions for the input surface, project footer, outer border, and internal separator.
- Run the focused CSS and Composer tests plus Web typecheck.
- Inspect the running page at `http://127.0.0.1:9000/` in dark mode and verify the three surfaces are visibly distinct.
- Verify the knowledge conversation uses the same dark input surface without showing the project footer.

Packaged Desktop E2E and embedded Web asset hash verification remain release gates outside this visual adjustment.

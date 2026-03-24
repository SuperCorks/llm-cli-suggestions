# Shell UX Hardening

## Why This Matters

Even a good suggestion engine feels broken if the shell UX is flickery, late, or intrusive. The editing experience is part of the product.

## What To Improve

- reduce flicker during rapid typing
- ensure stale async results never flash visibly
- handle daemon-unavailable states more gracefully
- broaden widget coverage without breaking normal editing
- make terminal redraw behavior more predictable

## Good Next Step

- keep the current async architecture
- test more rapid typing paths
- add guardrails around redraw timing and stale request cleanup
- verify behavior in more real prompt setups

## Why This Is Separate From Ranking

Suggestion quality and shell feel are different problems. A mediocre suggestion that appears smoothly is still usable; a strong suggestion with janky rendering is not.

## Open Questions

- whether `Tab` should remain the default accept key long-term now that Right Arrow is supported too
- how much additional keymap support is worth the complexity
- which terminal and prompt combinations are most likely to expose edge cases

# Inspection And Observability

## Why This Matters

This app is partly a learning system. That means we need a good way to inspect what it is doing, what it is logging, and why a suggestion won or lost.

## Current State

The repo now has two inspection surfaces:

- a CLI inspection path through `autocomplete-client`
- a local Next.js control app in `apps/console`

The CLI currently exposes:

- `inspect summary`
- `inspect top-commands`
- `inspect recent-feedback`

The control app currently exposes:

- overview metrics
- suggestion and command history pages
- acceptance rate by repo
- top rejected suggestions
- daemon runtime status and recent logs
- ranking inspection with candidate breakdowns
- benchmark history and ad-hoc model testing

## What To Add

- richer session drill-down
- more powerful export and comparison views
- saved inspection presets
- query performance profiling for larger local datasets
- better log viewing and daemon diagnostics

## Good Next Step

- keep the CLI and the control app aligned around the same SQLite data model
- add tests around query filters, export routes, and benchmark history pages
- make it even easier to answer “why did this suggestion happen” from both surfaces

## Long-Term Possibility

If the local dataset grows meaningfully, this should evolve into a stronger analysis surface with:

- offline eval result browsing
- per-repo tuning views
- learning-data quality checks
- side-by-side ranking comparisons across model or prompt changes

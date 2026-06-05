# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.

## Port the mechanism, not the legacy type shape

- **Context**: Any pure core/engine that consumes domain data — whether ported from external/legacy code or written greenfield — where app-native types (e.g. generated `Database` types) already exist.
- **Problem**: Porting the legacy type shape verbatim creates a parallel domain that must be mapped to/from the real types; identity and display get conflated and bugs hide at the mapping boundary (e.g. output carried display names but persistence needed course IDs, with no bridge).
- **Rule**: When porting external logic, model the core on the app's own domain types (a projection of the generated types), not the legacy type shape. Port the mechanism — keep identity as opaque tokens, keep display concerns at the edges, and let the type system encode invariants (e.g. nullable over sentinels).
- **Applies to**: research, plan, plan-review

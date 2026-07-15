"""The ten lexicographic tier expressions, mirroring objective.ts semantics literally (Phase 3).

Week/lane asymmetries are the one encoding trap: tiers 2/3/5 are week-agnostic; 4/6/7/8/9 fan
``both`` into lanes; the duplicate-row key ignores week. Each tier is documented against its
objective.ts line refs.

Implemented in Phase 3.
"""

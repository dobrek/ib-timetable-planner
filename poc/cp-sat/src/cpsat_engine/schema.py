"""Parse the export dump JSON into typed, frozen dataclasses (Phase 2).

Mirrors the TS wire types (``GeneratorSnapshot``, ``GeneratedPlacement``) with OPAQUE ids only — no
names, levels, or flags (port the mechanism, not the legacy shape). Derives per-course deficits
(required - pins - parked, clamped at 0 per course) and rejects an unknown ``formatVersion``.

Implemented in Phase 2.
"""

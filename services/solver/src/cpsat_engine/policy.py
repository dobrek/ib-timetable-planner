"""Solve-policy presets (S-307, FR-302): one name on the wire, one configuration in the engine.

The wire carries ``SolveRequest.policy = {"preset": "<name>"}`` and nothing more — tier indices
never cross it. This module is the ONE place a preset name resolves to engine configuration, shared
by both transports (the HTTP runner and the file-transport CLI) so they cannot drift.

A preset is two things: whether the solve holds soft hits at the pinned floor (``clean_mode``, the
hard/soft split ``solve_complete`` already implements) and the order in which the ladder visits
tiers 2-10 (``ladder``, 0-based indices into ``objective.tiers``). Every ladder is a PERMUTATION of
the canonical ``(1, …, 9)`` — the visit order changes, ``build_objective``'s tuple never does — which
is what keeps the parity gate blind to policy and "stage N of 10" constant on every surface.

The POC frontier (``context/archive/2026-07-15-poc-cp-sat-backend-service/results.md``) defined
student-first as *holes → student → slots → teacher* with ``softHits`` hard; tiers the POC did not
name keep their canonical relative order.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, Final

# The canonical visit order for tiers 2-10, as 0-based indices into `objective.tiers`. Duplicated
# from `solve._LADDER_TIER_INDICES` on purpose: `solve` imports nothing from here (a config field
# is all it needs), and this module must not import `solve` — `test_policy.py` pins the two equal.
CANONICAL_LADDER: Final[tuple[int, ...]] = tuple(range(1, 10))

# holes → studentHoles → totalSlots → teacherHoles → softHits → doubles → lateStarts → fridayTail → golden
STUDENT_FIRST_LADDER: Final[tuple[int, ...]] = (1, 5, 2, 3, 4, 6, 7, 8, 9)


@dataclass(frozen=True)
class Policy:
    preset: str
    clean_mode: bool
    ladder: tuple[int, ...]


PRESETS: Final[Mapping[str, Policy]] = {
    "clean": Policy(preset="clean", clean_mode=True, ladder=CANONICAL_LADDER),
    "canonical": Policy(preset="canonical", clean_mode=False, ladder=CANONICAL_LADDER),
    "student-first": Policy(preset="student-first", clean_mode=True, ladder=STUDENT_FIRST_LADDER),
}

# The SERVICE default (FR-302): an absent `policy` on the wire means clean. The CLI's default is
# deliberately different (`canonical`, today's file-transport bytes) — see `cli.py`.
DEFAULT_PRESET: Final = "clean"


def resolve_policy(request: Mapping[str, Any]) -> Policy:
    """The policy a ``SolveRequest`` asks for, or the service default when the key is absent.

    An unknown preset raises rather than falling back: the schema validator at the HTTP boundary
    already 422s it, so reaching here with one means a caller bypassed the boundary, and solving
    under a silently-substituted policy would put a board on the row the author never asked for.
    """
    policy = request.get("policy")
    if policy is None:
        return PRESETS[DEFAULT_PRESET]
    preset = policy["preset"]
    if preset not in PRESETS:
        raise ValueError(f"unknown solve-policy preset {preset!r} (known: {sorted(PRESETS)})")
    return PRESETS[preset]

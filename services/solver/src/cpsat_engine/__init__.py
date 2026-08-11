"""Local CP-SAT solver POC for IB timetable generation, shaped as a future backend-service core.

Pipeline (research §7 reuse layout):

    schema    dump JSON -> typed, frozen dataclasses (opaque ids only)
    model     snapshot -> CpModel: variables + every hard rule (pure)
    objective tier 1-10 linear expressions, mirroring objective.ts
    solve     staged lexicographic runner + fixed-hint parity + Mode A/B
    explain   assumptions / conflict-set path for infeasibility
    cli       file in -> file out (the throwaway transport)

Only the file transport is throwaway; everything else is the service core.
"""

__version__ = "0.1.0"

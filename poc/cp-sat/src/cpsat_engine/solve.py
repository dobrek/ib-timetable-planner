"""Solver entry points (Phases 3-4).

    parity          fixed-hint solve vs the dump's TS tuple — the blocking encoding-equivalence gate
    solve_staged    staged lexicographic ladder over all ten tiers (harden ``tier_k <= best_k``)
    solve_complete  Mode A: completeness feasibility + infeasibility branch
    solve_repair    Mode B: 1-hop residual repair around the greedy unplaced courses

Implemented in Phases 3 (parity) and 4 (staged/complete/repair).
"""

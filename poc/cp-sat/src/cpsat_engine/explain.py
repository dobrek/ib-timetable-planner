"""Infeasibility explanation via the assumptions API (Phase 4).

On Mode A INFEASIBLE: re-solve with enforcement literals on named constraint groups as assumptions
(``num_workers = 1``), extract the conflicting subset, deletion-shrink to a true MUS. Alternative
framing: soften per-course-hour completeness and minimize relaxation literals (the maximum
completable subset).

Implemented in Phase 4.
"""

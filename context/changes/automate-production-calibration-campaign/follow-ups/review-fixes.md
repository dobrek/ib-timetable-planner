# Review fixes — follow-ups

Items from `reviews/impl-review-phases-3-6.md` (2026-10-02) that need a human step, or that were deferred.

- [ ] **F1: re-rehearse the graceful stop through `mise run`.** Against the local stack, in a real terminal: `mise run solver:campaign -- run`, then one Ctrl-C during a wait. Expected: "stopping after this step", the step finishes, the override is parked, and `status` shows no override. Record the outcome in `change.md`. The 2026-10-01 rehearsal row cannot have gone through mise, which delivers one Ctrl-C as two SIGINTs.

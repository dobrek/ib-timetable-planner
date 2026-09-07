---
change_id: production-calibration-campaign
title: Production calibration campaign
status: implementing
created: 2026-09-03
updated: 2026-09-07
archived_at: null
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

### 2026-09-04 — Cloudflare budget check: no plan change and no limit increase needed for the campaign.

Sources: developers.cloudflare.com/containers/pricing, /containers/platform-details/limits, /workers/platform/pricing, /billing/manage/budget-alerts (fetched 2026-09-04).

- **Plan.** Containers need Workers Paid ($5/month minimum), which the account already has. There is no spend cap or usage block on Workers Paid: overage is billed on the monthly invoice; nothing stops a run mid-way.
- **Included per month:** 375 vCPU-min, 25 GiB-h memory, 200 GB-h disk. **Overage:** $0.000020/vCPU-s, $0.0000025/GiB-s, $0.00000007/GB-s. CPU bills on active use only; memory and disk bill while the instance is provisioned (awake), and stop at sleep.
- **Campaign estimate (15 runs ≈ 3.8 h of solving on `standard-4` = 4 vCPU / 12 GiB / 20 GB; ≈ 8–11 h awake including sleep windows):** CPU ≈ 15 vCPU-h → ~$0.65 over the allowance; memory ≈ 100–135 GiB-h → ~$0.70–1.00; disk ≈ 170–225 GB-h → ~$0. **Total ≈ $1.5–2.5 on top of the $5 plan**; worst case with no allowance left ≈ $4.
- **Instance size.** `standard-4` is the largest predefined type; anything bigger is an account-team request. Not needed: the PRD parks off-Cloudflare unless calibration proves 4 vCPU binding, and the campaign is what decides that.
- **Account limits** (1,500 concurrent vCPU, 6 TiB memory, 50 GB image storage) are irrelevant at `max_instances: 1`.
- **GitHub Actions:** the repo is public, so the ~10 campaign merges cost no billed minutes.
- **Optional guard:** a Cloudflare *Budget alert* (Billing → Budget alerts, dollar-based) or a *Usage Based Billing* notification (Notifications → product = Workers) at e.g. $10/month is the only safety net available; it warns, it does not block.

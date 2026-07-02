# Clustering & prioritization evaluation — findings and fixes (2026-07)

This is the evaluation of `services/evaluator.py` that `platform-vision.md`'s
roadmap pointed to. It records, per concern, whether the code as shipped was
actually broken (with evidence), what the industry-standard approach is, and
what was changed (or deliberately not changed). Read this before touching the
clustering/scoring logic again.

Validation method: a real pgvector Postgres plus a deterministic stub
OpenAI-compatible endpoint (hashed bag-of-words embeddings, canned JSON chat
replies), driving `evaluate_project` end-to-end with constructed event sets
whose correct grouping/ranking is known, plus one Simulate-mode run through
`simulate_active_projects`. 19/19 scenario assertions pass post-fix.

## Reference points from established systems

- **Sentry issue grouping** is two-stage: deterministic fingerprinting on
  error structure first, then a transformer-embedding fallback that merges a
  new error into an existing issue only above a *very conservative*,
  human-validated similarity threshold
  (docs.sentry.io/concepts/data-management/event-grouping/,
  blog.sentry.io/how-sentry-decreased-issue-noise-with-ai/).
- **Sentry priority/trends sorting** weights recent events over old ones and
  applies exponential decay (weight halves every 12 h), combining relative
  and absolute volume (github.com/getsentry/sentry/issues/48477,
  docs.sentry.io/product/issues/issue-priority/).
- **PagerDuty Intelligent Alert Grouping** groups on alert-content similarity
  and co-occurrence within a bounded time window; incident severity is the
  max of its member alerts (support.pagerduty.com/main/docs/intelligent-alert-grouping).
- **Opsgenie deduplication** is identity-first (the `alias` field): one open
  alert per alias, duplicates bump a counter
  (support.atlassian.com/opsgenie/docs/what-is-alert-de-duplication/).
- **Online/leader clustering** (the streaming-clustering literature): keep a
  running **centroid** per cluster, assign each arriving item to the nearest
  centroid above a threshold, else start a new cluster. Known weaknesses —
  order dependence and threshold sensitivity — are exactly the ones this
  engine needs to manage.

## Concern 1 — does prioritization reflect criticality or volume?

**Partly a problem.** With default weights (0.5/0.3/0.2) and default caps
($10k revenue / 100 events), the headline scenario already ranked correctly:
a single $85k failure scored 0.563 vs 0.350 for 50 fresh rage-clicks —
because revenue saturates at the cap while frequency needs 100 events to.
The linear weighted sum itself was not the defect. Two real defects:

1. **No recency decay on frequency** (confirmed): `frequency_score =
   event_count / max_frequency_count` used the all-time count, so a cluster
   that was noisy three weeks ago held its score forever while a brand-new
   critical issue started near zero. *Fix:* frequency now sums
   `0.5 ** (age_hours / 168)` per event — exponential decay with a 7-day
   half-life (Sentry uses 12 h for raw errors; business/PM signals arrive on
   a slower cadence, so days not hours). Measured: 50 rage-clicks fresh →
   frequency 0.50; same events 21 days old → 0.06.
2. **Severity dilution in ux_score** (confirmed): the mean over all events
   meant every corroborating low-severity event *lowered* the score — a
   rage-click cluster (1.0) that gained five Stripe events (0.3 each)
   dropped to ~0.42. That inverts the intent: more corroboration should
   never reduce urgency. *Fix:* `ux_score = max(ux_signals)` — the
   PagerDuty/Sentry convention (incident severity = worst member alert);
   volume is the frequency axis's job, not the severity axis's.

**Not changed, deliberately:** the linear combination (weights are
user-configurable and the scoring webhook already exists as the escape hatch
for interaction effects); the revenue formula (dollars at risk genuinely
accumulate; the cap is a user knob).

## Concern 2 — is assign-vs-create defensible?

Three sub-issues, two confirmed, one acknowledged-but-not-fixable-here:

1. **Top-1-only retrieval** (confirmed): the LLM tiebreaker saw exactly one
   candidate, so two open clusters at e.g. 0.75/0.74 similarity could never
   be disambiguated — the second-best either lost silently or got a
   near-duplicate. Also, an LLM "assign" with an unexpected id fell through
   to *create*. *Fix:* retrieval now returns the top-3 nearest clusters
   (`_CANDIDATE_LIMIT`); all candidates in the ambiguous band go to the LLM
   with title, root_cause, event_count, and last_seen; any returned id in
   the candidate set is accepted. Validated with engineered embeddings:
   an event 0.75/0.74-similar to two clusters was correctly assigned to the
   second-nearest when the tiebreaker chose it — impossible before.
2. **Inconsistent embedding space** (confirmed, the most consequential
   finding): event embeddings come from structured plugin summaries
   (`"payment_intent.payment_failed | customer:… | amount:…"`), but
   `_regenerate_insight` overwrote the cluster embedding with an embedding
   of the LLM-written title+root_cause — a different text style. Every
   threshold then applied to a cross-style comparison whose similarity is
   systematically lower and drifts each time the title is reworded.
   Regression detection was worst hit: 0.92 similarity between an event-style
   embedding and a title-style embedding essentially never fires. *Fix:*
   cluster embeddings are now running centroids of member-event embeddings
   (textbook leader clustering), updated incrementally on each assignment;
   `_regenerate_insight` no longer overwrites them (title-based embedding
   remains only as a backfill when no event embedding existed). Validated:
   a resolved 3-event cluster is now correctly linked as parent of a
   recurrence (like-for-like similarity ≥ 0.92); regression_count increments.
3. **Uncalibrated thresholds** (acknowledged): 0.60/0.88/0.92 have no
   labeled-data validation — Sentry calibrated theirs against human judgment
   on real pairs. There is no labeled corpus here to recalibrate against, so
   the numbers stand, but the two structural fixes above make them apply to
   a homogeneous comparison (event-style vs event-style), which is the
   precondition for any future calibration to be meaningful. Revisit when
   real assign/create decisions can be sampled and labeled.

**Found during validation (pre-existing, now fixed):** a new cluster's
embedding was assigned *after* the `flush()` that inserted the row, and raw
`text()` queries don't reliably autoflush ORM attribute changes — so a
near-identical event later in the same batch queried
`WHERE embedding IS NOT NULL`, found nothing, and created a duplicate
cluster. Observed directly: 50 identical rage-clicks in one batch produced
two clusters (48+2). The embedding is now part of the INSERT and each loop
iteration flushes, so every event sees fully-current cluster state.
50 identical events now produce exactly one cluster.

## Concern 3 — insight stability

- **Arbitrary 15-event window** (confirmed): the per-cluster event query had
  no ORDER BY, so `negative[:15]` was join-order-arbitrary. *Fix:* events
  are fetched newest-first; the window is now explicitly recency-biased —
  it describes the cluster's current state, which is what the title and
  pm_insight should reflect.
- **Source mislabeling** (confirmed, worse than flapping): grouping inside
  `_regenerate_insight` special-cased stripe/sentry/else, so Zendesk and
  scout lines were presented to the LLM under a "FULLSTORY events:" heading.
  *Fix:* generic per-source grouping labeled by actual source name.
- **Flapping** (partly confirmed): title/root_cause/pm_insight regenerate on
  every pass that adds events. The destabilizing *side effect* — the cluster
  embedding changing with each reworded title — is gone with the centroid
  change. For the text itself, the regeneration prompt now instructs the
  model to return the current title/root_cause unchanged when they still
  describe the events. Full regeneration gating (e.g. only on 2× growth) was
  considered and skipped: the LLM cost is bounded (15-event window) and an
  explicit stability instruction addresses the flapping without new state.

## Concern 7 — scout signals

- **Ungrounded self-reported severity** (confirmed): scout `ux_signal`
  mapped the LLM's own "critical" to 0.95 — equal to a human-set Zendesk
  urgent and above a Sentry error (0.8), with no objective figure behind it
  (Stripe has dollar amounts, Zendesk a human-set enum, FullStory observed
  behavior). Under the new max-aggregation this would have let one
  uncorroborated scout verdict pin a cluster's entire ux axis. *Fix:* the
  scout severity scale is discounted (critical 0.75, high 0.60, medium 0.40,
  low 0.25) so a scout finding raises priority but never outranks
  evidence-backed signals; when corroborating events join the cluster, they
  carry the max instead.
- **affected_users** (confirmed, and wider than scout): the inline
  stripe/sentry/else extraction in `evaluate_project` returned "" for both
  scout *and Zendesk* events (`data.user_email` doesn't exist on either), so
  Zendesk-heavy clusters undercounted affected users and the pm_insight
  cross-source hint disagreed with the counter. *Fix:* identity extraction
  is now a `SourcePlugin.identity()` function (per the plugin convention),
  used by both `evaluate_project` and `_generate_pm_insight`. Zendesk
  contributes `external_id`/requester; scout intentionally contributes ""
  (a scout finding is an aggregate observation, not a per-user event) —
  that zero is now a documented decision, not an accident.
- **Prose summaries vs structured summaries** (acknowledged, no change):
  scout summaries are LLM prose, so cross-source similarity against
  structured summaries will rarely clear 0.88 — scout events mostly
  self-cluster (same scout name prefix helps) and rely on the 0.60–0.88 LLM
  band for cross-source merges. Acceptable: repeated findings from the same
  scout dedup tightly, which is the main volume risk.
- `_generate_pm_insight` also had no scout line at all (scout-only clusters
  produced an empty signal block); scouts and unknown sources now get
  explicit lines, with scout severity marked as LLM-assessed.

## Also fixed while validating

- **Batch-stall bug**: Zendesk solved/closed tickets and Stripe
  `status='refunded'` events passed the SQL prefilter but failed the Python
  `is_negative` filter, so they were re-fetched forever — and because the
  batch is `LIMIT 50` oldest-first, 50 such events would permanently stall
  clustering for the project. The SQL prefilter now has Zendesk/refunded
  twins (exported as SQL fragments from the plugins, same pattern as
  `POSITIVE_SQL`), and a full-batch-skipped condition logs a loud warning
  since a future plugin/SQL divergence would hit the same failure mode.
  Validated: 56 old non-negative events + 1 fresh Sentry error → the error
  clusters on the first pass.
- **Simulate-mode correlation was broken**: `demo.py` used `json.dumps` in
  the cross-source-context prompt without importing `json`, so every
  correlated generation raised `NameError` and was silently swallowed —
  demo sources never actually correlated. One-line import fix; Simulate
  now validated end-to-end.

## Not done, on purpose

- No new scoring framework, no interaction terms, no configurable half-life
  knob — the decay constant is one module-level constant until someone
  actually needs to tune it.
- No threshold changes without labeled data to calibrate against.
- No per-cluster regeneration gating state.
- `api/chat.py` still matches question embeddings against cluster
  embeddings; those are now event-centroids rather than title embeddings.
  Chat retrieval quality on titles may shift slightly, but it has a
  priority-ranking fallback and correctness of clustering wins.

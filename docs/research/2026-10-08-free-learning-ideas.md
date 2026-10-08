# Free learning improvements and a clearer bot page

The useful target is better evidence per calculation, not more training runs. The current account has little finished evidence, and its delayed replay does not count as fresh confirmation. Faster computation cannot remove that limitation.

## Implemented in this release

1. **Reuse identical fits within each review.** Training windows often contain exactly the same rows early in a campaign. A bounded cache compares the complete ordered training inputs, feature set and regularisation. Equivalent windows share a fit. Changed labels, costs or features force a new fit. The cache is discarded after the review. Tests compare coefficients, thresholds and full walk-forward results against the existing uncached path.
2. **Explain the dataset automatically.** Nightly preparation and weekly review record usable examples, taken versus skipped ideas, replay versus fresh evidence, waiting outcomes, missing details, duplicate opportunities, unaffordable trades and ambiguous exits. This audits the existing filters without changing the training set. The report includes its check time.
3. **Show progress as evidence.** The mobile bot has an illustrated avatar and activity based on recorded jobs. Its notebook shows the training threshold, trained versions, adopted changes and fresh results. It explains the next hurdle. Missing or stale activity stops the animation.
4. **Keep the running cost bounded.** No new dependency, AI API, purchased data, GPU or additional scheduled job. Existing quota guards and the capped candidate search remain. Animations pause off screen, in a hidden tab and with reduced motion. The learning record uses a campaign-specific session cache and keeps its existing five-minute visible-page refresh.

## Other strong ideas, in priority order

| Idea | Why it helps | Boundary |
|---|---|---|
| Train on already stored historical outcomes | Builds an initial model without buying data | The existing historical-study workflow must keep chronology, untouched test periods and an honest development-exposed label. No historic profits enter the virtual account. |
| Reuse prepared feature matrices across model strengths | Removes repeated preprocessing when larger datasets arrive | Benchmark first; preserve the exact training-only normaliser and every fold's cutoff. |
| Track changes in feature coverage and calibration | Explains whether a model is seeing conditions it rarely trained on | Report sample counts. Do not automatically retune refuted strategies or relax evidence floors. |
| Cache completed evaluation work across reviews | Saves more computation when no new outcomes arrive | Requires a versioned key for data, code, rules, incumbent, comparisons and random seeds. An old evaluation must never become a new independent passing review. |
| Add a short evidence digest after each review | Makes the bot explain what it tried, rejected and still needs | Generate it from recorded counts and verdicts, using templates rather than paid language-model calls. |
| Measure new, separately registered methods | Could produce more informative ideas than repeatedly adjusting refuted methods | Use Diagnostics and the existing promotion process. A new idea is a hypothesis, not an improvement until tested. |

## Decisions deliberately retained

- The registered candidate grid, weekly cap, risk limits and adoption/rollback rules stay unchanged.
- Chronological evaluation and the embargo stay in place. Preprocessing is fitted only on training rows.
- Taken and skipped opportunities both contribute when their outcomes are usable. Duplicate opportunities do not inflate the sample.
- Replay, late catch-up and generated test prices never become fresh evidence. A progress ring is not an intelligence, accuracy or profitability score.
- No automatic source-code rewriting, parameter hunt on refuted strategies, or paid LLM/GPU loop.

## Sources and practical limits

The existing code is the authority for Aegis's rules. The [scikit-learn evaluation guide](https://scikit-learn.org/stable/modules/cross_validation.html) explains why ordinary random splits are inappropriate for time-dependent observations. Its [data-leakage guidance](https://scikit-learn.org/1.8/common_pitfalls.html) supports keeping preprocessing within each training split. These principles are already present in the learner and are preserved by the cache.

[Neon's scale-to-zero documentation](https://neon.com/docs/introduction/scale-to-zero) explains why idle services should be allowed to sleep. Provider allowances can change; the app's run-time and storage counters are conservative guards, not exact billing measurements. This release adds no paid service and no extra recurring jobs.

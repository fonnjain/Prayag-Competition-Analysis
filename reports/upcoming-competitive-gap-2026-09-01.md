# Upcoming Competitive Gap — 01 September 2026

Read-only production calculation performed on 31 August 2026 for the latest
confirmed, priced **Sparsh Pearl** mapping per Prayag code.

## Position movement

| Measure | 31 Aug 2026 | 01 Sep 2026 |
|---|---:|---:|
| Comparable mapped products | 150 | 150 |
| Median gap | +10.8% | +2.9% |
| Prayag cheaper | 130 / 150 | 98 / 150 |

- **31 products reverse competitive position on 01 September.**
- **Unfavourable to Prayag:** 31
- **Favourable to Prayag:** 0

## Representative products

| Code | Current gap (31 Aug) | Upcoming gap | Date used | Prices at upcoming date |
|---|---:|---:|---|---:|
| `151` | +3.8% | **-1.8%** | 01 Sep 2026 | Prayag ₹336 vs Sparsh ₹330 |
| `124-V` | +0.6% | **-7.2%** | 01 Sep 2026 | Prayag ₹362 vs Sparsh ₹336 |
| `168` | +1.0% | **-6.3%** | 01 Sep 2026 | Prayag ₹112 vs Sparsh ₹105 |
| `127` | +3.6% | **-4.7%** | 01 Sep 2026 | Prayag ₹274 vs Sparsh ₹261 |

The database-derived value for `168` rounds to **-6.3%**, rather than the
prompt's estimated -6.2%.

## Date resolution

For each product and competitor, the upcoming comparison date is the earliest
future effective date on either price stream. Both prices are then resolved at
that same date. If only one side changes, the other side keeps the price that
remains in force on that date. No upcoming comparison is emitted when neither
side has a future price.

Gap sign convention:

`(competitor effective price - Prayag MRP) / Prayag MRP × 100`

Positive means Prayag is cheaper. Current-gap fields and calculations are not
changed by the upcoming-gap feature.
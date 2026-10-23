# Publish state and phone search verification — 23 October 2026

## Initial read-only state

Production `/api/_build` returned:

```json
{"commitSha":"82b6103e0adc7dc44dd6a701d1c8d43c10071465","branch":"main","builtAt":"2026-10-23T07:39:43.740Z"}
```

This source already includes build-info, calculator free entry and its
no-write proof, navigation (`c19ce93`) and shared ranking (`a3a2e41`).
The only initial local-main commit beyond live source was `312bb06`,
“Published your App”. The anticipated unpublished stack was already live.
The contextual division-mapping busy-flag fix is not included in this work.

`pnpm typecheck` initially failed only in `pricing-logic-film`. Production
artifact builds are package-scoped, so this was an acceptance-policy failure,
not a publishing-tool refusal. The dedicated type-only fix is `48687fd`:
one browser-library declaration in that artifact's tsconfig. All root commands,
packages and strictness are preserved. No casts or ignores were needed.
The final full workspace typecheck passes.

## Exact original error inventory

All files below are relative to `artifacts/pricing-logic-film/`.

| File | Line:column | Error |
|---|---|---|
| src/components/video/VideoTemplate.tsx | 40:7; 41:21; 45:22; 45:49; 47:7 | TS2812: audio volume, pause, currentTime twice, play |
| src/components/video/VideoWithControls.tsx | 9:3; 18:16; 19:20; 37:28; 37:54; 37:70 | TS2304: window missing |
| same | 48:15; 54:5; 54:63 | TS2584: document missing |
| same | 48:47; 48:90; 49:28 | TS7006: parameter a implicitly any |
| same | 53:44 | TS2339: PointerEvent.pointerType missing |
| same | 53:121 | TS2812: HTMLDivElement.contains missing |
| same | 53:142 | TS2304: Node missing |
| src/hooks/use-mobile.tsx | 11:17; 13:19; 16:17 | TS2304: window missing |
| src/lib/video/animations.ts | 184:3; 195:3; 213:3; 221:3 | TS2322: transition-bearing values not assignable to Variant |
| src/lib/video/controls.tsx | 17:28; 17:54; 17:70 | TS2304: window missing |
| same | 39:27; 40:20 | TS2584: document missing |
| same | 42:16; 43:21; 44:34 | TS7006: parameter animation implicitly any |
| src/lib/video/hooks.ts | 77:5; 80:5; 84:5; 87:7; 120:11 | TS2304: window missing |
| src/lib/video/playerActions.ts | 13:3 | TS2304: window missing |
| src/lib/video/workspaceControls.ts | 80:18; 133:3; 197:26; 227:3; 232:5 | TS2304: window missing |
| src/main.tsx | 7:12 | TS2584: document missing |

## Live checks

- Calculator PS: 176 returned, 176 rendered; first ten all PS-prefix; visible
  “Showing all 176 matching products.”
- Local one-off competitor/product and App / Edited / Entered markers work.
  Amber recorded-unit disagreement displays `per 3-m pipe` verbatim; missing
  units remain neutral. No business write occurred.
- Anonymous Finder is public; catalogue products GET returns 401 without auth,
  200 with the genuine administrator session.
- Finder retained the existing enforced Ashirvad exclusion. Its competitor list
  omits Ashirvad; Calculator's unrestricted list includes Ashirvad. The existing
  admin personal exclusion also remains active without being edited or activated.
  Adding a second Finder filter narrowed anonymous PS results 142 → 25 and
  administrator PS results 142 → 23 under their existing different scopes.
- **Live user/counter navigation is not verified:** the credential labelled
  non-admin authenticates as admin in production. No role or credential was
  changed and no fake identity was used. Automated user/counter shared-navigation
  assertions pass; those are not a substitute for a genuine live role check.

## Division safety — production, read-only before/after

| Observation UTC (IST = UTC + 05:30) | Catalogue | Divisions | Composites | Batch 90 |
|---|---:|---:|---:|---|
| 07:49:36.519 (13:19:36.519 IST) | 7,191 | 7 | 0 | applied |
| 08:01:10.335 (13:31:10.335 IST) | 7,191 | 7 | 0 | applied |

The full catalogue row hash was identical:
`cdfac73ae470ea79a8b03837dd96db61`.
This is the before/after MD5 of ordered full-row JSON used for this check,
not a replacement definition for earlier classification or source fingerprints.
No division Preview, batch stage, apply, undo or other data operation was run.

## Phone timing and minimum

Before implementing the minimum, standalone Playwright measured the live
300-option query on a 390×844 mobile/touch DPR-2 browser, CPU slowdown 6×,
Slow 4G (150 ms; 200,000 B/s down; 93,750 B/s up).

At 07:58:20 UTC (13:28:20 IST), production returned and rendered 300 of 4,739:
**1,485.9 ms input-to-painted-options**, **644.3 ms response-end-to-paint**.
The visible notice used 4,739, the server's total. Development's older total
was 4,533. Earlier remote observation-tool timeouts were not reproduced by the
standalone driver; do not describe them as a proven application hang.

Read-only catalogue checks found zero single-character codes in production
(07:49:36 UTC) and development (07:49:40 UTC). The subsequent two-character
guard suppresses direct and exact search requests until admitted, including
stale debounced requests/results when shortening input. Short exact codes remain
explicit basket-local ad-hoc entries. Browse, ranking, exact identity, buckets,
server totals and the 300-option ceiling are unchanged.

Final verification combines 7 formatting tests, 53 Finder tests and 20 API
tests, all passing, plus the full workspace typecheck. The live checks above
identify the actual build observed; publishing the new source still requires
the user's Publish action. Do not label the new guard live without a new
build-info confirmation.

# Build-info release gate

## Decision — 18 October 2026

For the isolated, data-free `GET /api/_build` change, use the **API-package
typecheck and focused tests** as its acceptance gate. Do not disable,
exclude packages from, or relax the full workspace typecheck.

The endpoint change is separate from the completed production division apply.
Passing its scoped gate is not a claim that the full workspace check passes
or that the endpoint has already been published.

Source identity is injected while compiling. It is obtained from actual Git
metadata, or from the explicit pair `BUILD_COMMIT_SHA` and `BUILD_BRANCH` in
build contexts without Git. If neither supplies a valid identity, the build
fails rather than returning a guessed commit. A missing environment-variable
pair alone does not fail a build when valid Git metadata is available.

## Separately tracked, pre-existing check failure

The full workspace check after build-info code generation failed in
`artifacts/pricing-logic-film`: missing browser DOM typings and animation
transition typings. This is not a generated API-type failure.

Resolve those video-artifact errors separately, following the video skill's
ownership rules, without changing the approved film content or weakening the
workspace gate. No video files or validation configuration were changed as
part of the build-info endpoint.

## Resolved — 23 October 2026

The full `pnpm typecheck` now passes, including both video artifacts and all
other workspace packages. The dedicated correction adds
`"lib": ["ES2022", "DOM", "DOM.Iterable"]` to the browser film's own TypeScript
configuration. Missing DOM types caused both the browser API errors and the
misleading Framer Motion `Variant` errors. No animation annotations or assertions
were necessary; all film source and runtime values remain unchanged.

No root command, exclusions, strictness, or package inclusion was weakened.
The scoped exception above is historical, not the gate used for this release.

The live `/api/_build` observed before this fix already identified source
`82b6103e0adc7dc44dd6a701d1c8d43c10071465`, built
`2026-10-23T07:39:43.740Z`, which includes the earlier calculator, navigation,
build-info and shared-ranker changes. Artifact production build commands are
package-scoped; the previous workspace failure was an acceptance-policy
blocker, not evidence that the publishing service refused those builds.

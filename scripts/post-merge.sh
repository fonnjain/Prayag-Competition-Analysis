#!/bin/bash
set -e
pnpm install --frozen-lockfile
node scripts/preflight-db.mjs
pnpm --filter db push

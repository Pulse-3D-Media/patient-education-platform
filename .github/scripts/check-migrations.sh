#!/usr/bin/env bash
#
# The "production migration" check, run by .github/workflows/migration-check.yml
# on every pull request to main.
#
# Why it exists: three times a pull request was merged without its database
# migration being applied to production first, and the signed-in pages went
# down, because the new code expected columns production did not have yet.
#
# What it does:
#   1. Lists every file under prisma/migrations/ that this pull request adds,
#      changes or deletes.
#   2. None: the check passes. Most pull requests end here.
#   3. Some: the check fails, unless the pull request carries the label
#      "production-migrated", which Evan adds after he has migrated production
#      (CLAUDE.md, rule 3, step 4).
#
# The label is a promise a person makes, not proof. GitHub cannot see the
# production database (and must never be given its connection string), so this
# check cannot confirm the migration really ran. It makes forgetting impossible,
# not lying.
#
# It is handed three values by the workflow:
#   BASE_SHA   the commit on main the pull request is compared with
#   HEAD_SHA   the newest commit on the pull request's branch
#   HAS_LABEL  "true" when the pull request has the production-migrated label
#
# It can also be run by hand from a checkout with full history, for example:
#   BASE_SHA=main HEAD_SHA=HEAD HAS_LABEL=false bash .github/scripts/check-migrations.sh

# Stop at the first command that fails, and treat a missing value as a failure.
# If anything goes wrong in here the check fails; it never passes by accident.
set -euo pipefail

: "${BASE_SHA:?BASE_SHA is missing}"
: "${HEAD_SHA:?HEAD_SHA is missing}"
: "${HAS_LABEL:?HAS_LABEL is missing}"

# "A...B" (three dots) means: what changed on the branch since it split from
# main. Changes that landed on main in the meantime are not counted.
# --no-renames makes a migration moved out of the folder show as deleted from
# it, so that counts as a change too.
changed=$(git diff --name-only --no-renames "${BASE_SHA}...${HEAD_SHA}" -- prisma/migrations/)

if [ -z "$changed" ]; then
  echo "This pull request does not change prisma/migrations/. Nothing to migrate."
  exit 0
fi

echo "This pull request changes these files under prisma/migrations/:"
echo "$changed" | sed 's/^/  /'
echo

if [ "$HAS_LABEL" = "true" ]; then
  echo "It has the production-migrated label, so production has been migrated. Passing."
  exit 0
fi

message="This PR changes the database. Migrate production with npx.cmd prisma migrate deploy from the main checkout on this branch, then add the production-migrated label."

# "::error::" is how a GitHub Actions step puts a message at the top of the
# check's page and on the pull request itself.
echo "::error title=Production not migrated::${message}"

# The same words on the run's summary page, when there is one (not when this
# script is run by hand).
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  {
    echo "### Production has not been migrated"
    echo
    echo "$message"
    echo
    echo "Files under prisma/migrations/ in this pull request:"
    echo
    echo "$changed" | sed 's/^/- /'
  } >> "$GITHUB_STEP_SUMMARY"
fi

exit 1

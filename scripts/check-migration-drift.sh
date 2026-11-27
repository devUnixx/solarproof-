#!/usr/bin/env bash
# check-migration-drift.sh
# -------------------------
# Compute MD5 checksums for every migration file in supabase/migrations/
# (excluding the rollbacks/ sub-directory) and optionally compare them
# against the checksums recorded in the migration_registry table.
#
# Usage:
#   bash scripts/check-migration-drift.sh            # compare against DB (requires DATABASE_URL)
#   bash scripts/check-migration-drift.sh --dry-run  # print checksums only, no DB access
#   bash scripts/check-migration-drift.sh --compare-envs
#       Compare staging vs production migration history using the Supabase CLI
#       (`supabase migration list` against both linked projects). Exits non-zero
#       if staging is behind production. Can be combined with the checksum
#       comparison above.
#
# Exit codes:
#   0 – all checksums match (or --dry-run mode) and staging is not behind production
#   1 – one or more checksums differ from the registry, or staging is behind
#       production (drift detected)
#   2 – unexpected error (missing tool, etc.)
#
# Environment variables:
#   DATABASE_URL  PostgreSQL connection string used by psql.
#                 If unset, the script falls back to --dry-run behaviour.
#   STAGING_PROJECT_REF     Supabase project ref for staging (required by --compare-envs).
#   PRODUCTION_PROJECT_REF  Supabase project ref for production (required by --compare-envs).
#   SUPABASE_ACCESS_TOKEN   Supabase access token used by the CLI (required by --compare-envs).
=======

set -euo pipefail

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Colour

info()    { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*" >&2; }

# ---------------------------------------------------------------------------
# Parse arguments
# ---------------------------------------------------------------------------
DRY_RUN=false
COMPARE_ENVS=false

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    --compare-envs) COMPARE_ENVS=true ;;
    --help|-h)
      sed -n '2,/^$/p' "$0" | grep '^#' | sed 's/^# \?//'
      exit 0
      ;;
    *)
      error "Unknown argument: $arg"
      exit 2
      ;;
  esac
done

# ---------------------------------------------------------------------------
# Locate migration files
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
MIGRATIONS_DIR="$REPO_ROOT/supabase/migrations"

# ---------------------------------------------------------------------------
# Staging vs production migration history comparison
# ---------------------------------------------------------------------------
# Uses `supabase migration list --linked` against each project and compares the
# set of applied migration versions. Staging must contain every migration that
# production has applied; otherwise staging is behind and we fail.
compare_environments() {
  local staging_ref="${STAGING_PROJECT_REF:-}"
  local production_ref="${PRODUCTION_PROJECT_REF:-}"

  if [[ -z "$staging_ref" || -z "$production_ref" ]]; then
    error "STAGING_PROJECT_REF and PRODUCTION_PROJECT_REF must be set for --compare-envs."
    return 2
  fi

  if ! command -v supabase &>/dev/null; then
    error "supabase CLI not found in PATH – required for --compare-envs."
    return 2
  fi

  local tmp_dir
  tmp_dir="$(mktemp -d)"
  # shellcheck disable=SC2064
  trap "rm -rf '$tmp_dir'" RETURN

  local staging_out="$tmp_dir/staging.txt"
  local production_out="$tmp_dir/production.txt"

  info "Fetching migration history for staging ($staging_ref)..."
  if ! supabase migration list --project-ref "$staging_ref" >"$staging_out" 2>&1; then
    error "Failed to list staging migrations. Output:"
    cat "$staging_out" >&2
    return 2
  fi

  info "Fetching migration history for production ($production_ref)..."
  if ! supabase migration list --project-ref "$production_ref" >"$production_out" 2>&1; then
    error "Failed to list production migrations. Output:"
    cat "$production_out" >&2
    return 2
  fi

  # `supabase migration list` prints a table with columns:
  #   Local | Remote | Time (UTC)
  # We extract the Remote version column (second field) for each row.
  extract_remote_versions() {
    awk -F'|' '
      NR <= 2 { next }                       # skip header + separator
      {
        v = $2
        gsub(/[[:space:]]/, "", v)
        if (v != "" && v != "Remote") print v
      }
    ' "$1" | sort -u
  }

  local staging_versions="$tmp_dir/staging_versions.txt"
  local production_versions="$tmp_dir/production_versions.txt"
  extract_remote_versions "$staging_out" >"$staging_versions"
  extract_remote_versions "$production_out" >"$production_versions"

  # Versions applied in production but missing from staging => staging is behind.
  local missing
  missing="$(comm -23 "$production_versions" "$staging_versions")"

  if [[ -n "$missing" ]]; then
    error "Staging is BEHIND production – the following migration version(s) are applied in production but not in staging:"
    while IFS= read -r version; do
      [[ -z "$version" ]] && continue
      error "  - $version"
    done <<< "$missing"
    error "Apply the missing migrations to staging before deploying."
    return 1
  fi

  info "Staging migration history is up to date with production."
  return 0
}

if [[ ! -d "$MIGRATIONS_DIR" ]]; then
  error "Migrations directory not found: $MIGRATIONS_DIR"
  exit 2
fi

# Collect all .sql files excluding the rollbacks/ sub-directory, sorted by name
mapfile -t MIGRATION_FILES < <(
  find "$MIGRATIONS_DIR" -maxdepth 1 -name '*.sql' | sort
)

if [[ ${#MIGRATION_FILES[@]} -eq 0 ]]; then
  warn "No migration files found in $MIGRATIONS_DIR"
  exit 0
fi

# ---------------------------------------------------------------------------
# Compute MD5 checksums
# ---------------------------------------------------------------------------
# Portable md5 command: prefer md5sum (Linux), fall back to md5 (macOS).
if command -v md5sum &>/dev/null; then
  md5_of() { md5sum "$1" | awk '{print $1}'; }
elif command -v md5 &>/dev/null; then
  md5_of() { md5 -q "$1"; }
else
  error "Neither md5sum nor md5 found – cannot compute checksums."
  exit 2
fi

declare -A LOCAL_CHECKSUMS

info "Computing checksums for ${#MIGRATION_FILES[@]} migration file(s)..."
for filepath in "${MIGRATION_FILES[@]}"; do
  filename="$(basename "$filepath")"
  checksum="$(md5_of "$filepath")"
  LOCAL_CHECKSUMS["$filename"]="$checksum"
  printf "  %-60s  %s\n" "$filename" "$checksum"
done

# ---------------------------------------------------------------------------
# Dry-run: print and exit
# ---------------------------------------------------------------------------
if [[ "$DRY_RUN" == true ]] || [[ -z "${DATABASE_URL:-}" ]]; then
  if [[ -z "${DATABASE_URL:-}" ]]; then
    warn "DATABASE_URL is not set – running in dry-run mode (no DB comparison)."
  else
    info "Dry-run mode – skipping DB comparison."
  fi
  info "Done (dry-run). ${#MIGRATION_FILES[@]} file(s) listed."
  exit 0
fi

# ---------------------------------------------------------------------------
# Fetch recorded checksums from migration_registry
# ---------------------------------------------------------------------------
if ! command -v psql &>/dev/null; then
  error "psql not found in PATH. Install the PostgreSQL client tools or set DATABASE_URL='' for dry-run mode."
  exit 2
fi

info "Fetching checksums from migration_registry..."

# Query returns tab-separated (migration_name, checksum) rows, one per line.
DB_ROWS="$(
  psql "$DATABASE_URL" --no-psqlrc --tuples-only --no-align \
    --field-separator=$'\t' \
    --command="SELECT migration_name, checksum FROM migration_registry ORDER BY migration_name;" \
  2>&1
)" || {
  error "psql query failed. Output:"
  echo "$DB_ROWS" >&2
  exit 2
}

declare -A DB_CHECKSUMS
while IFS=$'\t' read -r name chk; do
  # Skip empty lines
  [[ -z "$name" ]] && continue
  DB_CHECKSUMS["$name"]="$chk"
done <<< "$DB_ROWS"

# ---------------------------------------------------------------------------
# Compare local vs. recorded checksums
# ---------------------------------------------------------------------------
DRIFT_FOUND=false

info "Comparing local checksums against migration_registry..."
for filename in "${!LOCAL_CHECKSUMS[@]}"; do
  local_chk="${LOCAL_CHECKSUMS[$filename]}"

  if [[ -z "${DB_CHECKSUMS[$filename]+_}" ]]; then
    # Not yet registered – informational only (might be a new, unapplied migration)
    warn "  NOT IN REGISTRY: $filename  (local: $local_chk)"
  elif [[ "${DB_CHECKSUMS[$filename]}" == "bootstrap" ]]; then
    # Special placeholder set by the migration itself; update with real checksum.
    info "  UPDATING bootstrap entry: $filename"
    psql "$DATABASE_URL" --no-psqlrc --quiet \
      --command="SELECT record_migration('$filename', '$local_chk', 'check-migration-drift.sh', 'Checksum updated from bootstrap');" \
    || warn "  Could not update registry entry for $filename"
  elif [[ "${DB_CHECKSUMS[$filename]}" != "$local_chk" ]]; then
    error "  DRIFT DETECTED: $filename"
    error "    registry: ${DB_CHECKSUMS[$filename]}"
    error "    local:    $local_chk"
    DRIFT_FOUND=true
  else
    info "  OK: $filename"
  fi
done

# Also flag registry entries whose files are gone from the repo
for db_name in "${!DB_CHECKSUMS[@]}"; do
  if [[ -z "${LOCAL_CHECKSUMS[$db_name]+_}" ]]; then
    warn "  IN REGISTRY BUT FILE MISSING: $db_name"
  fi
done

# ---------------------------------------------------------------------------
# Staging vs production comparison (optional)
# ---------------------------------------------------------------------------
ENV_DRIFT_FOUND=false

if [[ "$COMPARE_ENVS" == true ]]; then
  set +e
  compare_environments
  env_status=$?
  set -e

  case "$env_status" in
    0) ;;
    1) ENV_DRIFT_FOUND=true ;;
    *) exit 2 ;;
  esac
fi

# ---------------------------------------------------------------------------
# Final result
# ---------------------------------------------------------------------------
if [[ "$DRIFT_FOUND" == true ]]; then
  error "Schema drift detected – see above. Investigate before deploying."
  exit 1
fi

if [[ "$ENV_DRIFT_FOUND" == true ]]; then
  error "Staging is behind production – see above. Resolve before deploying."
  exit 1
fi

info "All registered migration checksums match. No drift detected."
if [[ "$COMPARE_ENVS" == true ]]; then
  info "Staging migration history matches production."
fi
exit 0

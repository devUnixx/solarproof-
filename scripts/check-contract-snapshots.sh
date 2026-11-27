#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

snapshot_dirs=(
  apps/contracts/snapshots
  apps/contracts/energy_token/test_snapshots
  apps/contracts/audit_registry/test_snapshots
  apps/contracts/community_governance/test_snapshots
)

if ! git diff --quiet -- "${snapshot_dirs[@]}"; then
  printf '%s\n' "Contract snapshots changed during tests. Review the behavior change and update snapshots intentionally."
  git --no-pager diff -- "${snapshot_dirs[@]}"
  exit 1
fi

untracked="$(git ls-files --others --exclude-standard -- "${snapshot_dirs[@]}")"
if [[ -n "$untracked" ]]; then
  printf '%s\n' "Tests generated untracked contract snapshots:"
  printf '%s\n' "$untracked"
  exit 1
fi

# --- WASM binary size snapshot check -----------------------------------------
#
# Builds release WASM for each contract, records the resulting binary sizes in
# a committed snapshot file, and fails if any contract grows by more than 5%
# versus the snapshot. Run with --update to deliberately regenerate the
# snapshot after reviewing a size change.

wasm_snapshot_file="apps/contracts/wasm-size-snapshot.txt"
size_threshold_percent=5

contracts=(
  energy_token
  audit_registry
  community_governance
  multisig_admin
)

update_snapshot=0
for arg in "$@"; do
  case "$arg" in
    --update)
      update_snapshot=1
      ;;
    *)
      printf '%s\n' "Unknown argument: $arg" >&2
      printf '%s\n' "Usage: $0 [--update]" >&2
      exit 2
      ;;
  esac
done

# Locate the built WASM artifact for a contract. Soroban builds place the
# optimized artifact under target/wasm32-unknown-unknown/release.
find_wasm() {
  local contract="$1"
  local wasm_name="${contract//-/_}.wasm"
  local candidates=(
    "target/wasm32-unknown-unknown/release/${wasm_name}"
    "apps/contracts/target/wasm32-unknown-unknown/release/${wasm_name}"
  )
  local candidate
  for candidate in "${candidates[@]}"; do
    if [[ -f "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

build_contract() {
  local contract="$1"
  printf '%s\n' "Building release WASM for ${contract}..."
  cargo build \
    --manifest-path "apps/contracts/${contract}/Cargo.toml" \
    --target wasm32-unknown-unknown \
    --release \
    --locked
}

declare -A current_sizes=()

for contract in "${contracts[@]}"; do
  build_contract "$contract"
  if ! wasm_path="$(find_wasm "$contract")"; then
    printf '%s\n' "Could not locate built WASM for ${contract}." >&2
    exit 1
  fi
  size="$(wc -c < "$wasm_path" | tr -d '[:space:]')"
  current_sizes["$contract"]="$size"
done

if [[ "$update_snapshot" -eq 1 ]]; then
  {
    printf '%s\n' "# WASM binary size snapshot. Regenerate deliberately with:"
    printf '%s\n' "#   scripts/check-contract-snapshots.sh --update"
    printf '%s\n' "# Format: <contract> <size-in-bytes>"
    for contract in "${contracts[@]}"; do
      printf '%s %s\n' "$contract" "${current_sizes[$contract]}"
    done
  } > "$wasm_snapshot_file"
  printf '%s\n' "Updated WASM size snapshot at ${wasm_snapshot_file}."
  exit 0
fi

if [[ ! -f "$wasm_snapshot_file" ]]; then
  printf '%s\n' "Missing WASM size snapshot at ${wasm_snapshot_file}." >&2
  printf '%s\n' "Generate it deliberately with: scripts/check-contract-snapshots.sh --update" >&2
  exit 1
fi

declare -A snapshot_sizes=()
while read -r contract size _rest; do
  [[ -z "${contract:-}" ]] && continue
  [[ "$contract" == \#* ]] && continue
  snapshot_sizes["$contract"]="$size"
done < "$wasm_snapshot_file"

regression=0
for contract in "${contracts[@]}"; do
  current="${current_sizes[$contract]}"
  if [[ -z "${snapshot_sizes[$contract]:-}" ]]; then
    printf '%s\n' "No snapshot entry for ${contract} (current size: ${current} bytes)." >&2
    regression=1
    continue
  fi
  baseline="${snapshot_sizes[$contract]}"
  # Compute allowed size: baseline * (100 + threshold) / 100, rounded down.
  allowed=$(( baseline * (100 + size_threshold_percent) / 100 ))
  if (( current > allowed )); then
    growth=$(( (current - baseline) * 100 / baseline ))
    printf '%s\n' "WASM size regression for ${contract}: ${baseline} -> ${current} bytes (+${growth}%, limit ${size_threshold_percent}%)." >&2
    regression=1
  else
    printf '%s\n' "${contract}: ${current} bytes (snapshot ${baseline} bytes) OK."
  fi
done

if (( regression != 0 )); then
  printf '%s\n' "WASM size check failed. If the growth is intentional, review it and update the snapshot with:" >&2
  printf '%s\n' "  scripts/check-contract-snapshots.sh --update" >&2
  exit 1
fi

printf '%s\n' "WASM size check passed."
</｜｜DSML｜｜ parameter>
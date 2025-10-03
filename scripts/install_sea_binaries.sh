#!/usr/bin/env bash
set -euo pipefail

repo="${GITHUB_REPOSITORY:-terrazul-ai/terrazul}"
run_id=""
workflow_url=""
package_dir=""
dist_dir=""
artifact_dir=""
target_root=""

usage() {
  cat <<USAGE
Usage: install_sea_binaries.sh [options] <staging-root>
  --repo <owner/name>         GitHub repository (default: GITHUB_REPOSITORY or terrazul-ai/terrazul)
  --run-id <id>               Workflow run ID that produced SEA artifacts
  --workflow-url <url>        Workflow run URL (used for logging only)
  --package-dir <path>        Package root directory (default: <staging-root>/package)
  --dist-dir <path>           Directory to mirror dist artifacts into (default: <package-dir>/dist)
  --artifact-dir <path>       Directory to download artifacts into (default: <staging-root>/sea-artifacts)
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo)
      repo="$2"
      shift 2
      ;;
    --run-id)
      run_id="$2"
      shift 2
      ;;
    --workflow-url)
      workflow_url="$2"
      shift 2
      ;;
    --package-dir)
      package_dir="$2"
      shift 2
      ;;
    --dist-dir)
      dist_dir="$2"
      shift 2
      ;;
    --artifact-dir)
      artifact_dir="$2"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    --*)
      echo "install_sea_binaries.sh: unknown option $1" >&2
      usage >&2
      exit 1
      ;;
    *)
      target_root="$1"
      shift 1
      ;;
  esac
done

if [[ -z "$target_root" ]]; then
  echo "install_sea_binaries.sh: staging root is required" >&2
  usage >&2
  exit 1
fi

if [[ -z "$run_id" && -n "$workflow_url" ]]; then
  run_id="${workflow_url##*/}"
fi

if [[ -z "$run_id" ]]; then
  echo "install_sea_binaries.sh: --run-id is required" >&2
  exit 1
fi

staging_root="${target_root%/}"
if [[ -z "$package_dir" ]]; then
  package_dir="${staging_root}/package"
fi
if [[ -z "$dist_dir" ]]; then
  dist_dir="${package_dir}/dist"
fi
if [[ -z "$artifact_dir" ]]; then
  artifact_dir="${staging_root}/sea-artifacts"
fi

mkdir -p "$dist_dir"
mkdir -p "$artifact_dir"
sea_dir="${dist_dir%/}/sea"
mkdir -p "$sea_dir"

printf 'Downloading SEA artifacts from run %s (%s)\n' "$run_id" "$repo"

if [[ -d "$artifact_dir" ]]; then
  rm -rf "$artifact_dir"/*
fi

GH_CLI="${GH_CLI:-gh}"
"$GH_CLI" run download "$run_id" --repo "$repo" --dir "$artifact_dir"

if [[ ! -d "$artifact_dir" ]]; then
  echo "install_sea_binaries.sh: gh run download produced no files" >&2
  exit 1
fi

# Mirror dist folder contents for release attachments under dist/sea/<target>
while IFS= read -r -d '' artifact_path; do
  if [[ -d "$artifact_path/dist" ]]; then
    while IFS= read -r -d '' target_path; do
      target_name="$(basename "$target_path")"
      mkdir -p "$sea_dir/$target_name"
      rsync -a "$target_path/" "$sea_dir/$target_name/"
    done < <(find "$artifact_path/dist" -mindepth 1 -maxdepth 1 -type d -print0)
  else
    rsync -a "$artifact_path/" "$sea_dir/"
  fi
done < <(find "$artifact_dir" -mindepth 1 -maxdepth 1 -type d -print0)

echo "SEA artifacts mirrored into $sea_dir"


#!/usr/bin/env python3
"""Stage a release by assembling npm assets and SEA binaries."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

DEFAULT_WORKFLOW_NAME = "release.yml"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Stage npm artifacts using SEA binaries produced by the release workflow",
    )
    parser.add_argument(
        "--release-version",
        required=True,
        help="Semantic version to embed in the staged npm package (without the sea-v prefix)",
    )
    parser.add_argument(
        "--tmp",
        dest="tmp",
        help="Existing directory to use for staging (default: create temporary directory)",
    )
    parser.add_argument(
        "--workflow",
        default=DEFAULT_WORKFLOW_NAME,
        help="Workflow file name that produced the artifacts (default: release.yml)",
    )
    parser.add_argument(
        "--repo",
        default=os.environ.get("GITHUB_REPOSITORY", "terrazul-ai/terrazul"),
        help="GitHub repository in owner/name format (default derived from environment)",
    )
    parser.add_argument(
        "--gh",
        default=os.environ.get("GH_CLI", "gh"),
        help="Path to the GitHub CLI binary (default: gh)",
    )
    return parser.parse_args()


def _gh_json(gh: str, args: list[str]) -> dict | list:
    completed = subprocess.run(
        [gh, *args],
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        encoding="utf-8",
    )
    if not completed.stdout:
        raise RuntimeError(f"gh {args} returned no output")
    return json.loads(completed.stdout)


def locate_workflow_run(
    gh: str,
    repo: str,
    workflow: str,
    release_version: str,
) -> tuple[str, str]:
    run_id = os.environ.get("GITHUB_RUN_ID")
    if run_id:
        run_url = f"https://github.com/{repo}/actions/runs/{run_id}"
        return run_id, run_url

    branch = f"sea-v{release_version}"
    runs = _gh_json(
        gh,
        [
            "run",
            "list",
            "--repo",
            repo,
            "--workflow",
            workflow,
            "--json",
            "databaseId,headBranch,url",  # url is GA v2 only but populated for CLI >=2.34
            "--limit",
            "20",
        ],
    )
    if not isinstance(runs, list):  # pragma: no cover - defensive
        raise RuntimeError("Unexpected gh run list payload")

    for run in runs:
        head_branch = (run or {}).get("headBranch")
        if head_branch == branch:
            database_id = str(run.get("databaseId"))
            run_url = run.get("url") or f"https://github.com/{repo}/actions/runs/{database_id}"
            return database_id, run_url

    raise RuntimeError(
        f"Unable to locate workflow run for {branch}. Ensure the matrix build finished successfully.",
    )


def invoke_stage_shell(
    release_version: str,
    staging_dir: Path,
    workflow_run_id: str,
    workflow_run_url: str,
) -> None:
    script_path = Path(__file__).with_name("stage_release.sh")
    if not script_path.exists():
        raise FileNotFoundError(f"Missing helper script: {script_path}")

    cmd = [
        str(script_path),
        "--release-version",
        release_version,
        "--tmp",
        str(staging_dir),
        "--run-id",
        workflow_run_id,
        "--run-url",
        workflow_run_url,
    ]

    env = os.environ.copy()
    env.setdefault("SEA_RELEASE_VERSION", release_version)
    env.setdefault("SEA_RELEASE_TMP", str(staging_dir))
    env.setdefault("SEA_RELEASE_RUN_ID", workflow_run_id)
    env.setdefault("SEA_RELEASE_RUN_URL", workflow_run_url)

    subprocess.run(cmd, check=True, env=env)


def main() -> None:
    args = parse_args()
    tmp_arg = args.tmp

    if tmp_arg:
        staging_dir = Path(tmp_arg).expanduser().resolve()
        staging_dir.mkdir(parents=True, exist_ok=True)
        run_id, run_url = locate_workflow_run(args.gh, args.repo, args.workflow, args.release_version)
        invoke_stage_shell(args.release_version, staging_dir, run_id, run_url)
        return

    with tempfile.TemporaryDirectory(prefix="tz-stage-") as tmpdir:
        staging_dir = Path(tmpdir)
        run_id, run_url = locate_workflow_run(args.gh, args.repo, args.workflow, args.release_version)
        invoke_stage_shell(args.release_version, staging_dir, run_id, run_url)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(130)
    except Exception as exc:  # pragma: no cover - propagated to caller with stderr messaging
        print(f"stage_release.py error: {exc}", file=sys.stderr)
        sys.exit(1)

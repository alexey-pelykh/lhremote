#!/usr/bin/env python3

# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (C) 2026 Oleksii PELYKH

"""Tests for `check-memory-freshness.py`.

Runs the checker as a subprocess rather than importing it, so what is graded is
the contract CI actually depends on -- exit codes and printed output -- and not
a set of internal functions that could agree with each other while the CLI is
wrong.

Run: python3 tools/check-memory-freshness.test.py
"""

from __future__ import annotations

import os
import subprocess
import sys
import tempfile
from pathlib import Path

CHECKER = Path(__file__).resolve().parent / "check-memory-freshness.py"

# Fixed so ages are deterministic; every fixture below dates from here.
TODAY = "2026-09-05"

failures: list[str] = []
checks_run = 0


def write_entry(
    memory_dir: Path,
    name: str,
    *,
    volatility: str | None = "high",
    last_verified: str | None = "2026-09-01",
    verification: str | None = "empirical-walk",
    frontmatter: bool = True,
) -> None:
    """Write one memory entry, omitting any field passed as None."""
    parts = []
    if frontmatter:
        parts.append("---")
        parts.append(f"name: {name}")
        if volatility is not None:
            parts.append(f"volatility: {volatility}")
        if last_verified is not None:
            parts.append(f"last-verified: {last_verified}")
        if verification is not None:
            parts.append(f"verification: {verification}")
        parts.append("---")
    parts.append(f"Body of {name}.")
    (memory_dir / f"{name}.md").write_text("\n".join(parts) + "\n", encoding="utf-8")


def run(
    root: Path, *extra: str, actions: bool = False, today: str | None = TODAY
) -> subprocess.CompletedProcess[str]:
    """Drive the checker.

    `today` pins the clock so fixture ages are deterministic. Pass `None` to
    let the checker use the real date -- correct for anything graded against
    the live corpus, whose entries move independently of this file.
    """
    env = dict(os.environ)
    # Annotations are keyed off this, so tests must control it explicitly rather
    # than inherit whatever the surrounding shell happens to have set.
    env["GITHUB_ACTIONS"] = "true" if actions else "false"
    clock = ["--today", today] if today is not None else []
    return subprocess.run(
        [sys.executable, str(CHECKER), "--root", str(root), *clock, *extra],
        capture_output=True,
        text=True,
        env=env,
    )


def check(label: str, condition: bool, detail: str = "") -> None:
    global checks_run
    checks_run += 1
    if condition:
        print(f"  ok   {label}")
    else:
        print(f"  FAIL {label}{(' -- ' + detail) if detail else ''}")
        failures.append(label)


def case(name: str):
    print(f"\n{name}")
    tmp = tempfile.TemporaryDirectory()
    root = Path(tmp.name)
    memory = root / ".claude" / "memory"
    memory.mkdir(parents=True)
    # Index file is present in every case: it must never be counted as an entry.
    (memory / "MEMORY.md").write_text("- [an entry](an-entry.md)\n", encoding="utf-8")
    return tmp, root, memory


def test_overdue_fails_and_names_the_file() -> None:
    """AC1: age past the volatility budget -> non-zero exit, file named."""
    tmp, root, memory = case("AC1: an overdue entry fails and is named")
    with tmp:
        # high budget is 90d; 2026-05-06 is 122d before TODAY.
        write_entry(memory, "stale-claim", volatility="high", last_verified="2026-05-06")
        r = run(root)
        check("exit code is 1", r.returncode == 1, f"got {r.returncode}")
        check("names the offending file", "stale-claim.md" in r.stdout, r.stdout)
        check("labels it OVERDUE", "OVERDUE" in r.stdout, r.stdout)
        check("states the budget", "90d" in r.stdout, r.stdout)


def test_all_within_budget_passes() -> None:
    """AC2: everything inside its budget -> clean pass."""
    tmp, root, memory = case("AC2: an in-budget corpus passes")
    with tmp:
        write_entry(memory, "fresh-high", volatility="high", last_verified="2026-09-01")
        write_entry(memory, "fresh-stable", volatility="stable", last_verified="2026-05-06")
        r = run(root)
        check("exit code is 0", r.returncode == 0, f"got {r.returncode}: {r.stderr}")
        check("reports all within budget", "within budget" in r.stdout, r.stdout)


def test_reports_scanned_count() -> None:
    """AC3, first half: the check says how much it looked at."""
    tmp, root, memory = case("AC3: the scanned count is reported")
    with tmp:
        write_entry(memory, "one")
        write_entry(memory, "two")
        r = run(root)
        check("reports 2 entries", "Scanned 2 memory entrie(s)" in r.stdout, r.stdout)
        check("excludes the MEMORY.md index", "MEMORY.md" not in r.stdout, r.stdout)


def test_zero_entries_is_a_failure() -> None:
    """AC3, second half: a pass over zero files is not a clean bill."""
    tmp, root, memory = case("AC3: an empty corpus fails rather than passing")
    with tmp:
        r = run(root)
        check("exit code is 2", r.returncode == 2, f"got {r.returncode}")
        check("reports 0 entries", "Scanned 0 memory entrie(s)" in r.stdout, r.stdout)
        check("says zero is not a clean bill", "not a clean bill" in r.stderr, r.stderr)


def test_missing_directory_is_a_failure() -> None:
    """The degenerate case one step further out: no corpus directory at all."""
    print("\nA missing memory directory fails the same way")
    with tempfile.TemporaryDirectory() as tmp:
        r = run(Path(tmp))
        check("exit code is 2", r.returncode == 2, f"got {r.returncode}")


def test_warn_only_softens_drift_but_not_emptiness() -> None:
    """--warn-only is why `main` can stay green; its limit is the point."""
    tmp, root, memory = case("--warn-only downgrades drift but never emptiness")
    with tmp:
        write_entry(memory, "stale-claim", volatility="high", last_verified="2026-05-06")
        r = run(root, "--warn-only")
        check("overdue entry no longer fails", r.returncode == 0, f"got {r.returncode}")
        check("but is still named", "stale-claim.md" in r.stdout, r.stdout)
        check("and still labelled OVERDUE", "OVERDUE" in r.stdout, r.stdout)

    # Same flag, empty corpus: must still fail.
    with tempfile.TemporaryDirectory() as tmp2:
        empty = Path(tmp2)
        (empty / ".claude" / "memory").mkdir(parents=True)
        r = run(empty, "--warn-only")
        check("zero entries still exits 2 under --warn-only", r.returncode == 2, f"got {r.returncode}")


def test_warning_tier_does_not_fail() -> None:
    """Between the warning and overdue budgets: reported, not fatal."""
    tmp, root, memory = case("A warning-tier entry is reported but passes")
    with tmp:
        # moderate: warning at 120d, overdue at 180d. 2026-04-19 is 139d back.
        write_entry(memory, "aging", volatility="moderate", last_verified="2026-04-19")
        r = run(root)
        check("exit code is 0", r.returncode == 0, f"got {r.returncode}: {r.stderr}")
        check("labelled WARNING", "WARNING" in r.stdout, r.stdout)
        check("named", "aging.md" in r.stdout, r.stdout)


def test_budget_boundary_is_exclusive() -> None:
    """Exactly at the budget is not yet overdue; one day past it is."""
    tmp, root, memory = case("The overdue budget is an exclusive boundary")
    with tmp:
        # high overdue budget is 90d. 2026-06-07 is exactly 90d before TODAY.
        write_entry(memory, "exactly-at-budget", volatility="high", last_verified="2026-06-07")
        r = run(root)
        check("90d does not fail", r.returncode == 0, f"got {r.returncode}: {r.stdout}")

    tmp, root, memory = case("One day past the budget is overdue")
    with tmp:
        write_entry(memory, "one-day-over", volatility="high", last_verified="2026-06-06")
        r = run(root)
        check("91d fails", r.returncode == 1, f"got {r.returncode}: {r.stdout}")


def test_invalid_frontmatter_fails() -> None:
    """Frontmatter that cannot be graded must not slip through as passing."""
    variants = [
        ("no frontmatter at all", dict(frontmatter=False), "no frontmatter"),
        ("missing volatility", dict(volatility=None), "missing frontmatter field"),
        ("missing last-verified", dict(last_verified=None), "missing frontmatter field"),
        ("missing verification", dict(verification=None), "missing frontmatter field"),
        ("unknown volatility", dict(volatility="glacial"), "not one of"),
        ("unparseable date", dict(last_verified="last tuesday"), "not an ISO date"),
        ("future date", dict(last_verified="2027-01-01"), "in the future"),
    ]
    for label, kwargs, expected in variants:
        tmp, root, memory = case(f"Invalid frontmatter fails: {label}")
        with tmp:
            write_entry(memory, "broken", **kwargs)
            r = run(root)
            check("exit code is 1", r.returncode == 1, f"got {r.returncode}: {r.stdout}")
            check("labelled INVALID", "INVALID" in r.stdout, r.stdout)
            check(f"explains: {expected}", expected in r.stdout, r.stdout)


def test_annotation_level_tracks_fatality() -> None:
    """A green job must not carry red annotations, and vice versa."""
    tmp, root, memory = case("Annotations are emitted only under GitHub Actions")
    with tmp:
        write_entry(memory, "stale-claim", volatility="high", last_verified="2026-05-06")
        r = run(root)
        check("no annotations outside Actions", "::" not in r.stdout, r.stdout)

    tmp, root, memory = case("Strict mode annotates an overdue entry as an error")
    with tmp:
        write_entry(memory, "stale-claim", volatility="high", last_verified="2026-05-06")
        r = run(root, actions=True)
        check("emits ::error", "::error file=" in r.stdout, r.stdout)
        check("names the file in the annotation", "stale-claim.md::" in r.stdout, r.stdout)

    tmp, root, memory = case("--warn-only downgrades that annotation to a warning")
    with tmp:
        write_entry(memory, "stale-claim", volatility="high", last_verified="2026-05-06")
        r = run(root, "--warn-only", actions=True)
        check("emits no ::error on a passing job", "::error file=" not in r.stdout, r.stdout)
        check("still emits ::warning", "::warning file=" in r.stdout, r.stdout)
        check("annotation still says overdue", "overdue" in r.stdout, r.stdout)

    # Ungradeable frontmatter fails in both modes, so unlike the overdue
    # annotation above this one must NOT soften under the flag -- a soft
    # annotation on a run that fails anyway misreports which finding stopped
    # the build.
    tmp, root, memory = case("An ungradeable entry annotates as an error even under --warn-only")
    with tmp:
        write_entry(memory, "ungradeable", frontmatter=False)
        r = run(root, "--warn-only", actions=True)
        check("emits ::error", "::error file=" in r.stdout, r.stdout)
        check("names the file", "ungradeable.md::" in r.stdout, r.stdout)
        check("not downgraded to a warning", "::warning file=" not in r.stdout, r.stdout)


def test_usage_error_on_bad_today() -> None:
    print("\nA malformed --today is a usage error, not a pass")
    tmp, root, memory = case("  (with a valid corpus, so only --today is wrong)")
    with tmp:
        write_entry(memory, "fine")
        r = run(root, today="nonsense")
        check("exit code is 3", r.returncode == 3, f"got {r.returncode}")


def test_warn_only_never_forgives_ungradeable_frontmatter() -> None:
    print("\n--warn-only forgives drift but never ungradeable frontmatter")
    tmp, root, memory = case("  (one overdue entry and one unparseable one)")
    with tmp:
        write_entry(memory, "just-drifted", last_verified="2026-01-01")
        write_entry(memory, "ungradeable", frontmatter=False)
        r = run(root, "--warn-only")
        check("still exits 1", r.returncode == 1, f"got {r.returncode}")
        check("names the ungradeable entry", "ungradeable.md" in r.stdout, r.stdout)
        check("says the flag does not forgive it", "does not forgive" in r.stderr, r.stderr)

    tmp, root, memory = case("  (drift alone is still forgiven)")
    with tmp:
        write_entry(memory, "just-drifted", last_verified="2026-01-01")
        r = run(root, "--warn-only")
        check("exits 0 on drift alone", r.returncode == 0, f"got {r.returncode}: {r.stderr}")


def test_entries_in_subdirectories_are_scanned() -> None:
    print("\nAn entry filed in a subdirectory is still graded")
    tmp, root, memory = case("  (one current entry, one overdue a level down)")
    with tmp:
        write_entry(memory, "top-level")
        nested = memory / "archive"
        nested.mkdir()
        write_entry(nested, "buried-and-overdue", last_verified="2026-01-01")
        r = run(root)
        check("counts both entries", "Scanned 2 " in r.stdout, r.stdout)
        check("exit code is 1", r.returncode == 1, f"got {r.returncode}")
        check(
            "names the buried entry",
            "buried-and-overdue.md" in r.stdout,
            r.stdout,
        )


def test_real_corpus_is_scanned() -> None:
    """Guards against the checker silently finding nothing in this repository.

    Deliberately runs against the REAL today rather than the fixture clock.
    `TODAY` is frozen so the synthetic fixtures below have deterministic ages;
    pinning the live corpus to it as well would mean that re-verifying any
    entry -- setting `last-verified` to the date a walk actually happened,
    which is exactly what CONTRIBUTING.md instructs and what issue #912
    requires before the CI flag can be dropped -- reports that entry as
    having a `last-verified` in the future, and reds this suite for doing
    the one thing this checker exists to encourage.
    """
    print("\nThe repository's own corpus is non-empty and parseable")
    repo_root = CHECKER.resolve().parent.parent
    r = run(repo_root, "--warn-only", today=None)
    check("scans a non-empty corpus", "Scanned 0 " not in r.stdout, r.stdout)
    check("no INVALID entries in-tree", "INVALID" not in r.stdout, r.stdout)
    check("exits 0 under --warn-only", r.returncode == 0, f"got {r.returncode}: {r.stderr}")


def main() -> int:
    tests = (
        test_overdue_fails_and_names_the_file,
        test_all_within_budget_passes,
        test_reports_scanned_count,
        test_zero_entries_is_a_failure,
        test_missing_directory_is_a_failure,
        test_warn_only_softens_drift_but_not_emptiness,
        test_warning_tier_does_not_fail,
        test_budget_boundary_is_exclusive,
        test_invalid_frontmatter_fails,
        test_annotation_level_tracks_fatality,
        test_usage_error_on_bad_today,
        test_warn_only_never_forgives_ungradeable_frontmatter,
        test_entries_in_subdirectories_are_scanned,
        test_real_corpus_is_scanned,
    )
    for test in tests:
        test()

    # Hold this suite to the discipline it enforces on the corpus: report the
    # cardinality of what ran, and treat zero as a failure rather than a clean
    # bill. Without it, a test dropped from the tuple above -- or a `check()`
    # that stops being reached -- leaves no trace behind `All checks passed.`
    print()
    print(f"Ran {len(tests)} test(s), {checks_run} check(s).")
    if not tests or not checks_run:
        print("error: nothing was executed -- that is not a pass.", file=sys.stderr)
        return 2

    if failures:
        print(f"{len(failures)} check(s) failed:")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("All checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

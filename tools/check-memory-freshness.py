#!/usr/bin/env python3

# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (C) 2026 Oleksii PELYKH

"""Check the freshness frontmatter on every entry in `.claude/memory/`.

Each memory entry declares how fast its claim rots and when it was last checked
against reality:

    volatility: high | moderate | stable
    last-verified: YYYY-MM-DD
    verification: empirical-walk

Without something reading those fields they are ceremony, so this script reads
all three and fails when an entry has drifted past its re-verification budget.

Budgets, in days since `last-verified`:

    high      warning >  60   overdue >  90
    moderate  warning > 120   overdue > 180
    stable    warning > 270   overdue > 365

Deliberately NOT implemented: the severity modifiers that a fuller currency
sweeper applies on top of these budgets (for example, treating a high-volatility
claim more harshly when it was never empirically walked). Those are policy this
repository has never published, so this checker keeps to the budgets above --
which the drift table in issue #843 reproduces exactly -- and requires
`verification` to be present without grading its value.

Exit codes:

    0  every entry within budget (warnings are reported, not fatal)
    1  at least one entry overdue or carrying invalid frontmatter
    2  nothing scanned -- a pass over zero files is not a clean bill
    3  usage error

`--warn-only` downgrades 1 to 0 so drift is reported without breaking the build.
It deliberately does NOT downgrade 2: an empty or missing corpus means the check
never looked at anything, which is a broken check rather than tolerable drift.
"""

from __future__ import annotations

import argparse
import os
import sys
from datetime import date
from pathlib import Path

# Days since `last-verified` at which an entry becomes stale, per volatility
# class. `warning` is advisory; passing `overdue` is what fails the check.
BUDGETS = {
    "high": {"warning": 60, "overdue": 90},
    "moderate": {"warning": 120, "overdue": 180},
    "stable": {"warning": 270, "overdue": 365},
}

# Every field the memory convention requires an entry to declare.
REQUIRED_FIELDS = ("volatility", "last-verified", "verification")

# The corpus index. It lists the entries rather than making a claim of its own,
# so it carries no freshness frontmatter and is not counted as scanned.
INDEX_FILENAME = "MEMORY.md"

MEMORY_DIR = Path(".claude") / "memory"


def parse_frontmatter(text: str) -> dict[str, str] | None:
    """Return the leading `---` fenced block as a dict, or None if absent.

    Deliberately not a YAML parser: the frontmatter this reads is flat
    `key: value` scalars, and a stdlib-only checker is worth more here than
    full YAML support that would pull in a dependency this repository
    otherwise has no use for.
    """
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return None
    fields: dict[str, str] = {}
    for line in lines[1:]:
        if line.strip() == "---":
            return fields
        key, sep, value = line.partition(":")
        if sep and not key.startswith((" ", "\t")):
            fields[key.strip()] = value.strip()
    # Unterminated fence: the file opened frontmatter and never closed it.
    return None


def classify(fields: dict[str, str] | None, today: date) -> tuple[str, str]:
    """Grade one entry's frontmatter, returning (severity, human detail).

    Severity is one of `invalid`, `overdue`, `warning`, `current`.
    """
    if fields is None:
        return "invalid", "no frontmatter block"

    missing = [f for f in REQUIRED_FIELDS if not fields.get(f)]
    if missing:
        return "invalid", f"missing frontmatter field(s): {', '.join(missing)}"

    volatility = fields["volatility"]
    if volatility not in BUDGETS:
        return "invalid", (
            f"volatility {volatility!r} is not one of "
            f"{', '.join(sorted(BUDGETS))}"
        )

    raw_date = fields["last-verified"]
    try:
        last_verified = date.fromisoformat(raw_date)
    except ValueError:
        return "invalid", f"last-verified {raw_date!r} is not an ISO date"

    age = (today - last_verified).days
    if age < 0:
        # A future date yields a negative age that would sail under every
        # budget -- a clean, wrong pass. Refuse it instead.
        return "invalid", f"last-verified {raw_date} is in the future"

    budget = BUDGETS[volatility]
    detail = f"{volatility}, verified {raw_date}, {age}d old"
    if age > budget["overdue"]:
        return "overdue", f"{detail} (budget {budget['overdue']}d)"
    if age > budget["warning"]:
        return "warning", f"{detail} (warning at {budget['warning']}d)"
    return "current", detail


def annotate(fatal: bool, path: Path, message: str) -> None:
    """Emit a GitHub Actions annotation so drift is visible on the PR itself.

    Without this, a `--warn-only` job is a green tick nobody reads.

    The annotation level tracks whether the finding actually fails this run, so
    a green job never carries red annotations -- that combination teaches
    readers to ignore the red.
    """
    if os.environ.get("GITHUB_ACTIONS") == "true":
        print(f"::{'error' if fatal else 'warning'} file={path.as_posix()}::{message}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Check freshness frontmatter on .claude/memory/ entries."
    )
    parser.add_argument(
        "--root",
        type=Path,
        default=Path("."),
        help="repository root to scan (default: current directory)",
    )
    parser.add_argument(
        "--today",
        default=None,
        help="ISO date to measure ages against (default: today)",
    )
    parser.add_argument(
        "--warn-only",
        action="store_true",
        help=(
            "report overdue and invalid entries without failing; does not "
            "suppress the zero-entries-scanned failure"
        ),
    )
    args = parser.parse_args(argv)

    if args.today is None:
        today = date.today()
    else:
        try:
            today = date.fromisoformat(args.today)
        except ValueError:
            print(f"error: --today {args.today!r} is not an ISO date", file=sys.stderr)
            return 3

    memory_dir = args.root / MEMORY_DIR
    entries = sorted(
        p for p in memory_dir.glob("*.md") if p.name != INDEX_FILENAME
    ) if memory_dir.is_dir() else []

    overdue: list[str] = []
    invalid: list[str] = []
    warnings: list[str] = []

    for path in entries:
        rel = path.relative_to(args.root)
        severity, detail = classify(
            parse_frontmatter(path.read_text(encoding="utf-8")), today
        )
        line = f"{rel}: {detail}"
        if severity == "overdue":
            overdue.append(line)
            annotate(not args.warn_only, rel, f"memory entry overdue: {detail}")
        elif severity == "invalid":
            invalid.append(line)
            annotate(not args.warn_only, rel, f"invalid memory frontmatter: {detail}")
        elif severity == "warning":
            warnings.append(line)
            annotate(False, rel, f"memory entry nearing its budget: {detail}")

    # Report the cardinality of what was evaluated, always. A gate that passes
    # without saying how much it looked at cannot be told apart from one that
    # looked at nothing.
    print(f"Scanned {len(entries)} memory entrie(s) in {memory_dir} as of {today}.")

    for label, items in (
        ("INVALID", invalid),
        ("OVERDUE", overdue),
        ("WARNING", warnings),
    ):
        for item in items:
            print(f"  {label}: {item}")

    if not entries:
        print(
            f"error: no memory entries found under {memory_dir} -- a pass over "
            "zero files is not a clean bill",
            file=sys.stderr,
        )
        return 2

    failures = len(overdue) + len(invalid)
    if failures:
        if args.warn_only:
            print(
                f"{failures} entrie(s) need re-verification; not failing the "
                "build (--warn-only)."
            )
            return 0
        print(f"error: {failures} entrie(s) need re-verification.", file=sys.stderr)
        return 1

    print(f"All {len(entries)} memory entrie(s) within budget.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

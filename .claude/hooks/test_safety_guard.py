"""safety_guard 허용·거부 표. 실행: python3 -m unittest discover -s .claude/hooks"""

from __future__ import annotations

import json
import subprocess
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from safety_guard import check  # noqa: E402

HOOK = Path(__file__).resolve().parent / "safety_guard.py"


def on(branch):
    return lambda _cwd: branch


def rules(command: str, branch: str = "feature/issue-1-x") -> list[str]:
    return [v.rule for v in check(command, "/tmp", branch_of=on(branch))]


class Blocked(unittest.TestCase):
    CASES = [
        ("git push origin main", "W-1"),
        ("git push origin HEAD:main", "W-1"),
        ("git push origin feature/x:refs/heads/main", "W-1"),
        ("git push --force origin dev", "W-2"),
        ("git push -f", "W-2"),
        ("git push origin +dev", "W-2"),
        ("git push origin --delete feature/x", "W-2"),
        ("git push origin --tags", "W-3"),
        ("gh pr merge 12 --squash", "W-4"),
        ("cd packages/core && pnpm exec prisma migrate reset --force", "S-3"),
        ("npx prisma db push --force-reset", "S-3"),
        ("pnpm --filter @mytangerine/core exec prisma db push --accept-data-loss", "S-3"),
        ("DATABASE_URL=x npx prisma migrate reset", "S-3"),
        ("node scripts/add-sync-columns.js", "S-2"),
        ("node ./scripts/check-and-add-columns.js", "S-2"),
        ("cat .env", "S-1"),
        ("head -5 packages/api/.env", "S-1"),
        ("cat credentials.json | jq .", "S-1"),
        ("psql mytangerine -c 'DELETE FROM orders'", "S-3"),
        ("psql -c \"drop database mytangerine\"", "S-3"),
        ("dropdb mytangerine", "S-3"),
    ]

    def test_blocked(self):
        for cmd, rule in self.CASES:
            with self.subTest(cmd=cmd):
                self.assertIn(rule, rules(cmd))

    def test_commit_on_main(self):
        self.assertIn("W-1", rules("git commit -m 'x'", branch="main"))


class Allowed(unittest.TestCase):
    CASES = [
        "git push -u origin feature/issue-170-harness",
        "git push origin dev",
        "git push origin v1.2.0",
        "git commit -m 'feat: x'",
        "gh pr create --base dev --title t --body b",
        "gh pr view 12",
        "pnpm --filter @mytangerine/core exec prisma migrate dev",
        "npx prisma generate",
        "node scripts/check-headers.js",
        "sed 's/=.*/=<redacted>/' .env",
        "cat .env.example",
        "cat credentials.json.example",
        "psql mytangerine -c 'select count(*) from orders'",
        "git log --oneline -5 | head",
        "git commit -F - <<'EOF'\nfix: x\n\ngit push origin main\nEOF",
    ]

    def test_allowed(self):
        for cmd in self.CASES:
            with self.subTest(cmd=cmd):
                self.assertEqual([], rules(cmd))

    def test_commit_on_dev_allowed_by_hook(self):
        # dev 직접 커밋은 workflow 상 피하지만(PR 경유), 머지 동기화(main→dev) 커밋이 있어 훅은 막지 않는다
        self.assertEqual([], rules("git commit -m 'merge'", branch="dev"))


class Protocol(unittest.TestCase):
    def run_hook(self, payload: dict) -> subprocess.CompletedProcess:
        return subprocess.run([sys.executable, str(HOOK)], input=json.dumps(payload),
                              capture_output=True, text=True, check=False)

    def test_block_exit_2(self):
        res = self.run_hook({"tool_name": "Bash", "tool_input": {"command": "gh pr merge 1"}, "cwd": "/tmp"})
        self.assertEqual(2, res.returncode)
        self.assertIn("W-4", res.stderr)

    def test_pass_exit_0(self):
        res = self.run_hook({"tool_name": "Bash", "tool_input": {"command": "ls"}, "cwd": "/tmp"})
        self.assertEqual(0, res.returncode)

    def test_other_tool_ignored(self):
        res = self.run_hook({"tool_name": "Read", "tool_input": {"file_path": ".env"}})
        self.assertEqual(0, res.returncode)

    def test_bad_json_nonblocking(self):
        res = subprocess.run([sys.executable, str(HOOK)], input="{", capture_output=True, text=True, check=False)
        self.assertEqual(1, res.returncode)


if __name__ == "__main__":
    unittest.main()

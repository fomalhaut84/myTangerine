#!/usr/bin/env python3
"""safety_guard — Bash 명령이 myTangerine 안전 규칙을 어기면 막는 PreToolUse 훅.

정본은 .claude/rules/data-safety.md 와 .claude/rules/workflow.md 다. 이 훅은 **실수 방지**이지 룰의 대체가 아니다 —
텍스트 매칭이라 변수 치환 · eval · 스크립트 파일 안의 명령은 보지 못한다. 막히면 우회하지 말고 사용자에게 묻는다.

규약 (Claude Code hooks): stdin 으로 {"tool_name", "tool_input": {"command"}, "cwd"} JSON 을 받는다.
exit 0 = 통과 · exit 2 = 차단(stderr 가 Claude 에게 간다).
표준 라이브러리만 쓴다. 테스트: python3 -m unittest discover -s .claude/hooks
"""

from __future__ import annotations

import json
import re
import shlex
import subprocess
import sys
from dataclasses import dataclass

RULE_FILE = ".claude/rules/data-safety.md"
PROTECTED_BRANCHES = ("main", "dev")
SECRET_FILES = re.compile(r"(?:^|/)(?:\.env(?:\.local|\.production)?|credentials\.json)$")
SECRET_READERS = {"cat", "less", "more", "head", "tail", "bat", "nl", "strings", "xxd", "od"}
# 실제 구글 시트의 구조(헤더·컬럼)를 바꾸는 루트 스크립트 — 사용자가 직접 실행한다 (S-2)
SHEET_MUTATORS = re.compile(r"(?:^|/)scripts/(?:add-sync-columns|check-and-add-columns)\.js$")
DESTRUCTIVE_SQL = re.compile(r"\b(?:drop\s+(?:database|table|schema)|truncate\b|delete\s+from)\b", re.IGNORECASE)
SEPARATORS = re.compile(r"\s*(?:&&|\|\||;|\||\n)\s*")
OPERATOR_CHARS = "();<>|&\n"
ENV_ASSIGN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*=")
WRAPPERS = {"sudo", "command", "exec", "nohup", "time", "env", "npx", "pnpm", "dotenv"}


@dataclass(frozen=True)
class Violation:
    rule: str
    reason: str


def _shell_tokens(body: str) -> list[str]:
    """따옴표를 인식해 토큰화한다 — 연산자(; && || | & ( ) 줄바꿈)는 따옴표 밖에 있을 때만 별도 토큰이 된다.

    회귀: PR #193 Codex P2 — 먼저 연산자로 자르면 `git commit -m 'a; git push origin main'` 의 메시지가 명령으로 읽혔다.
    """
    lexer = shlex.shlex(body, posix=True, punctuation_chars=OPERATOR_CHARS)
    lexer.whitespace = " \t\r"
    lexer.whitespace_split = True
    lexer.commenters = "#"
    return list(lexer)


def _segments(command: str) -> list[list[str]]:
    """명령을 따옴표 밖의 연산자로 자르고 각 조각을 토큰 목록으로 돌려준다. heredoc 본문은 데이터라 버린다."""
    body = re.sub(r"<<-?\s*(['\"]?)(\w+)\1.*?^\2$", "", command, flags=re.DOTALL | re.MULTILINE)
    try:
        tokens = _shell_tokens(body)
    except ValueError:
        # 따옴표가 닫히지 않으면 셸도 실행하지 못한다 — 보수적으로 예전 방식(연산자 우선 분할)으로 검사한다
        tokens = []
        for part in SEPARATORS.split(body):
            tokens += part.split() + [";"]
    out: list[list[str]] = []
    current: list[str] = []
    for tok in tokens + [";"]:
        if tok and set(tok) <= set(OPERATOR_CHARS) - set("<>"):
            while current and ENV_ASSIGN.match(current[0]):
                current = current[1:]
            if current:
                out.append(current)
            current = []
        else:
            current.append(tok)
    return out


def _strip_wrappers(tokens: list[str]) -> list[str]:
    """`sudo git …` · `pnpm exec prisma …` · `npx prisma …` 같은 래퍼를 벗긴다."""
    rest = list(tokens)
    while rest and rest[0] in WRAPPERS:
        head = rest.pop(0)
        if head == "pnpm":
            # pnpm --filter X exec prisma … / pnpm dlx prisma … / pnpm prisma …
            while rest and rest[0].startswith("-"):
                flag = rest.pop(0)
                if flag in {"--filter", "-F", "-C", "--dir"} and rest:
                    rest.pop(0)
            if rest and rest[0] in {"exec", "dlx"}:
                rest.pop(0)
        while rest and (rest[0].startswith("-") or ENV_ASSIGN.match(rest[0])):
            rest.pop(0)
    return rest


def _current_branch(cwd: str | None) -> str | None:
    try:
        res = subprocess.run(
            ["git", "branch", "--show-current"], cwd=cwd or None,
            capture_output=True, text=True, timeout=5, check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    return res.stdout.strip() or None


def _check_git(args: list[str], cwd: str | None, branch_of=_current_branch) -> list[Violation]:
    while args and args[0] in {"-C", "-c"} and len(args) > 1:
        if args[0] == "-C":
            cwd = args[1]
        args = args[2:]
    if not args:
        return []
    sub, rest = args[0], args[1:]
    found: list[Violation] = []
    if sub == "commit" and branch_of(cwd) == "main":
        found.append(Violation("W-1", "main 브랜치 직접 커밋 금지 — feature/* 또는 hotfix/* 브랜치에서 커밋한다"))
    if sub == "push":
        found += _check_push(rest, cwd, branch_of)
    return found


def _push_targets(refspecs: list[str], cwd: str | None, branch_of) -> set[str] | None:
    """push 가 갱신할 원격 브랜치 이름들. 판정할 수 없으면 None.

    refspec 을 생략하거나 HEAD 를 쓰면 현재 브랜치가 대상이다(push.default=simple · 같은 이름 upstream).
    회귀: PR #193 Codex P2 — main 에서 `git push` · `git push origin` · `git push origin HEAD` 가 W-1 을 통과했다.
    """
    current = branch_of(cwd)
    if not refspecs:
        return {current} if current else None
    targets: set[str] = set()
    for spec in refspecs:
        spec = spec.lstrip("+")
        dst = spec.split(":")[-1] if ":" in spec else spec
        dst = dst.removeprefix("refs/heads/")
        if dst == "HEAD":
            if not current:
                return None
            dst = current
        targets.add(dst)
    return targets


def _check_push(rest: list[str], cwd: str | None, branch_of) -> list[Violation]:
    found: list[Violation] = []
    refs = [r for r in rest if not r.startswith("-")]
    refspecs = refs[1:]
    if "--delete" in rest or "--mirror" in rest or any(r.startswith(":") for r in refspecs):
        return [Violation("W-2", "원격 브랜치 삭제·mirror push 금지 — 사용자가 직접 한다")]
    if "--tags" in rest or "--follow-tags" in rest:
        found.append(Violation("W-3", "태그 일괄 push 금지 — `git push origin vX.Y.Z` 로 하나만 올린다"))
    if "--all" in rest:
        return found + [Violation("W-1", "--all push 금지 — main 을 포함한다. 브랜치를 명시한다")]
    targets = _push_targets(refspecs, cwd, branch_of)
    forced = any(r in {"-f", "--force"} or r.startswith("--force") for r in rest) \
        or any(r.startswith("+") for r in refspecs)
    if targets is None:
        found.append(Violation("W-1", "push 대상 브랜치를 판정할 수 없다(detached HEAD 등) — `git push origin <branch>` 로 명시한다"))
        return found
    if "main" in targets:
        found.append(Violation("W-1", "main 으로 직접 push 금지 — main 은 PR 머지로만 바뀐다"))
    if forced and targets & set(PROTECTED_BRANCHES):
        found.append(Violation("W-2", "보호 브랜치(main·dev) force push 금지"))
    return found


def _check_gh(args: list[str]) -> list[Violation]:
    if len(args) >= 2 and args[0] == "pr" and args[1] == "merge":
        return [Violation("W-4", "PR 머지는 사용자가 직접 한다 — Claude 는 PR 생성까지만")]
    if len(args) >= 2 and args[0] == "release" and args[1] == "delete":
        return [Violation("W-3", "릴리즈 삭제는 사용자가 직접 한다")]
    if len(args) >= 2 and args[0] == "repo" and args[1] in {"delete", "edit", "rename"}:
        return [Violation("W-4", "저장소 설정 변경은 사용자가 직접 한다")]
    return []


def _check_prisma(args: list[str]) -> list[Violation]:
    joined = " ".join(args)
    if re.search(r"\bmigrate\s+reset\b", joined):
        return [Violation("S-3", "prisma migrate reset 금지 — DB 전체를 지운다(시트에서 동기화된 실주문 포함)")]
    if "--force-reset" in args or "--accept-data-loss" in args:
        return [Violation("S-3", "데이터 손실 플래그(--force-reset·--accept-data-loss) 금지")]
    if re.search(r"\bdb\s+execute\b", joined):
        return [Violation("S-3", "prisma db execute 는 임의 SQL 실행 — 사용자 확인 후 직접 실행")]
    return []


def _check_segment(tokens: list[str], cwd: str | None, branch_of=_current_branch) -> list[Violation]:
    cmd = _strip_wrappers(tokens)
    if not cmd:
        return []
    name, args = cmd[0].rsplit("/", 1)[-1], cmd[1:]
    found: list[Violation] = []
    if name == "git":
        found += _check_git(args, cwd, branch_of)
    elif name == "gh":
        found += _check_gh(args)
    elif name == "prisma":
        found += _check_prisma(args)
    elif name in {"node", "tsx", "ts-node"} and args and SHEET_MUTATORS.search(args[0]):
        found.append(Violation("S-2", "실제 구글 시트 구조를 바꾸는 스크립트 — 사용자가 직접 실행한다"))
    elif name in SECRET_READERS and any(SECRET_FILES.search(a) for a in args if not a.startswith("-")):
        found.append(Violation("S-1", "비밀 파일(.env·credentials.json) 내용 출력 금지 — 키 이름만 필요하면 `sed 's/=.*/=<redacted>/' .env`"))
    elif name == "psql" and DESTRUCTIVE_SQL.search(" ".join(args)):
        found.append(Violation("S-3", "psql 파괴적 SQL(DROP·TRUNCATE·DELETE) 금지 — 사용자 확인 후 직접 실행"))
    elif name in {"dropdb"}:
        found.append(Violation("S-3", "dropdb 금지 — 사용자 확인 후 직접 실행"))
    return found


def check(command: str, cwd: str | None, branch_of=_current_branch) -> list[Violation]:
    found: list[Violation] = []
    for seg in _segments(command):
        found += _check_segment(seg, cwd, branch_of)
    return found


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError) as exc:
        print(f"safety_guard: 입력 JSON 파싱 실패({exc}) — 검사하지 않았다. {RULE_FILE} 를 직접 지킨다", file=sys.stderr)
        return 1
    if payload.get("tool_name") != "Bash":
        return 0
    command = (payload.get("tool_input") or {}).get("command") or ""
    violations = check(command, payload.get("cwd"))
    if not violations:
        return 0
    lines = [f"safety_guard 차단 ({RULE_FILE}):"]
    lines += [f"  [{v.rule}] {v.reason}" for v in violations]
    lines.append("우회하지 말고, 필요하면 사용자에게 직접 실행을 요청한다.")
    print("\n".join(lines), file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())

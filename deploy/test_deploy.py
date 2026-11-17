"""deploy/ 스크립트 시험 (#201). 실행: python3 -m unittest discover -s deploy

실제 서버·pm2·pnpm 은 부르지 않는다 — 임시 git 저장소(bare origin + 체크아웃)와 PATH 앞의 가짜 명령(stub)으로 돌린다.
"""

from __future__ import annotations

import os
import shutil
import stat
import subprocess
import tempfile
import textwrap
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
RELEASE = HERE / "release-inplace.sh"
SSH_DEPLOY = HERE / "ssh-deploy.sh"

STUBS = {
    # pnpm: STUB_PNPM_FAIL 에 적힌 패키지 빌드(또는 "install")만 실패한다 — STUB_FAIL_TAG 가 있으면 그 태그를 빌드할 때만
    "pnpm": """#!/usr/bin/env bash
        echo "pnpm $*" >> "$STUB_CALLS"
        if [[ -n "${STUB_FAIL_TAG:-}" && "$(git describe --tags --exact-match HEAD 2>/dev/null)" != "$STUB_FAIL_TAG" ]]; then exit 0; fi
        if [[ "$1" == install && "${STUB_PNPM_FAIL:-}" == install ]]; then exit 1; fi
        if [[ "$1" == --filter && "$2" == "@mytangerine/${STUB_PNPM_FAIL:-none}" && "$3" == build ]]; then exit 1; fi
        exit 0
    """,
    # pm2: jlist 앞에 경고 줄을 섞는다(실제 pm2 처럼). STUB_CRASHLOOP=1 이면 jlist 마다 웹의 재시작 횟수가 는다
    "pm2": """#!/usr/bin/env bash
        echo "pm2 $*" >> "$STUB_CALLS"
        if [[ "$1" == jlist ]]; then
          if [[ "${STUB_PM2_GARBAGE:-}" == 1 ]]; then echo "not json"; exit 0; fi
          n=$(cat "$STUB_CALLS.n" 2>/dev/null || echo 0); n=$((n + 1)); echo "$n" > "$STUB_CALLS.n"
          web_restarts=3; [[ "${STUB_CRASHLOOP:-}" == 1 ]] && web_restarts=$n
          echo ">>>> In-memory PM2 is out-of-date"
          echo '[{"name":"myTangerineApi","pm2_env":{"status":"online","restart_time":1,"SECRET":"x"}},
                 {"name":"myTangerineSync","pm2_env":{"status":"online","restart_time":0}},
                 {"name":"myTangerineWeb","pm2_env":{"status":"'"${STUB_WEB_STATUS:-online}"'","restart_time":'"$web_restarts"'}}]'
        fi
        exit 0
    """,
    "curl": """#!/usr/bin/env bash
        printf '%s' "${STUB_HTTP:-200}"
    """,
}


def sh(*args: str, cwd: Path | None = None) -> str:
    return subprocess.run(args, cwd=cwd, check=True, capture_output=True, text=True).stdout.strip()


GIT_ID = ("-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "tag.gpgSign=false", "-c", "commit.gpgSign=false")


class Sandbox:
    """bare origin + 서버 체크아웃 + stub PATH.

    태그: v1.0.0 → v1.1.0 → v1.2.0(마이그레이션) 는 main 위. v1.3.0 은 main 에 없는 브랜치 커밋.
    체크아웃은 v1.0.0 에서 시작한다.
    """

    def __init__(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="deploy-test-"))
        self.home = self.tmp / "home" / "svc"
        self.home.mkdir(parents=True)
        self.bin = self.tmp / "bin"
        self.bin.mkdir()
        self.calls = self.tmp / "calls.log"
        self.calls.touch()
        self.priv = self.tmp / "private"
        for name, body in STUBS.items():
            path = self.bin / name
            path.write_text(textwrap.dedent(body).lstrip())
            path.chmod(path.stat().st_mode | stat.S_IEXEC)
        self.origin = self.tmp / "origin.git"
        self.work = self.home / "myTangerine"
        self._make_repo()

    def _git(self, *args: str, cwd: Path) -> str:
        return sh("git", *GIT_ID, *args, cwd=cwd)

    def _commit_tag(self, seed: Path, tag: str) -> None:
        self._git("add", "-A", cwd=seed)
        self._git("commit", "-qm", tag, cwd=seed)
        self._git("tag", "-a", tag, "-m", tag, cwd=seed)

    def _make_repo(self) -> None:
        seed = self.tmp / "seed"
        (seed / "deploy").mkdir(parents=True)
        (seed / "prisma").mkdir()
        shutil.copy(RELEASE, seed / "deploy" / "release-inplace.sh")
        shutil.copy(SSH_DEPLOY, seed / "deploy" / "ssh-deploy.sh")
        (seed / "prisma" / "schema.prisma").write_text("model A {}\n")
        (seed / "app.txt").write_text("1\n")
        self._git("init", "-q", "-b", "main", cwd=seed)
        self._commit_tag(seed, "v1.0.0")
        (seed / "app.txt").write_text("2\n")
        self._commit_tag(seed, "v1.1.0")
        (seed / "prisma" / "migrations").mkdir()
        (seed / "prisma" / "migrations" / "001.sql").write_text("select 1;\n")
        self._commit_tag(seed, "v1.2.0")
        self._git("checkout", "-q", "-b", "side", "v1.1.0", cwd=seed)
        (seed / "app.txt").write_text("side\n")
        self._commit_tag(seed, "v1.3.0")
        self._git("checkout", "-q", "main", cwd=seed)
        sh("git", "clone", "-q", "--bare", str(seed), str(self.origin))
        sh("git", "clone", "-q", str(self.origin), str(self.work))
        self.checkout("v1.0.0")

    def checkout(self, tag: str) -> None:
        sh("git", "-c", "advice.detachedHead=false", "checkout", "-q", tag, cwd=self.work)

    def run(self, *args: str, script: str = "release-inplace.sh", **env: str) -> subprocess.CompletedProcess:
        full_env = {
            "PATH": f"{self.bin}:/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin",
            "HOME": str(self.home),
            "MYTANGERINE_TEST": "1",
            "MYTANGERINE_LOCK": "mkdir",
            "MYTANGERINE_PRIVATE_DIR": str(self.priv),
            "MYTANGERINE_HEALTH_TIMEOUT": "3",
            "MYTANGERINE_HEALTH_INTERVAL": "1",
            "MYTANGERINE_HEALTH_STABLE": "1",
            "STUB_CALLS": str(self.calls),
            **env,
        }
        return subprocess.run(["bash", str(self.work / "deploy" / script), *args],
                              env=full_env, capture_output=True, text=True, timeout=120)

    def head_tag(self) -> str:
        return sh("git", "describe", "--tags", "--exact-match", "HEAD", cwd=self.work)

    def last_ok(self) -> str | None:
        path = self.priv / "last-ok"
        return path.read_text().strip() if path.exists() else None

    def calls_text(self) -> str:
        return self.calls.read_text()

    def close(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)


class Base(unittest.TestCase):
    def setUp(self) -> None:
        self.box = Sandbox()

    def tearDown(self) -> None:
        self.box.close()

    def assertPublicSafe(self, res: subprocess.CompletedProcess) -> None:
        out = res.stdout + res.stderr
        self.assertNotIn(str(self.box.home), out)  # 홈 경로를 가린다
        self.assertNotIn("SECRET", out)            # pm2 jlist 의 env 를 출력하지 않는다


class Usage(Base):
    def test_bad_arguments(self) -> None:
        for args in ([], ["1.2.3"], ["v1.2"], ["v1.2.3", "v1.2.4"], ["v1.2.3", "--force"], ["v1.2.3;id"]):
            with self.subTest(args=args):
                self.assertEqual(2, self.box.run(*args).returncode)

    @unittest.skipUnless(os.uname().sysname == "Darwin", "Darwin 전용 가드")
    def test_darwin_allows_dry_run_only(self) -> None:
        res = self.box.run("v1.1.0", "--yes", MYTANGERINE_TEST="0")
        self.assertEqual(2, res.returncode)
        self.assertIn("--dry-run", res.stderr)


class Checks(Base):
    def test_dry_run_passes_without_touching_checkout(self) -> None:
        res = self.box.run("v1.1.0", "--dry-run")
        self.assertEqual(0, res.returncode, res.stdout + res.stderr)
        self.assertIn("dry-run", res.stdout)
        self.assertIn("스키마·마이그레이션 변경: 0", res.stdout)
        self.assertEqual("v1.0.0", self.box.head_tag())
        self.assertEqual("", self.box.calls_text())
        self.assertPublicSafe(res)

    def test_migration_change_stops(self) -> None:
        res = self.box.run("v1.2.0", "--yes")
        self.assertEqual(1, res.returncode)
        self.assertIn("자동 배포하지 않는다", res.stdout)
        self.assertEqual("v1.0.0", self.box.head_tag())
        self.assertEqual("", self.box.calls_text())

    # 회귀: PR 사전 리뷰 major — dev·피처 커밋에 붙은 v* 태그는 배포하지 않는다
    def test_tag_not_on_main_stops(self) -> None:
        res = self.box.run("v1.3.0", "--yes")
        self.assertEqual(1, res.returncode, res.stdout)
        self.assertIn("main 에 없는 커밋", res.stdout)
        self.assertEqual("v1.0.0", self.box.head_tag())

    # 회귀: PR 사전 리뷰 major — 낮은 태그 자동 배포(다운그레이드) 금지
    def test_downgrade_stops_without_flag(self) -> None:
        self.box.checkout("v1.1.0")
        res = self.box.run("v1.0.0", "--yes")
        self.assertEqual(1, res.returncode, res.stdout)
        self.assertIn("--allow-downgrade", res.stdout)
        self.assertEqual("v1.1.0", self.box.head_tag())

    def test_downgrade_with_flag_deploys(self) -> None:
        self.box.checkout("v1.1.0")
        res = self.box.run("v1.0.0", "--yes", "--allow-downgrade")
        self.assertEqual(0, res.returncode, res.stdout)
        self.assertEqual("v1.0.0", self.box.head_tag())

    def test_dirty_tree_stops(self) -> None:
        (self.box.work / "app.txt").write_text("local edit\n")
        res = self.box.run("v1.1.0", "--yes")
        self.assertEqual(1, res.returncode)
        self.assertIn("커밋되지 않은 변경", res.stdout)

    def test_head_not_on_tag_stops(self) -> None:
        sh("git", "checkout", "-q", "main", cwd=self.box.work)
        sh("git", *GIT_ID, "commit", "-q", "--allow-empty", "-m", "untagged", cwd=self.box.work)
        res = self.box.run("v1.1.0", "--yes")
        self.assertEqual(1, res.returncode)
        self.assertIn("릴리즈 태그가 아니다", res.stdout)

    def test_unknown_tag_stops(self) -> None:
        res = self.box.run("v9.9.9", "--yes")
        self.assertEqual(1, res.returncode)
        self.assertIn("fetch 실패", res.stdout)

    def test_lock_held_stops(self) -> None:
        self.box.priv.mkdir(mode=0o700)
        (self.box.priv / "deploy.lock.d").mkdir()
        res = self.box.run("v1.1.0", "--yes")
        self.assertEqual(1, res.returncode)
        self.assertIn("진행 중", res.stdout)

    # 회귀: silent-failure major — 개인 로그 디렉터리를 못 만들면 엉뚱한 이유로 진행하지 않는다
    def test_private_dir_failure_stops_with_reason(self) -> None:
        blocker = self.box.tmp / "not-a-dir"
        blocker.write_text("x")
        res = self.box.run("v1.1.0", "--yes", MYTANGERINE_PRIVATE_DIR=str(blocker / "sub"))
        self.assertEqual(1, res.returncode, res.stdout)
        self.assertIn("개인 로그 디렉터리", res.stdout)
        self.assertEqual("", self.box.calls_text())


class SameTag(Base):
    def test_same_tag_first_check_records_last_ok(self) -> None:
        res = self.box.run("v1.0.0", "--yes")
        self.assertEqual(0, res.returncode, res.stdout)
        self.assertIn("이미 배포됨", res.stdout)
        self.assertEqual("v1.0.0", self.box.last_ok())

    def test_same_tag_dry_run_does_not_record(self) -> None:
        res = self.box.run("v1.0.0", "--dry-run")
        self.assertEqual(0, res.returncode, res.stdout)
        self.assertIsNone(self.box.last_ok())

    def test_same_tag_unhealthy_is_not_success(self) -> None:
        res = self.box.run("v1.0.0", "--yes", STUB_HTTP="503")
        self.assertEqual(4, res.returncode, res.stdout)
        self.assertIn("--retry", res.stdout)

    # 회귀: silent-failure critical · 보안 리뷰 major — rc 4 뒤 Actions 재실행이 "이미 배포됨"(rc 0)으로 덮이지 않는다
    def test_rerun_after_failed_deploy_is_not_green(self) -> None:
        self.assertEqual(0, self.box.run("v1.0.0", "--yes").returncode)  # last-ok = v1.0.0
        self.assertEqual(4, self.box.run("v1.1.0", "--yes", STUB_HTTP="503").returncode)
        self.assertEqual("v1.1.0", self.box.head_tag())
        res = self.box.run("v1.1.0", "--yes")  # 같은 태그 재실행 — 헬스는 이제 정상이어도
        self.assertEqual(4, res.returncode, res.stdout)
        self.assertIn("성공으로 끝나지 않았다", res.stdout)
        self.assertIn("재시도: deploy/release-inplace.sh v1.1.0 --yes --retry", res.stdout)


class Deploy(Base):
    def test_happy_path(self) -> None:
        res = self.box.run("v1.1.0", "--yes")
        self.assertEqual(0, res.returncode, res.stdout + res.stderr)
        self.assertIn("결과: 통과 — v1.1.0", res.stdout)
        self.assertIn("1s 동안 재시작 없음", res.stdout)
        self.assertEqual("v1.1.0", self.box.head_tag())
        calls = self.box.calls_text()
        self.assertIn("pnpm install --frozen-lockfile", calls)
        for pkg in ("core", "api", "sync-service", "web"):
            self.assertIn(f"pnpm --filter @mytangerine/{pkg} build", calls)
        self.assertIn("pm2 restart myTangerineApi myTangerineSync myTangerineWeb", calls)
        self.assertEqual("v1.1.0", self.box.last_ok())
        self.assertPublicSafe(res)

    def test_build_failure_restores_previous_tag_without_restart(self) -> None:
        res = self.box.run("v1.1.0", "--yes", STUB_PNPM_FAIL="web", STUB_FAIL_TAG="v1.1.0")
        self.assertEqual(1, res.returncode, res.stdout)
        self.assertIn("build web 실패", res.stdout)
        self.assertIn("v1.0.0 로 다시 빌드했다", res.stdout)
        self.assertEqual("v1.0.0", self.box.head_tag())
        self.assertNotIn("pm2 restart", self.box.calls_text())

    def test_build_and_restore_failure_guides_manual_steps(self) -> None:
        res = self.box.run("v1.1.0", "--yes", STUB_PNPM_FAIL="install")
        self.assertEqual(4, res.returncode, res.stdout)
        self.assertIn("복구: 실패", res.stdout)
        self.assertNotIn("pm2 restart", self.box.calls_text())
        self.assertPublicSafe(res)

    # 회귀: silent-failure major — 재시도 빌드 실패는 더 옛 태그로 내려가지 않는다
    def test_retry_build_failure_does_not_fall_back(self) -> None:
        self.box.checkout("v1.1.0")
        res = self.box.run("v1.1.0", "--yes", "--retry", STUB_PNPM_FAIL="api")
        self.assertEqual(4, res.returncode, res.stdout)
        self.assertIn("재시도라 직전 태그로 내려가지 않았다", res.stdout)
        self.assertEqual("v1.1.0", self.box.head_tag())

    def test_health_failure_guides_rollback_only(self) -> None:
        res = self.box.run("v1.1.0", "--yes", STUB_HTTP="503")
        self.assertEqual(4, res.returncode, res.stdout)
        self.assertIn("되돌리기: deploy/release-inplace.sh v1.0.0 --yes --allow-downgrade", res.stdout)
        self.assertIn("재시도: deploy/release-inplace.sh v1.1.0 --yes --retry", res.stdout)
        self.assertEqual("v1.1.0", self.box.head_tag())  # 자동 롤백하지 않는다
        self.assertIsNone(self.box.last_ok())
        self.assertPublicSafe(res)

    def test_pm2_app_not_online_fails(self) -> None:
        res = self.box.run("v1.1.0", "--yes", STUB_WEB_STATUS="errored")
        self.assertEqual(4, res.returncode, res.stdout)
        self.assertIn("online 아님: myTangerineWeb", res.stdout)

    # 회귀: silent-failure major · 보안 리뷰 info — 크래시 루프는 순간적으로 online 이어도 통과하지 않는다
    def test_crash_loop_fails(self) -> None:
        res = self.box.run("v1.1.0", "--yes", STUB_CRASHLOOP="1")
        self.assertEqual(4, res.returncode, res.stdout)
        self.assertIn("재시작 반복", res.stdout)

    # 회귀: silent-failure major — pm2 조회 실패는 정상이 아니다(fail-closed)
    def test_pm2_query_failure_fails_closed(self) -> None:
        res = self.box.run("v1.1.0", "--yes", STUB_PM2_GARBAGE="1")
        self.assertEqual(4, res.returncode, res.stdout)
        self.assertIn("pm2 조회 실패", res.stdout)

    def test_retry_same_tag_points_rollback_to_previous(self) -> None:
        self.assertEqual(0, self.box.run("v1.1.0", "--yes").returncode)
        res = self.box.run("v1.1.0", "--yes", "--retry", STUB_HTTP="000")
        self.assertEqual(4, res.returncode, res.stdout)
        self.assertIn("되돌리기: deploy/release-inplace.sh v1.0.0 --yes --allow-downgrade", res.stdout)


class SshDeploy(Base):
    REJECT = ["", "deploy", "deploy v1.2", "deploy v1.1.0 --retry", "deploy v1.1.0 --allow-downgrade",
              "deploy v1.1.0; id", "deploy  v1.1.0", "deploy v1.1.0\nid", "bash", "release v1.1.0",
              "deploy $(id)", "deploy v1.1.0 && id", "internal-sftp"]

    def test_rejects_everything_but_deploy_tag(self) -> None:
        for cmd in self.REJECT:
            with self.subTest(cmd=cmd):
                res = self.box.run(script="ssh-deploy.sh", SSH_ORIGINAL_COMMAND=cmd)
                self.assertEqual(2, res.returncode)
                self.assertIn("거부", res.stderr)
                self.assertEqual("", self.box.calls_text())

    def test_passes_exit_codes_through(self) -> None:
        res = self.box.run(script="ssh-deploy.sh", SSH_ORIGINAL_COMMAND="deploy v1.1.0")
        self.assertEqual(0, res.returncode, res.stdout + res.stderr)
        self.assertIn("## myTangerine v1.1.0", res.stdout)
        self.assertIn("통과 — v1.1.0", res.stdout)
        self.assertPublicSafe(res)
        self.assertEqual(1, self.box.run(script="ssh-deploy.sh", SSH_ORIGINAL_COMMAND="deploy v1.2.0").returncode)

    def test_passes_rc4(self) -> None:
        res = self.box.run(script="ssh-deploy.sh", SSH_ORIGINAL_COMMAND="deploy v1.1.0", STUB_HTTP="503")
        self.assertEqual(4, res.returncode, res.stdout)
        self.assertPublicSafe(res)

    def test_never_allows_downgrade(self) -> None:
        self.box.checkout("v1.1.0")
        res = self.box.run(script="ssh-deploy.sh", SSH_ORIGINAL_COMMAND="deploy v1.0.0")
        self.assertEqual(1, res.returncode, res.stdout)
        self.assertEqual("v1.1.0", self.box.head_tag())


if __name__ == "__main__":
    unittest.main()

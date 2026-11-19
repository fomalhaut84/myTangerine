"""pm2 앱 정의 시험 (#256). 실행: python3 -m unittest discover -s deploy

운영 pm2 가 cluster 모드로 pnpm 을 띄워, pnpm 이 다시 띄운 node 의 앱 로그(pino)가 pm2 로그에 남지 않았다.
정의는 fork 모드 · 이름은 배포 스크립트(PM2_APPS_DEFAULT)와 같아야 하고, 저장소가 공개라 홈 경로 · 비밀을 담지 않는다.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
ECOSYSTEM = HERE / "ecosystem.config.cjs"
RELEASE = HERE / "release-inplace.sh"


def load_apps() -> list[dict]:
    out = subprocess.run(
        ["node", "-e", f"process.stdout.write(JSON.stringify(require({json.dumps(str(ECOSYSTEM))}).apps))"],
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(out.stdout)


@unittest.skipIf(shutil.which("node") is None, "node 가 없다")
class Ecosystem(unittest.TestCase):
    def test_names_match_deploy_script(self) -> None:
        default = re.search(r"^PM2_APPS_DEFAULT='([^']+)'", RELEASE.read_text(), re.M)
        assert default
        self.assertEqual(sorted(a["name"] for a in load_apps()), sorted(default.group(1).split()))

    def test_fork_mode_single_instance(self) -> None:
        for app in load_apps():
            with self.subTest(app=app["name"]):
                self.assertEqual(app["exec_mode"], "fork")
                self.assertEqual(app.get("instances", 1), 1)

    def test_runs_package_start_from_repo_root(self) -> None:
        packages = {
            "myTangerineApi": "@mytangerine/api",
            "myTangerineSync": "@mytangerine/sync-service",
            "myTangerineWeb": "@mytangerine/web",
        }
        for app in load_apps():
            with self.subTest(app=app["name"]):
                self.assertEqual(app["script"], "pnpm")
                self.assertEqual(app["args"], ["--filter", packages[app["name"]], "start"])
                # 서비스가 cwd 에서 위로 올라가 루트 .env 를 읽는다 — 저장소 루트
                self.assertEqual(Path(app["cwd"]).resolve(), HERE.parent.resolve())

    def test_timezone_pinned(self) -> None:
        for app in load_apps():
            with self.subTest(app=app["name"]):
                self.assertEqual(app["env"]["TZ"], "Asia/Seoul")

    def test_no_home_path_or_secret_in_file(self) -> None:
        text = ECOSYSTEM.read_text()
        self.assertNotRegex(text, r"/home/|/Users/")
        self.assertNotRegex(text, r"(?i)(secret|password|api_key|database_url|hermes_key)\s*:")

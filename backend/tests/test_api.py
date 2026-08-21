from __future__ import annotations

import base64
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from backend import main
from backend.store import JobStore


class AssetApiTests(unittest.TestCase):
    def test_asset_file_preview_and_job_association(self) -> None:
        original_store = main.store
        original_asset_dir = main.ASSET_DIR
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            main.store = JobStore(root / "api.db")
            main.ASSET_DIR = (root / "assets").resolve()
            try:
                with TestClient(main.app) as client:
                    response = client.post(
                        "/api/assets",
                        json={
                            "name": "橘猫主角",
                            "kind": "character",
                            "control": "identity",
                            "tags": ["角色", "橘猫"],
                            "file_name": "cat.png",
                            "mime_type": "image/png",
                            "file_data": base64.b64encode(b"fake-png-data").decode(),
                        },
                    )
                    self.assertEqual(response.status_code, 201, response.text)
                    asset = response.json()
                    self.assertTrue(asset["has_file"])

                    preview = client.get(f"/api/assets/{asset['id']}/content")
                    self.assertEqual(preview.status_code, 200)
                    self.assertEqual(preview.content, b"fake-png-data")

                    job_response = client.post(
                        "/api/jobs",
                        json={
                            "name": "资产关联验证",
                            "prompt": "橘猫在走廊中前进",
                            "mode": "Ref2VA",
                            "simulated": True,
                            "asset_ids": [asset["id"]],
                        },
                    )
                    self.assertEqual(job_response.status_code, 201)
                    self.assertEqual(job_response.json()["asset_ids"], [asset["id"]])
                    self.assertTrue(job_response.json()["reference_path"].endswith("cat.png"))

                    pack_response = client.post(
                        "/api/assets/import",
                        json={
                            "pack_name": "测试资产包",
                            "version": "1.0",
                            "assets": [
                                {
                                    "name": "荧光灯走廊",
                                    "kind": "scene",
                                    "control": "scene",
                                }
                            ],
                        },
                    )
                    self.assertEqual(pack_response.status_code, 201)
                    self.assertEqual(pack_response.json()["imported_count"], 1)
                    self.assertEqual(len(client.get("/api/assets").json()["assets"]), 2)
            finally:
                main.store = original_store
                main.ASSET_DIR = original_asset_dir

    def test_night_run_requires_passed_preview_before_final(self) -> None:
        original_store = main.store
        with tempfile.TemporaryDirectory() as directory:
            main.store = JobStore(Path(directory) / "night-api.db")
            try:
                with TestClient(main.app) as client:
                    run_response = client.post(
                        "/api/night-runs",
                        json={
                            "name": "守夜测试",
                            "objective": "先验证样片，再进入正式生成",
                            "topics": ["梦核"],
                            "must_have": ["自然运动"],
                            "forbidden": ["重复画面"],
                            "max_previews": 2,
                            "max_finals": 1,
                            "max_consecutive_failures": 2,
                        },
                    )
                    self.assertEqual(run_response.status_code, 201)
                    night_run_id = run_response.json()["id"]

                    preview_response = client.post(
                        "/api/jobs",
                        json={
                            "name": "梦核样片",
                            "prompt": "自然手持穿过明亮的阈限空间",
                            "mode": "I2VA",
                            "resolution": "512P 实验",
                            "duration_seconds": 5,
                            "simulated": True,
                            "night_run_id": night_run_id,
                            "production_stage": "preview",
                        },
                    )
                    self.assertEqual(preview_response.status_code, 201)
                    preview_id = preview_response.json()["id"]

                    blocked_final = client.post(
                        "/api/jobs",
                        json={
                            "name": "正式版本",
                            "prompt": "自然手持穿过明亮的阈限空间",
                            "mode": "I2VA",
                            "resolution": "768P",
                            "duration_seconds": 15,
                            "simulated": True,
                            "night_run_id": night_run_id,
                            "production_stage": "final",
                            "parent_job_id": preview_id,
                        },
                    )
                    self.assertEqual(blocked_final.status_code, 409)

                    main.store.update(
                        preview_id,
                        status="completed",
                        progress=100,
                        stage="样片完成 · 等待审核",
                    )
                    review = client.post(
                        f"/api/jobs/{preview_id}/review",
                        json={"decision": "pass", "reasons": ["方向正确"]},
                    )
                    self.assertEqual(review.status_code, 200, review.text)
                    self.assertEqual(review.json()["review_status"], "passed")
                    duplicate_review = client.post(
                        f"/api/jobs/{preview_id}/review",
                        json={"decision": "reject", "reasons": ["重复点击"]},
                    )
                    self.assertEqual(duplicate_review.status_code, 409)

                    final_response = client.post(
                        "/api/jobs",
                        json={
                            "name": "正式版本",
                            "prompt": "自然手持穿过明亮的阈限空间",
                            "mode": "I2VA",
                            "resolution": "768P",
                            "duration_seconds": 15,
                            "simulated": True,
                            "night_run_id": night_run_id,
                            "production_stage": "final",
                            "parent_job_id": preview_id,
                        },
                    )
                    self.assertEqual(final_response.status_code, 201, final_response.text)
                    self.assertEqual(final_response.json()["production_stage"], "final")
            finally:
                main.store = original_store

    def test_library_scans_only_configured_root_and_serves_registered_file(self) -> None:
        original_store = main.store
        original_roots = main.LIBRARY_ROOTS
        original_history = main.HISTORY_DATABASE_PATH
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            video_path = root / "videos" / "raw" / "legacy-clip.mp4"
            video_path.parent.mkdir(parents=True)
            video_path.write_bytes(b"fake-video-bytes")
            main.store = JobStore(root / "api.db")
            main.LIBRARY_ROOTS = (root.resolve(),)
            main.HISTORY_DATABASE_PATH = None
            try:
                with TestClient(main.app) as client:
                    synced = client.post(
                        "/api/library/sync", json={"mode": "files", "limit": 20}
                    )
                    self.assertEqual(synced.status_code, 200, synced.text)
                    self.assertEqual(synced.json()["result"]["files"]["processed"], 1)

                    listing = client.get("/api/library").json()
                    self.assertEqual(listing["total"], 1)
                    item = listing["items"][0]
                    self.assertEqual(item["metadata_quality"], "filename_only")
                    self.assertEqual(item["stage"], "raw")

                    content = client.get(f"/api/library/{item['id']}/content")
                    self.assertEqual(content.status_code, 200)
                    self.assertEqual(content.content, b"fake-video-bytes")

                    updated = client.patch(
                        f"/api/library/{item['id']}",
                        json={
                            "name": "已整理旧片",
                            "prompt": "补录的提示词",
                            "qc_status": "selected",
                            "tags": ["收藏"],
                        },
                    )
                    self.assertEqual(updated.status_code, 200, updated.text)
                    self.assertEqual(updated.json()["name"], "已整理旧片")
                    self.assertEqual(updated.json()["tags"], ["收藏"])
            finally:
                main.store = original_store
                main.LIBRARY_ROOTS = original_roots
                main.HISTORY_DATABASE_PATH = original_history


if __name__ == "__main__":
    unittest.main()

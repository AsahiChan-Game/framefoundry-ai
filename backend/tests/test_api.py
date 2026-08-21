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


if __name__ == "__main__":
    unittest.main()

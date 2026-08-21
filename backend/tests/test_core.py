from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from backend.comfyui import (
    find_placeholders,
    substitute_placeholders,
    validate_workflow,
)
from backend.store import JobStore


class WorkflowTests(unittest.TestCase):
    def test_substitution_keeps_native_types_for_full_placeholder(self) -> None:
        workflow = {
            "1": {
                "class_type": "ExampleNode",
                "inputs": {"text": "{{prompt}}", "seed": "{{seed}}"},
            }
        }
        hydrated = substitute_placeholders(
            workflow, {"prompt": "测试画面", "seed": 42, "reference_paths": ["a.png", "b.png"]}
        )
        self.assertEqual(hydrated["1"]["inputs"]["text"], "测试画面")
        self.assertEqual(hydrated["1"]["inputs"]["seed"], 42)

        multi_reference_workflow = {
            "2": {
                "class_type": "ReferenceNode",
                "inputs": {"paths": "{{reference_paths}}"},
            }
        }
        hydrated_references = substitute_placeholders(
            multi_reference_workflow,
            {"reference_paths": ["a.png", "b.png"]},
        )
        self.assertEqual(
            hydrated_references["2"]["inputs"]["paths"],
            ["a.png", "b.png"],
        )

    def test_validate_reports_nodes_and_placeholders(self) -> None:
        workflow = {
            "5": {
                "class_type": "TextEncode",
                "inputs": {"text": "Scene: {{prompt}}"},
            }
        }
        node_count, placeholders, warnings = validate_workflow(workflow)
        self.assertEqual(node_count, 1)
        self.assertEqual(placeholders, ["prompt"])
        self.assertEqual(warnings, [])
        self.assertEqual(find_placeholders(workflow), {"prompt"})


class StoreTests(unittest.TestCase):
    def test_job_lifecycle(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = JobStore(Path(directory) / "test.db")
            store.initialize()
            created = store.create(
                {
                    "id": "job-1",
                    "name": "测试任务",
                    "prompt": "测试画面",
                    "mode": "I2VA",
                    "resolution": "768P",
                    "duration_seconds": 15,
                    "simulated": True,
                }
            )
            self.assertEqual(created["status"], "queued")
            updated = store.update(
                "job-1", status="running", progress=50, stage="生成中"
            )
            self.assertEqual(updated["status"], "running")
            self.assertEqual(store.recover_interrupted(), 1)
            self.assertEqual(store.get("job-1")["status"], "failed")
            self.assertEqual(store.list()[0]["id"], "job-1")

    def test_asset_lifecycle_and_job_association(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = JobStore(Path(directory) / "test.db")
            store.initialize()
            asset = store.create_asset(
                {
                    "id": "asset-1",
                    "name": "橘猫角色",
                    "kind": "character",
                    "tags": ["角色", "橘猫"],
                    "control": "identity",
                    "file_name": "cat.png",
                    "mime_type": "image/png",
                    "file_path": str(Path(directory) / "cat.png"),
                }
            )
            self.assertEqual(asset["tags"], ["角色", "橘猫"])
            self.assertTrue(asset["has_file"])
            created = store.create(
                {
                    "id": "job-assets",
                    "name": "多参考任务",
                    "prompt": "猫在走廊中前进",
                    "mode": "Ref2VA",
                    "resolution": "768P",
                    "duration_seconds": 15,
                    "simulated": True,
                    "asset_ids": ["asset-1"],
                }
            )
            self.assertEqual(created["asset_ids"], ["asset-1"])
            self.assertEqual(store.asset_paths(["asset-1"]), [asset["file_path"]])


if __name__ == "__main__":
    unittest.main()

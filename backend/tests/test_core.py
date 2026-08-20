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
            workflow, {"prompt": "测试画面", "seed": 42}
        )
        self.assertEqual(hydrated["1"]["inputs"]["text"], "测试画面")
        self.assertEqual(hydrated["1"]["inputs"]["seed"], 42)

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


if __name__ == "__main__":
    unittest.main()

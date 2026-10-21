"""Verify the shareable build without querying a user's database."""
import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from scripts.build_demo import build, teaching_payload
from analytics import forecast_payload


class DemoBuildTests(unittest.TestCase):
    def test_snapshot_is_complete_and_preserves_known_sql_values(self):
        payload = teaching_payload()
        self.assertEqual(len(payload["records"]), 60)
        self.assertEqual(payload["yearly"]["2025"]["rate"], 4.7)
        self.assertEqual(payload["yearly"]["2025"]["trend"][1], 7.1)
        self.assertEqual(payload["quality"]["missingMonths"], [])
        self.assertEqual(payload["meta"]["kind"], "demo")

    def test_build_uses_project_relative_paths_and_the_real_forecast_model(self):
        scratch = ROOT / "preview"
        scratch.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=scratch) as directory:
            output = Path(directory)
            build(output)
            html = (output / "index.html").read_text(encoding="utf-8")
            self.assertNotIn("{{", html)
            self.assertNotIn('src="/static/', html)
            self.assertNotIn('href="/static/', html)
            self.assertLess(html.index('src="static/js/demo-api.js"'), html.index('src="static/js/charts.js"'))
            self.assertTrue((output / "static/js/signal-worker.js").is_file())
            forecasts = json.loads((output / "demo/forecasts.json").read_text(encoding="utf-8"))
            self.assertEqual(len(forecasts), 25)
            key = json.dumps(["华东", "5–14岁"], ensure_ascii=False, separators=(",", ":"))
            self.assertEqual(forecasts[key], forecast_payload(teaching_payload(), "华东", "5–14岁"))
            self.assertFalse((output / "app.py").exists())
            self.assertFalse((output / "data").exists())


if __name__ == "__main__":
    unittest.main()

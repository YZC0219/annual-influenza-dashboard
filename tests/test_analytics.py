"""Run with: python -m unittest discover -s tests -v (no extra dependencies)."""
import io
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import app as service
from analytics import DataValidationError, forecast_payload, imported_payload, parse_csv


def csv_bytes(years=range(2021, 2025), drift=0):
    return ("year,month,rate\n" + "\n".join(
        f"{year},{month},{month + (year - 2021) * drift}"
        for year in years for month in range(1, 13))).encode()


class AnalyticsTests(unittest.TestCase):
    def test_missing_month_is_null_and_zero_is_a_valid_observation(self):
        records, quality = parse_csv(b"year,month,rate\n2025,3,0\n2025,1,4\n\n")
        payload = imported_payload({"kind": "imported"}, records, quality)
        self.assertEqual(payload["yearly"]["2025"]["trend"][:4], [4, None, 0, None])
        self.assertEqual(payload["yearly"]["2025"]["rate"], 2)
        self.assertIsNone(payload["yearly"]["2025"]["cases"])
        self.assertEqual(len(quality["missingMonths"]), 10)
        self.assertEqual(quality["years"], [2025])
        self.assertTrue(any("空行" in issue for issue in quality["issues"]))

    def test_bom_and_gb18030_are_supported(self):
        records, _ = parse_csv(b"\xef\xbb\xbfyear,month,rate\n2025,1,2.5\n")
        self.assertEqual(records[0]["rate"], 2.5)
        with self.assertRaises(DataValidationError) as error:
            parse_csv("year,month,rate\n2025,1,错误\n".encode("gb18030"))
        self.assertIn("rate", error.exception.details[0])

    def test_invalid_numbers_duplicate_and_columns_are_rejected(self):
        invalid = ["1899,1,2", "2101,1,2", "2025.0,1,2", "2025,0,2", "2025,13,2",
                   "2025,1,nan", "2025,1,inf", "2025,1,-1", "2025,1,101", "2025,1,",
                   "2025,1,2,extra", "2025,1,2\n2025,1,3"]
        for body in invalid:
            with self.subTest(body=body), self.assertRaises(DataValidationError):
                parse_csv(("year,month,rate\n" + body).encode())

    def test_time_holdout_selects_drift_and_forecasts_six_months(self):
        records, quality = parse_csv(csv_bytes(drift=1))
        result = forecast_payload(imported_payload({"kind": "imported"}, records, quality))
        self.assertTrue(result["available"])
        self.assertEqual(result["method"], "seasonal_drift")
        self.assertEqual(result["validation"]["mae"], 0)
        self.assertEqual(result["validation"]["baselineMae"], 1)
        self.assertEqual(result["validation"]["trainingEnd"], "2023-12")
        self.assertEqual(result["forecast"], [{"date": f"2025-{month:02d}", "value": month + 4}
                                              for month in range(1, 7)])

    def test_validation_predictions_do_not_use_holdout_observations(self):
        records, quality = parse_csv(csv_bytes(drift=1))
        original = forecast_payload(imported_payload({"kind": "imported"}, records, quality))
        changed = [dict(row) for row in records]
        for row in changed[-12:]:
            row["rate"] += 30
        modified = forecast_payload(imported_payload({"kind": "imported"}, changed, quality))
        self.assertEqual(original["method"], modified["method"])
        self.assertEqual([p["predicted"] for p in original["validationPoints"]],
                         [p["predicted"] for p in modified["validationPoints"]])
        self.assertNotEqual(original["validation"]["mae"], modified["validation"]["mae"])

    def test_insufficient_and_missing_records_cannot_predict(self):
        for content in [csv_bytes(range(2021, 2023)), csv_bytes().replace(b"2023,2,2\n", b"")]:
            records, quality = parse_csv(content)
            result = forecast_payload(imported_payload({"kind": "imported"}, records, quality))
            self.assertFalse(result["available"])
            self.assertTrue(result["reason"])

    def test_contiguous_36_months_across_partial_year_boundaries_can_predict(self):
        source = "year,month,rate\n" + "\n".join(
            f"{index // 12},{index % 12 + 1},{index % 12 + 1}"
            for index in range(2022 * 12 + 6, 2025 * 12 + 6))
        records, quality = parse_csv(source.encode())
        self.assertEqual(len(records), 36)
        self.assertEqual(len(quality["missingMonths"]), 12)
        result = forecast_payload(imported_payload({"kind": "imported"}, records, quality))
        self.assertTrue(result["available"])
        self.assertEqual(result["validation"]["trainingEnd"], "2024-06")
        self.assertEqual(result["trainingEnd"], "2025-06")
        self.assertEqual(result["forecast"][0]["date"], "2025-07")

    def test_internal_gap_in_partial_year_sequence_is_rejected(self):
        source = "year,month,rate\n" + "\n".join(
            f"{index // 12},{index % 12 + 1},3"
            for index in range(2022 * 12 + 6, 2025 * 12 + 7)
            if index != 2023 * 12 + 4)
        records, quality = parse_csv(source.encode())
        self.assertEqual(len(records), 36)
        result = forecast_payload(imported_payload({"kind": "imported"}, records, quality))
        self.assertFalse(result["available"])
        self.assertIn("不连续", result["reason"])


class ApiTests(unittest.TestCase):
    def setUp(self):
        data = ROOT / "data"
        data.mkdir(exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=data, prefix="test-")
        self.previous_data = service.app.config["DATA_DIR"]
        service.app.config.update(TESTING=True, DATA_DIR=self.temp.name)
        self.client = service.app.test_client()

    def tearDown(self):
        service.app.config["DATA_DIR"] = self.previous_data
        self.temp.cleanup()

    def preview(self, content=None):
        return self.client.post("/api/import/preview", data={
            "file": (io.BytesIO(content or csv_bytes()), "monthly.csv"),
            "name": "测试月度数据", "source": "测试来源"})

    def test_preview_commit_dataset_roundtrip_never_writes_database(self):
        with patch.object(service, "query_all", side_effect=AssertionError("must not query DB")):
            preview = self.preview()
            self.assertEqual(preview.status_code, 200)
            self.assertEqual(len(preview.json["preview"]), 12)
            self.assertEqual(len(list((Path(self.temp.name) / "datasets").glob("*.json"))), 0)
            committed = self.client.post("/api/import/commit", json={"token": preview.json["token"]})
            self.assertEqual(committed.status_code, 200)
            dataset_id = committed.json["datasetId"]
            loaded = self.client.get("/api/influenza", query_string={"dataset": dataset_id})
            self.assertEqual(loaded.status_code, 200)
            self.assertEqual(len(loaded.json["records"]), 48)
            self.assertEqual(loaded.json["meta"]["kind"], "imported")
            self.assertIsNone(loaded.json["yearly"]["2021"]["cases"])
            datasets = self.client.get("/api/datasets").json["datasets"]
            self.assertEqual({meta["id"] for meta in datasets}, {"database", dataset_id})
            result = self.client.get("/api/forecast", query_string={"dataset": dataset_id})
            self.assertTrue(result.json["available"])
            repeated = self.client.post("/api/import/commit", json={"token": preview.json["token"]})
            self.assertEqual(repeated.status_code, 404)

    def test_validation_and_path_traversal_return_json_errors(self):
        for content in [b"bad,header\n", b"year,month,rate\n2024,1,nan"]:
            result = self.preview(content)
            self.assertEqual(result.status_code, 400)
            self.assertIn("error", result.json)
        for token in ["../app.py", "../../", None, ["bad"]]:
            result = self.client.post("/api/import/commit", json={"token": token})
            self.assertEqual(result.status_code, 400)
        result = self.client.get("/api/influenza", query_string={"dataset": "../app.py"})
        self.assertEqual(result.status_code, 400)
        self.assertEqual(self.client.post("/api/import/commit", json=[]).status_code, 400)

    def test_oversize_upload_and_expired_preview(self):
        result = self.preview(b"x" * (service.MAX_UPLOAD_BYTES + 1))
        self.assertEqual(result.status_code, 400)
        self.assertIn("2 MB", result.json["error"])
        with patch.object(service.time, "time", return_value=1):
            preview = self.preview()
        expired = self.client.post("/api/import/commit", json={"token": preview.json["token"]})
        self.assertEqual(expired.status_code, 400)

    def test_database_missing_month_retains_month_index_and_metadata(self):
        rows = [[{"year": 2025, "cases": 10, "rate": 2, "pos_rate": 5, "peak_week": 4, "samples": 8}],
                [{"year": 2025, "month": 1, "rate": 3}, {"year": 2025, "month": 3, "rate": 0}],
                [{"year": 2025, "region": "全国", "factor": 1}],
                [{"group": "全部年龄", "factor": 1}]]
        with patch.object(service, "query_all", side_effect=rows):
            result = self.client.get("/api/influenza")
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json["yearly"]["2025"]["trend"][:3], [3, None, 0])
        self.assertEqual(result.json["meta"]["kind"], "demo")
        self.assertIn("模拟数据", result.json["meta"]["source"])

    def test_database_outage_is_503_but_catalog_still_works(self):
        with patch.object(service, "query_all", side_effect=service.pymysql.OperationalError("offline")):
            self.assertEqual(self.client.get("/api/influenza").status_code, 503)
            self.assertEqual(self.client.get("/api/forecast").status_code, 503)
            self.assertEqual(self.client.get("/api/datasets").status_code, 200)


if __name__ == "__main__":
    unittest.main()

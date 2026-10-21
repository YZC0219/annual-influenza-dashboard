"""Flask application: explicit demonstration data, isolated CSV datasets and baselines."""
import json
import os
import re
import tempfile
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

import pymysql
from flask import Flask, Request, jsonify, render_template, request
from werkzeug.exceptions import RequestEntityTooLarge

from analytics import DataValidationError, data_quality, forecast_payload, imported_payload, parse_csv

BASE_DIR = Path(__file__).resolve().parent
MAX_UPLOAD_BYTES = 2 * 1024 * 1024
app = Flask(__name__)
app.config.update(DATA_DIR=str(BASE_DIR / "data"), MAX_CONTENT_LENGTH=MAX_UPLOAD_BYTES + 64 * 1024)


class LocalUploadRequest(Request):
    def _get_file_stream(self, total_content_length, content_type, filename=None, content_length=None):
        # Werkzeug may spool multipart uploads to disk. Keep that disk on D: too.
        return tempfile.SpooledTemporaryFile(max_size=512 * 1024, mode="rb+", dir=_directory("uploads"))


app.request_class = LocalUploadRequest
DB_CONFIG = {
    "host": os.getenv("FLU_DB_HOST", "127.0.0.1"),
    "port": int(os.getenv("FLU_DB_PORT", "3306")),
    "user": os.getenv("FLU_DB_USER", "root"),
    "password": os.getenv("FLU_DB_PASSWORD", ""),
    "database": os.getenv("FLU_DB_NAME", "influenza_db"),
    "charset": "utf8mb4", "connect_timeout": 3,
}


def query_all(sql, args=None):
    conn = pymysql.connect(**DB_CONFIG)
    try:
        with conn.cursor(pymysql.cursors.DictCursor) as cursor:
            cursor.execute(sql, args)
            return cursor.fetchall()
    finally:
        conn.close()


def database_meta():
    source_file = BASE_DIR / "sql" / "init_influenza.sql"
    updated = datetime.fromtimestamp(source_file.stat().st_mtime, timezone.utc).isoformat() if source_file.exists() else None
    return {"id": "database", "name": "流感教学演示数据 · 2021–2025", "kind": "demo",
            "source": "本地 MySQL · sql/init_influenza.sql 初始化模拟数据，非官方疫情监测数据",
            "updatedAt": updated,
            "updatedAtLabel": "初始化脚本修改时间（非监测更新时间）",
            "derived": "地区与年龄组指标根据全国指标及既有系数推算。"}


def database_payload():
    summary = query_all("select * from flu_yearly order by year")
    monthly = query_all("select year, month, rate from flu_monthly order by year, month")
    records = [{"year": int(row["year"]), "month": int(row["month"]), "rate": float(row["rate"])} for row in monthly]
    yearly = {}
    for row in summary:
        year = str(row["year"])
        yearly[year] = {"cases": row["cases"], "rate": float(row["rate"]),
                        "pos": float(row["pos_rate"]), "peak": row["peak_week"],
                        "sample": row["samples"], "trend": [None] * 12}
    for row in records:
        if str(row["year"]) in yearly:
            yearly[str(row["year"])]["trend"][row["month"] - 1] = row["rate"]
    region_by_year = {}
    for row in query_all("select year, region, factor from flu_region order by year"):
        region_by_year.setdefault(str(row["year"]), {})[row["region"]] = float(row["factor"])
    groups = {row["group"]: float(row["factor"]) for row in query_all("select `group`, factor from flu_age_group")}
    return {"yearly": yearly, "regionByYear": region_by_year, "groups": groups,
            "meta": database_meta(), "records": records,
            "quality": data_quality(records, expected_years=[int(year) for year in yearly])}


def _directory(name):
    directory = Path(app.config["DATA_DIR"]) / name
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def _safe_file(identifier, folder):
    if not isinstance(identifier, str) or not re.fullmatch(r"[a-f0-9]{32}", identifier):
        raise DataValidationError("无效的数据集或预览标识。")
    return _directory(folder) / f"{identifier}.json"


def _atomic_json(path, payload):
    temp_path = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent,
                                         suffix=".tmp", delete=False) as target:
            temp_path = Path(target.name)
            json.dump(payload, target, ensure_ascii=False, allow_nan=False)
            target.flush()
            os.fsync(target.fileno())
        os.replace(temp_path, path)
    finally:
        if temp_path is not None and temp_path.exists():
            temp_path.unlink()


def _read_json(path):
    if not path.is_file():
        raise FileNotFoundError("指定的数据集或预览不存在，请重新选择。")
    with path.open(encoding="utf-8") as source:
        return json.load(source)


def load_dataset(identifier):
    if identifier == "database":
        return database_payload()
    saved = _read_json(_safe_file(identifier, "datasets"))
    return imported_payload(saved["meta"], saved["records"], saved.get("quality"))


@app.errorhandler(DataValidationError)
def validation_error(error):
    return jsonify(error=str(error), details=error.details), 400


@app.errorhandler(FileNotFoundError)
def not_found(error):
    return jsonify(error=str(error)), 404


@app.errorhandler(RequestEntityTooLarge)
def upload_too_large(_error):
    return jsonify(error="CSV 文件不能超过 2 MB。", details=[]), 400


@app.errorhandler(pymysql.MySQLError)
def database_error(_error):
    return jsonify(error="本地 MySQL 暂不可用，请检查服务与连接配置；已导入的数据集仍可使用。"), 503


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/about")
def about():
    return render_template("about.html")


@app.get("/api/influenza")
def api_influenza():
    return jsonify(load_dataset(request.args.get("dataset", "database")))


@app.get("/api/datasets")
def api_datasets():
    datasets = [database_meta()]
    for path in sorted(_directory("datasets").glob("*.json"), reverse=True):
        try:
            saved = _read_json(path)
            datasets.append(saved["meta"])
        except (ValueError, KeyError, OSError):
            app.logger.warning("Skipped unreadable dataset: %s", path.name)
    return jsonify(datasets=datasets)


@app.post("/api/import/preview")
def api_import_preview():
    upload = request.files.get("file")
    if upload is None or not upload.filename:
        raise DataValidationError("请先选择 CSV 文件。")
    if not upload.filename.lower().endswith(".csv"):
        raise DataValidationError("只接受 .csv 文件。")
    content = upload.stream.read(MAX_UPLOAD_BYTES + 1)
    if len(content) > MAX_UPLOAD_BYTES:
        raise DataValidationError("CSV 文件不能超过 2 MB。")
    records, quality = parse_csv(content)
    token = uuid.uuid4().hex
    meta = {"id": None, "name": request.form.get("name", "").strip()[:80] or "导入月度数据",
            "kind": "imported", "source": request.form.get("source", "").strip()[:300] or "用户导入 CSV（来源未填写）",
            "updatedAt": datetime.now(timezone.utc).isoformat(),
            "derived": "仅包含全国、全部年龄月度 ILI%；年度 ILI% 为已有月份的算术平均，非加权监测口径；病例数、阳性率、峰值周与样本数未知。"}
    _atomic_json(_safe_file(token, "previews"), {"createdAt": time.time(), "meta": meta,
                                                "records": records, "quality": quality})
    return jsonify(token=token, preview=records[:12], quality=quality, meta=meta)


@app.post("/api/import/commit")
def api_import_commit():
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        raise DataValidationError("请提交包含 token 的 JSON 对象。")
    preview_path = _safe_file(body.get("token"), "previews")
    saved = _read_json(preview_path)
    if time.time() - saved["createdAt"] > 3600:
        raise DataValidationError("预览已超过一小时，请重新上传并确认。")
    dataset_id = uuid.uuid4().hex
    saved["meta"]["id"] = dataset_id
    saved["meta"]["updatedAt"] = datetime.now(timezone.utc).isoformat()
    _atomic_json(_safe_file(dataset_id, "datasets"),
                 {"meta": saved["meta"], "records": saved["records"], "quality": saved["quality"]})
    preview_path.unlink(missing_ok=True)
    return jsonify(datasetId=dataset_id, meta=saved["meta"])


@app.get("/api/forecast")
def api_forecast():
    payload = load_dataset(request.args.get("dataset", "database"))
    return jsonify(forecast_payload(payload, request.args.get("region", "全国"),
                                    request.args.get("group", "全部年龄")))


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=True)

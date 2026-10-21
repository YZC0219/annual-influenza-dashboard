"""Build a portable Pages demo solely from the checked-in teaching SQL."""
import argparse
import ast
import json
from pathlib import Path
import re
import shutil
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from analytics import data_quality, forecast_payload
from jinja2 import Environment, FileSystemLoader, select_autoescape


def teaching_payload():
    sql = (ROOT / "sql/init_influenza.sql").read_text(encoding="utf-8")

    def rows(table):
        match = re.search(r"INSERT INTO " + re.escape(table) + r"\s*\([^;]+?\) VALUES\s*(.*?)\s*ON DUPLICATE KEY UPDATE", sql, re.S)
        if not match:
            raise ValueError(f"Missing teaching table: {table}")
        return ast.literal_eval("[" + match.group(1) + "]")

    yearly = {}
    for year, cases, rate, pos, peak, sample in sorted(rows("flu_yearly")):
        yearly[str(year)] = dict(cases=cases, rate=rate, pos=pos, peak=peak, sample=sample, trend=[None]*12)
    records = [dict(year=year, month=month, rate=rate) for year, month, rate in sorted(rows("flu_monthly"))]
    for row in records:
        yearly[str(row["year"])]["trend"][row["month"]-1] = row["rate"]
    regions = {}
    for year, region, factor in rows("flu_region"):
        regions.setdefault(str(year), {})[region] = factor
    payload = dict(yearly=yearly, records=records, regionByYear=regions,
                   groups=dict(rows("flu_age_group")),
                   meta=dict(id="database", name="流感教学演示数据 · 2021–2025", kind="demo",
                             source="仓库 sql/init_influenza.sql 教学模拟数据快照 · 非官方疫情监测数据",
                             updatedAt=None, updatedAtLabel="教学快照，无监测更新时间",
                             derived="地区与年龄组指标根据全国指标及既有系数推算。"),
                   quality=data_quality(records, expected_years=[int(year) for year in yearly]))
    if len(records) != 60 or payload["quality"]["duplicates"] or payload["quality"]["missingMonths"]:
        raise ValueError("Teaching initializer must contain 60 complete monthly observations")
    return payload


def build(output):
    output = output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    if output != ROOT:
        shutil.copytree(ROOT / "static", output / "static", dirs_exist_ok=True)
        if (ROOT / "licenses").is_dir():
            shutil.copytree(ROOT / "licenses", output / "licenses", dirs_exist_ok=True)
        if (ROOT / "THIRD_PARTY_NOTICES.md").is_file():
            shutil.copy2(ROOT / "THIRD_PARTY_NOTICES.md", output / "THIRD_PARTY_NOTICES.md")
    data_dir = output / "demo"
    data_dir.mkdir(exist_ok=True)
    payload = teaching_payload()
    forecasts = {}
    for region in payload["regionByYear"]["2025"]:
        for group in payload["groups"]:
            key = json.dumps([region, group], ensure_ascii=False, separators=(",", ":"))
            forecasts[key] = forecast_payload(payload, region, group)
    for name, value in {"influenza":payload, "datasets":{"datasets":[payload["meta"]]}, "forecasts":forecasts}.items():
        (data_dir / f"{name}.json").write_text(json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":")), encoding="utf-8")
    env = Environment(loader=FileSystemLoader(ROOT / "templates"), autoescape=select_autoescape(["html"]))
    env.globals["url_for"] = lambda endpoint, filename: "static/" + filename
    html = env.get_template("index.html").render()
    marker = '<script src="static/js/charts.js"></script>'
    if marker not in html:
        raise ValueError("Missing application script marker")
    html = html.replace(marker, '<script src="static/js/demo-api.js"></script>' + marker)
    (output / "index.html").write_text(html, encoding="utf-8", newline="\n")
    (output / ".nojekyll").touch()
    print(f"Built {len(payload['records'])} teaching records and {len(forecasts)} forecast combinations in {output}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "_site")
    build(parser.parse_args().output)

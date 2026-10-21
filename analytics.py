"""CSV validation and transparent forecasting, without database side effects."""
import csv
import io
import math
import re
from collections import Counter


class DataValidationError(ValueError):
    def __init__(self, message, details=None):
        super().__init__(message)
        self.details = details or []


def data_quality(records, blank_rows=0, expected_years=None):
    years = sorted(set(expected_years or []) | {int(row["year"]) for row in records})
    counts = Counter((int(row["year"]), int(row["month"])) for row in records)
    missing = []
    if years:
        missing = [f"{year:04d}-{month:02d}"
                   for year in range(min(years), max(years) + 1)
                   for month in range(1, 13) if (year, month) not in counts]
    duplicates = sum(count - 1 for count in counts.values())
    issues = []
    if missing:
        issues.append(f"缺少 {len(missing)} 个月度记录；缺失值保留为空，不作为 0。")
    if duplicates:
        issues.append(f"存在 {duplicates} 条重复年月记录。")
    if blank_rows:
        issues.append(f"已忽略 {blank_rows} 个空行。")
    return {"rows": len(records), "years": years, "missingMonths": missing,
            "duplicates": duplicates, "issues": issues}


def parse_csv(content):
    """Validate the complete file; never silently coerce bad cells or duplicates."""
    decoded = None
    for encoding in ("utf-8-sig", "gb18030"):
        try:
            decoded = content.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
    if decoded is None:
        raise DataValidationError("无法读取文件编码，请使用 UTF-8 或 GB18030 CSV。")
    if "\x00" in decoded:
        raise DataValidationError("文件包含无效字符，请上传 CSV 文本文件。")
    try:
        reader = csv.reader(io.StringIO(decoded, newline=""), strict=True)
        header = next(reader, None)
        if header is None or [cell.strip() for cell in header] != ["year", "month", "rate"]:
            raise DataValidationError("CSV 表头必须依次为 year,month,rate。")
        records, errors, seen, blanks = [], [], set(), 0
        for cells in reader:
            line = reader.line_num
            if not cells or all(not cell.strip() for cell in cells):
                blanks += 1
                continue
            if len(cells) != 3:
                errors.append(f"第 {line} 行：必须有 3 列。")
                continue
            year_text, month_text, rate_text = [cell.strip() for cell in cells]
            if not re.fullmatch(r"[0-9]{4}", year_text) or not 1900 <= int(year_text) <= 2100:
                errors.append(f"第 {line} 行：year 必须是 1900–2100 的整数。")
                continue
            if not re.fullmatch(r"[0-9]{1,2}", month_text) or not 1 <= int(month_text) <= 12:
                errors.append(f"第 {line} 行：month 必须是 1–12 的整数。")
                continue
            try:
                rate = float(rate_text)
            except ValueError:
                rate = float("nan")
            if not math.isfinite(rate) or not 0 <= rate <= 100:
                errors.append(f"第 {line} 行：rate 必须是 0–100 的有限数字。")
                continue
            year, month = int(year_text), int(month_text)
            if (year, month) in seen:
                errors.append(f"第 {line} 行：{year}-{month:02d} 重复，禁止重复年月。")
                continue
            seen.add((year, month))
            records.append({"year": year, "month": month, "rate": rate})
        if errors:
            raise DataValidationError("CSV 校验未通过，请修正后重新导入。", errors[:30])
        if not records:
            raise DataValidationError("CSV 没有有效数据行。")
    except csv.Error as exc:
        raise DataValidationError("CSV 格式不正确。", [str(exc)]) from exc
    records.sort(key=lambda row: (row["year"], row["month"]))
    return records, data_quality(records, blank_rows=blanks)


def imported_payload(meta, records, quality=None):
    yearly = {}
    for row in records:
        year = str(row["year"])
        yearly.setdefault(year, {"cases": None, "rate": None, "pos": None,
                                 "peak": None, "sample": None, "trend": [None] * 12})
        yearly[year]["trend"][row["month"] - 1] = row["rate"]
    for item in yearly.values():
        observed = [rate for rate in item["trend"] if rate is not None]
        item["rate"] = round(sum(observed) / len(observed), 4)
    return {"yearly": yearly, "regionByYear": {year: {"全国": 1.0} for year in yearly},
            "groups": {"全部年龄": 1.0}, "meta": meta, "records": records,
            "quality": quality if quality is not None else data_quality(records)}


def _date(row):
    return f'{row["year"]:04d}-{row["month"]:02d}'


def _predictions(values, horizon, method):
    # Each predictor sees only its training values, including in validation.
    drift = (sum(values[i] - values[i - 12] for i in range(12, len(values))) /
             (len(values) - 12)) if method == "seasonal_drift" else 0.0
    return [max(0.0, min(100.0, values[-12 + i % 12] + drift * (1 + i // 12)))
            for i in range(horizon)]


def forecast_payload(payload, region="全国", group="全部年龄"):
    records = sorted(payload["records"], key=lambda row: (row["year"], row["month"]))
    note = "采用末尾 12 个月作为独立留出集，以 MAE 选择季节朴素或季节漂移基线；预测 6 个月。"
    if payload["meta"]["kind"] == "demo":
        note += "当前为 SQL 初始化模拟数据，结果仅用于系统演示。"
    if region != "全国" or group != "全部年龄":
        note += "地区与年龄数据由全国月度 ILI% 乘以各年既有系数推算，并非独立观测；预测基于该推算序列，系数变化会影响结果。"
    result = {"available": False, "reason": "", "method": None, "trainingEnd": None,
              "validation": None, "history": [], "validationPoints": [], "forecast": [], "note": note}
    if group not in payload["groups"] or any(region not in factors for factors in payload["regionByYear"].values()):
        result["reason"] = "当前数据集不包含所选地区或年龄组。"
        return result
    for row in records:
        factor = payload["regionByYear"].get(str(row["year"]), {}).get(region)
        if factor is None:
            result["reason"] = "所选地区存在缺失系数，无法预测。"
            return result
        value = float(row["rate"]) * factor * payload["groups"][group]
        result["history"].append({"date": _date(row), "value": round(value, 4)})
    # Calendar-year quality may list unobserved months before the first or after
    # the last observation. Only gaps inside the observed span affect forecasting.
    if payload["quality"]["duplicates"]:
        result["reason"] = "月度序列存在重复年月，请去重后预测。"
        return result
    if len(records) < 36:
        result["reason"] = f"需要至少 36 个月连续完整数据；当前只有 {len(records)} 个月。"
        return result
    indices = [row["year"] * 12 + row["month"] - 1 for row in records]
    if any(b - a != 1 for a, b in zip(indices, indices[1:])):
        result["reason"] = "月度序列不连续，无法进行时间留出验证。"
        return result
    values = [point["value"] for point in result["history"]]
    train, actual = values[:-12], values[-12:]
    candidates = {method: _predictions(train, 12, method)
                  for method in ("seasonal_naive", "seasonal_drift")}
    errors = {method: sum(abs(a - p) for a, p in zip(actual, predicted)) / 12
              for method, predicted in candidates.items()}
    method = min(errors, key=errors.get)
    predicted = _predictions(values, 6, method)
    last_index = indices[-1]
    future = [{"date": f"{(last_index + i) // 12:04d}-{(last_index + i) % 12 + 1:02d}",
               "value": round(value, 4)} for i, value in enumerate(predicted, 1)]
    result.update({"available": True, "method": method, "trainingEnd": _date(records[-1]),
                   "validation": {"mae": round(errors[method], 4),
                                  "baselineMae": round(errors["seasonal_naive"], 4), "months": 12,
                                  "trainingEnd": _date(records[-13])},
                   "validationPoints": [{"date": _date(row), "actual": actual_value,
                                         "predicted": round(predicted_value, 4)}
                                        for row, actual_value, predicted_value in
                                        zip(records[-12:], actual, candidates[method])],
                   "forecast": future})
    return result

import json
import logging

import lightgbm as lgb
import numpy as np
import pandas as pd

from . import config
from .levels import Levels

log = logging.getLogger(__name__)

MAX_REASONS = 4
SUFFIXES = ("_zu", "_ratio_u", "_first_time", "_zr", "_shift")
CONTEXT = {"role", "functional_unit", "department", "O", "C", "E", "A", "N", "days_active", "dow", "is_weekend"}

SIGNALS = {
    "logon_first_hour": "start", "logoff_last_hour": "end",
    "logon_after_hours": "after_hours_logon", "logoff_after_hours": "after_hours_logon", "logon_weekend": "weekend",
    "logon_other_pc": "other_pc", "logon_distinct_pc": "other_pc", "logon_n": "logons", "logoff_n": "logons",
    "usb_n": "usb", "usb_weekend": "usb", "usb_distinct_pc": "usb", "usb_after_hours": "usb_after_hours",
    "file_n": "files", "file_distinct": "files", "file_distinct_pc": "files", "file_after_hours": "files_after_hours",
    "file_zip": "file_zip", "file_exe": "file_exe", "file_doc": "file_doc",
    "file_pdf": "file_doc", "file_txt": "file_doc", "file_jpg": "file_doc",
    "http_leak": "leak", "http_job": "job", "http_hack": "hack", "http_cloud": "cloud",
    "http_rare_visits": "rare_sites", "http_rare_domains": "rare_sites",
    "http_n": "web", "http_distinct_domains": "web", "http_after_hours": "web_after_hours",
    "email_ext_recipients": "ext_email", "email_to_ext": "ext_email", "email_ext_attachments": "ext_attach",
    "email_attachments": "attach", "email_n": "email", "email_recipients": "email", "email_size": "email",
    "email_size_max": "email", "email_bcc": "email", "email_from_personal": "email",
    "email_after_hours": "email_after_hours",
}


def _base(feature):
    for s in SUFFIXES:
        if feature.endswith(s):
            return feature[: -len(s)]
    return feature


def _clock(hours):
    if pd.isna(hours):
        return "?"
    h, m = int(hours), int(round((hours % 1) * 60)) % 60
    return f"{(h % 12) or 12}:{m:02d} {'AM' if h < 12 else 'PM'}"


def _times(n):
    n = int(round(n))
    return "once" if n == 1 else f"{n} times"


def _usual(row, col):
    ratio = row.get(f"{col}_ratio_u")
    if ratio is None or pd.isna(ratio) or ratio == 0:
        return None
    return max((row[col] + 1) / ratio - 1, 0)


def _n(count, word, plural=None):
    count = int(round(count))
    return f"{count} {word if count == 1 else plural or word + 's'}"


def _above_normal(row, col):
    value = row[col]
    if pd.isna(value) or value <= 0:
        return False
    if row.get(f"{col}_first_time") == 1:
        return True
    usual = _usual(row, col)
    peers = row.get(f"{col}_zr")
    return usual is None or value > usual * 1.2 + 0.5 or (peers is not None and pd.notna(peers) and peers > 1.5)


def _compare(row, col, unit="a day"):
    if row.get(f"{col}_first_time") == 1:
        return ", for the first time ever"
    usual = _usual(row, col)
    if usual is not None and row[col] > usual * 1.2 + 0.5:
        return f", usually {usual:.1f} {unit}"
    return ", more than others in the same role"


def _sentence(signal, r):
    match signal:
        case "start":
            shift = r.get("logon_first_hour_shift")
            if pd.isna(r["logon_first_hour"]) or not ((pd.notna(shift) and shift < -1) or r["logon_after_hours"] > 0):
                return None
            usual = f" (usually around {_clock(r['logon_first_hour'] - shift)})" if pd.notna(shift) else ""
            return f"logged in at {_clock(r['logon_first_hour'])}{usual}"
        case "end":
            shift = r.get("logoff_last_hour_shift")
            if pd.isna(r["logoff_last_hour"]) or not ((pd.notna(shift) and shift > 1) or r["logoff_after_hours"] > 0):
                return None
            return f"logged off late, at {_clock(r['logoff_last_hour'])}"
        case "after_hours_logon":
            n = r["logon_after_hours"] + r["logoff_after_hours"]
            return f"was active outside working hours ({_times(n)})" if n > 0 else None
        case "weekend":
            return "logged in on a weekend" if r["logon_weekend"] > 0 else None
        case "other_pc":
            return f"logged on to {_n(r['logon_other_pc'], 'PC')} other than their own" if r["logon_other_pc"] > 0 else None
        case "logons":
            return f"logged on {_times(r['logon_n'])} ({_compare(r, 'logon_n')[2:]})" if _above_normal(r, "logon_n") else None
        case "usb":
            return f"connected a USB drive {_times(r['usb_n'])} ({_compare(r, 'usb_n')[2:]})" if _above_normal(r, "usb_n") else None
        case "usb_after_hours":
            return f"used a USB drive after hours ({_times(r['usb_after_hours'])})" if r["usb_after_hours"] > 0 else None
        case "files":
            return f"copied {_n(r['file_n'], 'file')} to removable media ({_compare(r, 'file_n')[2:]})" if _above_normal(r, "file_n") else None
        case "files_after_hours":
            return f"copied {_n(r['file_after_hours'], 'file')} after hours" if r["file_after_hours"] > 0 else None
        case "file_zip":
            return f"copied {_n(r['file_zip'], '.zip archive')}" if r["file_zip"] > 0 else None
        case "file_exe":
            return f"copied {_n(r['file_exe'], 'program file')} (.exe)" if r["file_exe"] > 0 else None
        case "file_doc":
            n = r["file_doc"] + r["file_pdf"] + r["file_txt"]
            return f"copied {_n(n, 'document')}" if n > 0 else None
        case "leak":
            return f"visited a leak site such as Wikileaks ({_times(r['http_leak'])})" if r["http_leak"] > 0 else None
        case "job":
            return f"visited job-search sites {_times(r['http_job'])} ({_compare(r, 'http_job')[2:]})" if _above_normal(r, "http_job") else None
        case "hack":
            return f"visited hacking or keylogger-related pages ({_times(r['http_hack'])})" if _above_normal(r, "http_hack") else None
        case "cloud":
            return f"visited file-sharing or upload sites ({_times(r['http_cloud'])})" if _above_normal(r, "http_cloud") else None
        case "rare_sites":
            return f"visited {_n(r['http_rare_visits'], 'page')} on sites almost nobody in the company uses" if r["http_rare_visits"] > 0 else None
        case "web":
            return f"browsed more than usual ({_n(r['http_n'], 'page')}{_compare(r, 'http_n')})" if _above_normal(r, "http_n") else None
        case "web_after_hours":
            return f"browsed the web after hours ({_n(r['http_after_hours'], 'page')})" if r["http_after_hours"] > 0 else None
        case "ext_email":
            return f"emailed {_n(r['email_ext_recipients'], 'person', 'people')} outside the company ({_compare(r, 'email_ext_recipients')[2:]})" if _above_normal(r, "email_ext_recipients") else None
        case "ext_attach":
            return f"sent {_n(r['email_ext_attachments'], 'attachment')} outside the company" if r["email_ext_attachments"] > 0 else None
        case "attach":
            return f"sent {_n(r['email_attachments'], 'email attachment')} ({_compare(r, 'email_attachments')[2:]})" if _above_normal(r, "email_attachments") else None
        case "email":
            return f"sent more email than usual ({_n(r['email_n'], 'email')}{_compare(r, 'email_n')})" if _above_normal(r, "email_n") else None
        case "email_after_hours":
            return f"sent {_n(r['email_after_hours'], 'email')} after hours" if r["email_after_hours"] > 0 else None
    return None


def _join(parts):
    return parts[0] if len(parts) == 1 else ", ".join(parts[:-1]) + " and " + parts[-1]


def explain(rows, model, features, risk=None, levels=None):
    levels = levels or Levels.load()
    contrib = model.predict(rows[features], pred_contrib=True)[:, :-1]
    risk = model.predict(rows[features]) if risk is None else np.asarray(risk)
    out = []
    for i, (_, row) in enumerate(rows.iterrows()):
        per_signal = {}
        for f, c in zip(features, contrib[i]):
            if f in CONTEXT or c <= 0:
                continue
            sig = SIGNALS.get(_base(f))
            if sig:
                per_signal[sig] = per_signal.get(sig, 0.0) + c
        ranked = sorted(per_signal.items(), key=lambda kv: -kv[1])
        reasons, weights = [], []
        for sig, w in ranked:
            text = _sentence(sig, row)
            if text and text not in reasons:
                reasons.append(text)
                weights.append(round(float(w), 2))
            if len(reasons) == MAX_REASONS:
                break
        role = row.get("role")
        who = f"{row['user']} ({role})" if isinstance(role, str) else row["user"]
        day = pd.Timestamp(row["day"]).strftime("%a %d %b %Y")
        story = f"{who} on {day}: {_join(reasons)}." if reasons else f"{who} on {day}: unusual activity overall."
        out.append({"user": row["user"], "day": pd.Timestamp(row["day"]).date(), "risk": float(risk[i]),
                    "level": levels.level(risk[i]), "percentile": round(levels.percentile(risk[i]), 2), "story": story[0].upper() + story[1:],
                    "reasons": json.dumps([{"reason": r, "weight": w} for r, w in zip(reasons, weights)])})
    return pd.DataFrame(out)


def run():
    model = lgb.Booster(model_file=str(config.MODELS_DIR / "shield_lgbm.txt"))
    features = json.loads((config.MODELS_DIR / "feature_contract.json").read_text())["features"]
    table = pd.read_parquet(config.FEATURES_DIR / "user_day.parquet")

    cv = pd.read_parquet(config.REPORTS_DIR / "cv_scores.parquet")
    levels = Levels.load()
    cv = cv[cv["cv_score"] >= levels.cutoffs["Medium"]]
    rows = cv[["user", "day", "cv_score", "label", "scenario"]].merge(table.drop(columns=["label", "scenario"]), on=["user", "day"])
    alerts = explain(rows, model, features, risk=rows["cv_score"], levels=levels)
    alerts["actually_malicious"] = rows["label"].to_numpy()
    alerts["scenario"] = rows["scenario"].to_numpy()
    alerts = alerts.sort_values("risk", ascending=False)

    alerts.to_csv(config.REPORTS_DIR / "alerts.csv", index=False)
    lines = ["# Shield alerts", "",
             f"{len(alerts)} user-days in the riskiest 1% (risk >= {levels.cutoffs['Medium']:.4f}), scored by models that never saw the user. "
             f"{int(alerts['actually_malicious'].sum())} are real attack days.", ""]
    sample = pd.concat([alerts[alerts["actually_malicious"] == 1].head(25), alerts[alerts["actually_malicious"] == 0].head(5)])
    for _, a in sample.iterrows():
        truth = f"real attack, scenario {a['scenario']}" if a["actually_malicious"] else "false alarm"
        lines += [f"**{a['level']} risk {a['risk']:.2f}** ({truth})", "", a["story"], ""]
    (config.REPORTS_DIR / "alerts.md").write_text("\n".join(lines), encoding="utf-8")
    log.info("Explained %d alerts (%d real attack days); saved alerts.csv and alerts.md",
             len(alerts), int(alerts["actually_malicious"].sum()))
    for s in alerts["story"].head(5):
        log.info("  %s", s)
    return alerts

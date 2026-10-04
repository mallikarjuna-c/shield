import json

import numpy as np
import pandas as pd
import pytest

from shield import config, ingest
from shield.explain import _above_normal
from shield.features import DEVIATION_COLS, build, combine_daily
from shield.levels import Levels

HAS_DATA = (config.FEATURES_DIR / "user_day.parquet").exists() and (config.MODELS_DIR / "holdout_lgbm.txt").exists()
needs_data = pytest.mark.skipif(not HAS_DATA, reason="pipeline outputs not available")


def _daily(n_days=40, users=("U1", "U2")):
    days = pd.date_range("2010-01-04", periods=n_days)
    rows = [{"user": u, "day": d, **{c: float((i + j) % 3) for j, c in enumerate(DEVIATION_COLS)},
             "logon_first_hour": 8.5, "logoff_last_hour": 17.0}
            for u in users for i, d in enumerate(days)]
    return pd.DataFrame(rows)


def _users(users=("U1", "U2")):
    return pd.DataFrame({"user": list(users), "role": ["Engineer"] * len(users)})


def test_baseline_never_uses_future_days():
    daily = _daily()
    before = build(combine_daily([daily]), _users())
    changed = daily.copy()
    last = changed["day"] == changed["day"].max()
    changed.loc[last, "usb_n"] = 50.0
    after = build(combine_daily([changed]), _users())
    past = before["day"] < before["day"].max()
    cols = [c for c in before.columns if c.startswith("usb_n") and not c.endswith("_zr")]
    pd.testing.assert_frame_equal(before.loc[past, cols].reset_index(drop=True), after.loc[past, cols].reset_index(drop=True))
    assert after.loc[last.to_numpy() & (after["user"] == "U1").to_numpy(), "usb_n_zu"].iloc[0] > 5


def test_first_time_flag_only_on_first_occurrence():
    daily = _daily()
    daily["usb_n"] = 0.0
    daily.loc[(daily["user"] == "U1") & (daily["day"].isin(daily["day"].unique()[[10, 20]])), "usb_n"] = 2.0
    f = build(combine_daily([daily]), _users())
    u1 = f[f["user"] == "U1"].reset_index(drop=True)
    assert u1["usb_n_first_time"].sum() == 1
    assert u1.loc[10, "usb_n_first_time"] == 1


def test_logon_aggregation_counts_after_hours_and_other_pc():
    raw = pd.DataFrame({
        "date": ["05/18/2011 06:30:00", "05/18/2011 09:00:00", "05/18/2011 21:15:00", "05/18/2011 17:30:00"],
        "user": ["U1"] * 4, "pc": ["PC-1", "PC-1", "PC-9", "PC-1"], "activity": ["Logon", "Logon", "Logon", "Logoff"],
    })
    out = ingest.aggregate_logon(ingest.add_time(raw), pd.Series({"U1": "PC-1"})).iloc[0]
    assert out["logon_n"] == 3
    assert out["logon_after_hours"] == 2
    assert out["logon_other_pc"] == 1
    assert out["logon_first_hour"] == pytest.approx(6.5)
    assert out["logoff_last_hour"] == pytest.approx(17.5)


def test_levels_are_ordered_and_percentiles_monotonic():
    lv = Levels(np.linspace(0, 1, 10_001))
    assert lv.cutoffs["High"] > lv.cutoffs["Medium"] > lv.cutoffs["Watch"]
    assert lv.level(0.999) == "High"
    assert lv.level(0.985) == "Watch"
    assert lv.level(0.5) == "Normal"
    assert lv.percentile(0.2) < lv.percentile(0.8)


def test_story_never_cites_lower_than_usual_activity():
    row = pd.Series({"usb_n": 1.0, "usb_n_ratio_u": 0.5, "usb_n_first_time": 0, "usb_n_zr": -0.3})
    assert not _above_normal(row, "usb_n")
    row = pd.Series({"usb_n": 6.0, "usb_n_ratio_u": 3.5, "usb_n_first_time": 0, "usb_n_zr": 2.0})
    assert _above_normal(row, "usb_n")


@needs_data
def test_feature_contracts_exclude_shortcut_features():
    for name in ("feature_contract.json", "holdout_feature_contract.json"):
        features = set(json.loads((config.MODELS_DIR / name).read_text())["features"])
        assert not features & set(config.EXCLUDED_FEATURES)
        assert not {f for f in features if any(k in f.lower() for k in ("label", "scenario", "insider", "malicious"))}


@needs_data
def test_alerts_are_exactly_the_model_scores_above_the_medium_cutoff():
    cv = pd.read_parquet(config.REPORTS_DIR / "cv_scores.parquet")
    alerts = pd.read_csv(config.REPORTS_DIR / "alerts.csv", parse_dates=["day"])
    cutoff = Levels.load().cutoffs["Medium"]
    merged = alerts.merge(cv, on=["user", "day"], how="left")
    assert np.allclose(merged["risk"], merged["cv_score"], rtol=0, atol=1e-12)
    assert len(alerts) == int((cv["cv_score"] >= cutoff).sum())


@needs_data
def test_build_on_a_subset_matches_training_table():
    full = pd.read_parquet(config.FEATURES_DIR / "user_day.parquet")
    users_df = pd.read_parquet(config.INTERIM_DIR / "users.parquet")
    user, day = "AAM0658", pd.Timestamp("2010-10-23")
    daily = {s: pd.read_parquet(config.INTERIM_DIR / f"{s}_daily.parquet") for s in ("logon", "device", "file", "email", "http")}
    frames = [d[((d["user"] == user) & (d["day"] <= day)) | (d["day"] == day)] for d in daily.values()]
    sub = build(combine_daily(frames), users_df)
    a = sub[(sub["user"] == user) & (sub["day"] == day)].iloc[0]
    b = full[(full["user"] == user) & (full["day"] == day)].iloc[0]
    features = json.loads((config.MODELS_DIR / "feature_contract.json").read_text())["features"]
    np.testing.assert_allclose(a[features].astype(float), b[features].astype(float), rtol=1e-5, equal_nan=True)


@pytest.fixture(scope="module")
def monitor(tmp_path_factory):
    from shield.monitor import DayMonitor
    m = DayMonitor()
    m.state_dir = tmp_path_factory.mktemp("state")
    m.reset()
    return m


def _csv(rows):
    cols = ["source", "id", "date", "user", "pc", "activity", "filename", "url", "to", "cc", "bcc", "from", "size", "attachments"]
    return pd.DataFrame(rows).reindex(columns=cols).to_csv(index=False)


@needs_data
def test_monitor_rejects_invalid_uploads(monitor):
    user = monitor.users["user"].iloc[0]
    with pytest.raises(ValueError, match="missing columns"):
        monitor.upload("bad.csv", "a,b\n1,2\n")
    with pytest.raises(ValueError, match="must be on"):
        monitor.upload("x.csv", _csv([{"source": "logon", "id": "e1", "date": "05/17/2011 09:00:00", "user": user, "activity": "Logon"}]))
    with pytest.raises(ValueError, match="unknown user"):
        monitor.upload("x.csv", _csv([{"source": "logon", "id": "e2", "date": "05/18/2011 09:00:00", "user": "NOBODY", "activity": "Logon"}]))
    with pytest.raises(ValueError, match="unknown source"):
        monitor.upload("x.csv", _csv([{"source": "phone", "id": "e3", "date": "05/18/2011 09:00:00", "user": user}]))


@needs_data
def test_monitor_scores_upload_and_ignores_duplicates(monitor):
    user = monitor.users["user"].iloc[0]
    rows = [{"source": "logon", "id": "ok1", "date": "05/18/2011 08:30:00", "user": user, "pc": "PC-0001", "activity": "Logon"},
            {"source": "http", "id": "ok2", "date": "05/18/2011 09:10:00", "user": user, "pc": "PC-0001", "url": "http://msn.com/x"}]
    snap = monitor.upload("one.csv", _csv(rows))
    assert snap["as_of"] == "10:00"
    assert snap["users"][0]["level"] in {"High", "Medium", "Watch", "Normal"}
    assert 0 <= snap["users"][0]["risk"] <= 1
    with pytest.raises(ValueError, match="already uploaded"):
        monitor.upload("one.csv", _csv(rows))
    monitor.reset()


@needs_data
def test_api_blocks_path_traversal_and_huge_uploads():
    from fastapi.testclient import TestClient
    from server.app import MAX_UPLOAD_CHARS, app
    with TestClient(app) as c:
        for url in ("/..%2F..%2Fshield%2Fconfig.py", "/..%2Frequirements.txt", "/assets/..%2F..%2F..%2Fshield%2Fconfig.py"):
            r = c.get(url)
            assert "Central configuration" not in r.text and "lightgbm" not in r.text
        assert c.get("/api/does-not-exist").status_code == 404
        assert c.post("/api/realtime/upload", json={"name": "x.csv", "content": "a" * (MAX_UPLOAD_CHARS + 1)}).status_code == 413
        assert c.get("/api/meta").json()["levels"][0]["level"] == "High"


@needs_data
def test_events_endpoint_flags_risky_activity():
    from fastapi.testclient import TestClient
    from server.app import app
    with TestClient(app) as c:
        assert c.get("/api/realtime/events/NOBODY").json()["events"] == []
        hits = c.get("/api/users", params={"q": "pob"}).json()
        assert hits and all("POB" in h["user"] for h in hits) and hits[0]["user"].startswith("POB")
        assert c.get("/api/users", params={"q": "zzzz"}).json() == []
        plain = c.get("/api/history", params={"start": "2010-07-01", "end": "2010-09-30"}).json()
        assert "truth" not in plain and all("insider" not in u for u in plain["top_users"])
        t = c.get("/api/history", params={"start": "2010-07-01", "end": "2010-09-30", "eval_mode": True}).json()["truth"]
        assert 0 < t["attack_days_alerted"] <= t["attack_days"] and t["real_alerts"] <= t["alerts"]
    from server.app import _flags
    row = {"source": "http", "url": "http://wikileaks.org/upload", "pc": "PC-1", "activity": None,
           "to": None, "cc": None, "bcc": None, "ts": pd.Timestamp("2011-05-18 21:30")}
    flags = _flags(row, "PC-1", {"msn.com"})
    assert "after hours" in flags and "leak site" in flags and "rare site" in flags
    row = {"source": "logon", "url": None, "pc": "PC-2", "activity": "Logon", "to": None, "cc": None, "bcc": None,
           "ts": pd.Timestamp("2011-05-18 10:00")}
    assert _flags(row, "PC-1", set()) == ["other PC"]

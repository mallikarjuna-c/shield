import json
import threading
from contextlib import asynccontextmanager
from datetime import timedelta

import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from shield import config
from shield.replay import REPLAY_DAY, SLOTS, replay_dir
from shield.levels import Levels
from shield.monitor import DayMonitor
from shield.stages import STAGES

DIST = config.PROJECT_DIR / "web" / "dist"
MAX_UPLOAD_CHARS = 50_000_000
ACTIVITY = ["logon_after_hours", "usb_n", "file_n", "email_ext_attachments", "http_job", "http_leak", "http_cloud"]


class History:
    def __init__(self):
        r = config.REPORTS_DIR
        self.timeline = pd.read_parquet(r / "stage_timeline.parquet")
        self.alerts = pd.read_csv(r / "alerts.csv", parse_dates=["day"])
        self.users = pd.read_parquet(config.INTERIM_DIR / "users.parquet").set_index("user")
        self.activity = pd.read_parquet(config.FEATURES_DIR / "user_day.parquet", columns=["user", "day"] + ACTIVITY)
        ins = pd.read_csv(config.answers_dir() / "insiders.csv", dtype=str)
        self.insiders = set(ins.loc[ins["dataset"].str.strip() == config.RELEASE.lstrip("r"), "user"])
        self.levels = Levels.load()
        self.user_ids = sorted(self.timeline["user"].unique())
        cv = pd.read_parquet(r / "cv_scores.parquet", columns=["user", "day", "label"])
        self.attack_days = cv.loc[cv["label"] == 1, ["user", "day"]].reset_index(drop=True)
        self.first = self.timeline["day"].min()
        self.last = self.timeline["day"].max()

    def role(self, u):
        return str(self.users.loc[u, "role"]) if u in self.users.index else None


hist: History = None
mon: DayMonitor = None
lock = threading.Lock()


@asynccontextmanager
async def lifespan(_):
    global hist, mon
    hist = History()
    mon = DayMonitor()
    yield


app = FastAPI(title="Shield", lifespan=lifespan)


def _day(s, default):
    if not s:
        return default
    try:
        return pd.Timestamp(s)
    except ValueError:
        raise HTTPException(400, f"bad date {s}")


def _replay_rows():
    if not mon.snapshots:
        return pd.DataFrame(columns=["user", "day", "risk", "stage", "level", "story"])
    s = mon.snapshots[-1]
    return pd.DataFrame([{"user": u["user"], "day": REPLAY_DAY, "risk": u["risk"], "stage": u["stage"],
                          "level": u["level"], "story": u["story"]} for u in s["users"]])


@app.get("/api/meta")
def meta():
    return {"history_first": f"{hist.first:%Y-%m-%d}", "history_last": f"{hist.last:%Y-%m-%d}",
            "replay_day": f"{REPLAY_DAY:%Y-%m-%d}", "slots": [f"{a:02d}:00-{b:02d}:00" for a, b in SLOTS],
            "users": int(hist.timeline["user"].nunique()), "stages": STAGES, "levels": hist.levels.describe()}


@app.get("/api/summary")
def summary():
    m = json.loads((config.REPORTS_DIR / "metrics.json").read_text())
    t = json.loads((config.REPORTS_DIR / "test_results.json").read_text())
    future = t["future_days"]["at_budget"]
    return {
        "employees": int(hist.timeline["user"].nunique()),
        "employee_days": int(len(hist.timeline)),
        "insiders": int(m["user"]["insiders"]),
        "insiders_in_top_100": int(m["user"]["insiders_in_top_100"]),
        "precision_at_100": float(m["user_day"]["precision_at_100"]),
        "pr_auc": float(m["user_day"]["pr_auc"]),
        "random_pr_auc": float(m["user_day"]["random_pr_auc"]),
        "roc_auc": float(m["user_day"]["roc_auc"]),
        "future_high_precision": float(future["High"]["precision"]),
        "future_medium_recall": float(future["Medium+"]["recall"]),
        "history_first": f"{hist.first:%Y-%m-%d}", "history_last": f"{hist.last:%Y-%m-%d}",
    }


def _flags(r, primary, known):
    flags = []
    hour = r["ts"].hour
    if hour < config.WORK_START_HOUR or hour >= config.WORK_END_HOUR:
        flags.append("after hours")
    if r["source"] in ("logon", "device", "file") and isinstance(r["pc"], str) and r["pc"] != primary:
        flags.append("other PC")
    if r["source"] == "http" and isinstance(r["url"], str):
        url = r["url"].lower()
        for name, words in config.URL_KEYWORDS.items():
            if any(w in url for w in words):
                flags.append({"job": "job site", "leak": "leak site", "hack": "hacking site", "cloud": "upload site"}[name])
        domain = url.split("://")[-1].split("/")[0]
        if domain not in known and domain.removeprefix("www.") not in known:
            flags.append("rare site")
    if r["source"] == "email":
        recipients = ";".join(str(r[c]) for c in ("to", "cc", "bcc") if isinstance(r[c], str))
        if recipients.count("@") > recipients.count("@" + config.ORG_EMAIL_DOMAIN):
            flags.append("outside recipient")
    if r["source"] == "device" and str(r["activity"]).lower() == "connect":
        flags.append("USB")
    return flags


def _describe(r):
    src = r["source"]
    if src == "logon":
        return f"{r['activity']} on {r['pc']}"
    if src == "device":
        return f"USB {str(r['activity']).lower()} on {r['pc']}"
    if src == "file":
        return f"Copied {r['filename']} to USB"
    if src == "email":
        n = sum(str(r[c]).count("@") for c in ("to", "cc", "bcc") if isinstance(r[c], str))
        att = int(float(r["attachments"])) if isinstance(r["attachments"], str) and r["attachments"] else 0
        return f"Email to {n} recipient{'s' if n != 1 else ''}" + (f", {att} attachment{'s' if att != 1 else ''}" if att else "")
    return str(r["url"]).split("://")[-1][:80]


@app.get("/api/realtime/events/{user}")
def realtime_events(user: str):
    ev = mon.events[mon.events["user"] == user].copy()
    if ev.empty:
        return {"user": user, "day": f"{REPLAY_DAY:%Y-%m-%d}", "events": []}
    ev["ts"] = pd.to_datetime(ev["date"], format=config.DATE_FORMAT)
    ev = ev.sort_values("ts")
    primary = mon.primary.get(user)
    out = [{"time": f"{r['ts']:%H:%M:%S}", "hour": r["ts"].hour + r["ts"].minute / 60 + r["ts"].second / 3600,
            "source": r["source"], "text": _describe(r), "flags": _flags(r, primary, mon.known_domains)}
           for _, r in ev.iterrows()]
    return {"user": user, "day": f"{REPLAY_DAY:%Y-%m-%d}", "primary_pc": primary,
            "work_hours": [config.WORK_START_HOUR, config.WORK_END_HOUR], "events": out}


@app.get("/api/realtime")
def realtime(eval_mode: bool = False):
    snaps = mon.snapshots
    truth = None
    f = replay_dir() / "ground_truth.csv"
    if eval_mode and f.exists():
        t = pd.read_csv(f, dtype=str)
        truth = {r.user: {"attacker": r.attacker == "1", "scenario": None if pd.isna(r.scenario) else int(float(r.scenario)),
                          "replayed_insider": None if pd.isna(r.replayed_insider) else r.replayed_insider}
                 for r in t.itertuples()}
    timeline = [{"upload": s["upload"], "as_of": s["as_of"], "file": s["file"], "new_events": s["new_events"],
                 "summary": s["summary"], "risks": {u["user"]: round(u["risk"], 4) for u in s["users"]},
                 "percentiles": {u["user"]: u["percentile"] for u in s["users"]},
                 "stages": {u["user"]: u["stage"] for u in s["users"]}} for s in snaps]
    return {"replay_day": f"{REPLAY_DAY:%Y-%m-%d}", "latest": snaps[-1] if snaps else None, "timeline": timeline, "truth": truth}


class Upload(BaseModel):
    name: str
    content: str


@app.post("/api/realtime/upload")
def upload(body: Upload):
    if len(body.content) > MAX_UPLOAD_CHARS:
        raise HTTPException(413, f"file too large (limit {MAX_UPLOAD_CHARS // 1_000_000} MB)")
    with lock:
        try:
            snap = mon.upload(body.name, body.content)
        except ValueError as e:
            raise HTTPException(400, str(e))
    return {"upload": snap["upload"], "as_of": snap["as_of"], "new_events": snap["new_events"], "summary": snap["summary"]}


@app.post("/api/realtime/reset")
def reset():
    with lock:
        mon.reset()
    return {"ok": True}


@app.get("/api/history")
def history(start: str | None = None, end: str | None = None, eval_mode: bool = False):
    e = _day(end, REPLAY_DAY if mon.snapshots else hist.last)
    s = _day(start, e - timedelta(days=29))
    t = hist.timeline[(hist.timeline["day"] >= s) & (hist.timeline["day"] <= e)][["user", "day", "risk", "stage"]]
    replay = _replay_rows()
    if len(replay) and s <= REPLAY_DAY <= e:
        t = pd.concat([t, replay[["user", "day", "risk", "stage"]]], ignore_index=True)
    a = hist.alerts[(hist.alerts["day"] >= s) & (hist.alerts["day"] <= e)][["user", "day", "risk", "level", "story", "actually_malicious"]]
    if len(replay) and s <= REPLAY_DAY <= e:
        d = replay[replay["risk"] >= hist.levels.cutoffs["Medium"]].assign(actually_malicious=None)
        a = pd.concat([a, d[["user", "day", "risk", "level", "story", "actually_malicious"]]], ignore_index=True)

    days = pd.date_range(s, e)
    hi, med = hist.levels.cutoffs["High"], hist.levels.cutoffs["Medium"]
    per_day = t.groupby("day").agg(users=("user", "nunique"), high=("risk", lambda x: int((x >= hi).sum())),
                                   alerts=("risk", lambda x: int((x >= med).sum()))).reindex(days, fill_value=0)
    series = [{"day": f"{d:%Y-%m-%d}", "alerts": int(r.alerts), "high": int(r.high), "active_users": int(r.users)}
              for d, r in per_day.iterrows()]
    by_user = t.groupby("user").agg(peak=("risk", "max"), max_stage=("stage", "max"), days=("day", "nunique"))
    alert_days = a.groupby("user").size()
    top = by_user[(by_user["peak"] >= hist.levels.cutoffs["Watch"]) | (by_user["max_stage"] >= 1)].sort_values(["peak", "max_stage"], ascending=False).head(50)
    last_story = a.sort_values("day").groupby("user").tail(1).set_index("user")
    top_rows = [{"user": u, "role": hist.role(u), "peak_risk": float(r.peak), "peak_level": hist.levels.level(r.peak), "max_stage": int(r.max_stage),
                 "max_stage_name": STAGES[int(r.max_stage)], "alert_days": int(alert_days.get(u, 0)), "active_days": int(r.days),
                 "last_alert": f"{last_story.loc[u, 'day']:%Y-%m-%d}" if u in last_story.index else None,
                 "last_story": last_story.loc[u, "story"] if u in last_story.index else None,
                 **({"insider": u in hist.insiders} if eval_mode else {})} for u, r in top.iterrows()]
    stage_counts = by_user["max_stage"].value_counts()
    recent = a.sort_values(["day", "risk"], ascending=False).head(150)
    top_rows = [dict(r, peak_pct=hist.levels.percentile(r["peak_risk"])) for r in top_rows]
    truth = _truth_summary(a, s, e, replay) if eval_mode else None
    return {
        "start": f"{s:%Y-%m-%d}", "end": f"{e:%Y-%m-%d}", "includes_replay_day": bool(len(replay) and s <= REPLAY_DAY <= e),
        "kpis": {"user_days": int(len(t)), "users": int(t["user"].nunique()), "alerts": int(len(a)),
                 "users_alerted": int(a["user"].nunique()), "high_alerts": int((a["risk"] >= hi).sum()),
                 "users_staging_plus": int((by_user["max_stage"] >= 3).sum())},
        "series": series,
        "stage_counts": {STAGES[k]: int(stage_counts.get(k, 0)) for k in range(6)},
        "top_users": top_rows,
        "alerts": [{"user": r.user, "role": hist.role(r.user), "day": f"{r.day:%Y-%m-%d}", "risk": float(r.risk), "pct": hist.levels.percentile(r.risk),
                    "level": r.level, "story": r.story,
                    **({"truth": None if pd.isna(r.actually_malicious) else bool(r.actually_malicious)} if eval_mode else {})}
                   for r in recent.itertuples()],
        **({"truth": truth} if eval_mode else {}),
    }


def _truth_summary(alerts, s, e, replay):
    attacks = hist.attack_days[(hist.attack_days["day"] >= s) & (hist.attack_days["day"] <= e)]
    alerted = attacks.merge(alerts[["user", "day"]], on=["user", "day"])
    real = int(alerts["actually_malicious"].fillna(0).astype(bool).sum())
    f = replay_dir() / "ground_truth.csv"
    if len(replay) and s <= REPLAY_DAY <= e and f.exists():
        gt = pd.read_csv(f, dtype=str)
        attackers = set(gt.loc[gt["attacker"] == "1", "user"])
        flagged = set(replay.loc[replay["risk"] >= hist.levels.cutoffs["Medium"], "user"])
        attacks = pd.concat([attacks, pd.DataFrame({"user": sorted(attackers), "day": REPLAY_DAY})], ignore_index=True)
        alerted = pd.concat([alerted, pd.DataFrame({"user": sorted(attackers & flagged), "day": REPLAY_DAY})], ignore_index=True)
        real += len(attackers & flagged)
    return {"attack_days": int(len(attacks)), "attack_days_alerted": int(len(alerted)),
            "attackers": int(attacks["user"].nunique()), "attackers_alerted": int(alerted["user"].nunique()),
            "alerts": int(len(alerts)), "real_alerts": real}


@app.get("/api/users")
def users(q: str = "", limit: int = 12):
    q = q.strip().upper()
    hits = sorted((u for u in hist.user_ids if q in u), key=lambda u: (not u.startswith(q), u))[:max(1, min(limit, 50))]
    return [{"user": u, "role": hist.role(u)} for u in hits]


@app.get("/api/history/user/{user}")
def history_user(user: str, start: str | None = None, end: str | None = None):
    e = _day(end, REPLAY_DAY if mon.snapshots else hist.last)
    s = _day(start, e - timedelta(days=89))
    t = hist.timeline[(hist.timeline["user"] == user) & (hist.timeline["day"] >= s) & (hist.timeline["day"] <= e)]
    act = hist.activity[(hist.activity["user"] == user) & (hist.activity["day"] >= s) & (hist.activity["day"] <= e)].set_index("day")
    series = [{"day": f"{r.day:%Y-%m-%d}", "risk": float(r.risk), "pct": hist.levels.percentile(r.risk), "stage": int(r.stage),
               **({c: float(act.loc[r.day, c]) for c in ACTIVITY} if r.day in act.index else {})} for r in t.itertuples()]
    replay = _replay_rows()
    if len(replay) and s <= REPLAY_DAY <= e and user in set(replay["user"]):
        d = replay[replay["user"] == user].iloc[0]
        series.append({"day": f"{REPLAY_DAY:%Y-%m-%d}", "risk": float(d["risk"]), "pct": hist.levels.percentile(d["risk"]), "stage": int(d["stage"])})
    a = hist.alerts[(hist.alerts["user"] == user) & (hist.alerts["day"] >= s) & (hist.alerts["day"] <= e)]
    alerts = [{"day": f"{r.day:%Y-%m-%d}", "risk": float(r.risk), "pct": hist.levels.percentile(r.risk), "level": r.level, "story": r.story} for r in a.itertuples()]
    if len(replay) and s <= REPLAY_DAY <= e and user in set(replay["user"]):
        d = replay[replay["user"] == user].iloc[0]
        if d["risk"] >= hist.levels.cutoffs["Medium"]:
            alerts.append({"day": f"{REPLAY_DAY:%Y-%m-%d}", "risk": float(d["risk"]), "pct": hist.levels.percentile(d["risk"]), "level": d["level"], "story": d["story"]})
    if not series:
        raise HTTPException(404, f"no activity for {user} in this period")
    return {"user": user, "role": hist.role(user), "start": f"{s:%Y-%m-%d}", "end": f"{e:%Y-%m-%d}", "cutoffs": hist.levels.cutoffs,
            "series": series, "alerts": sorted(alerts, key=lambda x: x["day"], reverse=True),
            "peak_risk": max(x["risk"] for x in series), "peak_pct": max(x["pct"] for x in series),
            "peak_level": hist.levels.level(max(x["risk"] for x in series)), "max_stage": max(x["stage"] for x in series)}


if DIST.exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/{path:path}")
    def spa(path: str):
        if path.startswith("api/"):
            raise HTTPException(404, "not found")
        root = DIST.resolve()
        f = (root / path).resolve()
        if path and f.is_file() and f.is_relative_to(root):
            return FileResponse(f)
        return FileResponse(root / "index.html", headers={"Cache-Control": "no-cache"})

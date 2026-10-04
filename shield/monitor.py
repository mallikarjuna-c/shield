import io
import json
from datetime import datetime

import lightgbm as lgb
import numpy as np
import pandas as pd

from . import config, ingest
from .replay import COLUMNS, REPLAY_DAY, SLOTS, replay_dir
from .explain import explain
from .features import DEVIATION_COLS, HOUR_COLS, KEYS, SOURCES, build, combine_daily
from .levels import Levels
from .stages import STAGES, track

MAX_COLS = {"email_size_max", "logon_distinct_pc", "usb_distinct_pc", "file_distinct_pc", "http_distinct_domains", "file_distinct"}


class DayMonitor:
    def __init__(self):
        self.model = lgb.Booster(model_file=str(config.MODELS_DIR / "holdout_lgbm.txt"))
        self.features = json.loads((config.MODELS_DIR / "holdout_feature_contract.json").read_text())["features"]
        self.users = pd.read_parquet(config.INTERIM_DIR / "users.parquet")
        self.roles = self.users.set_index("user")["role"]
        self.history = {s: (lambda d: d[d["day"] < REPLAY_DAY])(pd.read_parquet(config.INTERIM_DIR / f"{s}_daily.parquet"))
                        for s in SOURCES}
        self.primary = pd.read_parquet(config.INTERIM_DIR / "primary_pc.parquet").set_index("user")["primary_pc"]
        domains = pd.read_parquet(config.INTERIM_DIR / "domains.parquet")
        limit = ingest.rare_domain_limit(len(self.users))
        self.known_domains = set(domains.loc[domains["users"] > limit, "domain"])
        self.history_risk = pd.read_parquet(config.REPORTS_DIR / "cv_scores.parquet")[["user", "day", "cv_score"]] \
            .rename(columns={"cv_score": "risk"})
        self.peer_stats = self._peer_stats()
        self.levels = Levels.load()
        self.state_dir = replay_dir() / "state"
        self.state_dir.mkdir(exist_ok=True)
        self.events = pd.read_parquet(self.state_dir / "events.parquet") if (self.state_dir / "events.parquet").exists() \
            else pd.DataFrame(columns=COLUMNS)
        self.snapshots = json.loads((self.state_dir / "snapshots.json").read_text()) \
            if (self.state_dir / "snapshots.json").exists() else []

    def _peer_stats(self):
        recent = [h[h["day"] >= REPLAY_DAY - pd.Timedelta(days=30)] for h in self.history.values()]
        table = combine_daily(recent).merge(self.users[["user", "role"]], on="user", how="left")
        return table.groupby("role")[DEVIATION_COLS].agg(["mean", "std"])

    def _apply_peers(self, rows):
        stats = self.peer_stats.reindex(rows["role"].astype(str))
        for c in DEVIATION_COLS:
            mean = stats[(c, "mean")].to_numpy()
            std = np.nan_to_num(stats[(c, "std")].to_numpy())
            rows[f"{c}_zr"] = ((rows[c].to_numpy() - mean) / (std + 1.0)).astype(np.float32)
        return rows

    def reset(self):
        self.events = pd.DataFrame(columns=COLUMNS)
        self.snapshots = []
        for f in self.state_dir.glob("*"):
            f.unlink()

    def _save(self):
        self.events.to_parquet(self.state_dir / "events.parquet", index=False)
        (self.state_dir / "snapshots.json").write_text(json.dumps(self.snapshots))

    def upload(self, name, text):
        df = pd.read_csv(io.StringIO(text), dtype=str, keep_default_na=False)
        missing = {"source", "id", "date", "user"} - set(df.columns)
        if missing:
            raise ValueError(f"missing columns: {', '.join(sorted(missing))}")
        df = df.reindex(columns=COLUMNS).replace("", np.nan)
        bad_src = set(df["source"]) - set(SOURCES)
        if bad_src:
            raise ValueError(f"unknown source(s): {', '.join(sorted(map(str, bad_src)))}")
        ts = pd.to_datetime(df["date"], format=config.DATE_FORMAT, errors="coerce")
        if ts.isna().any():
            raise ValueError(f"{int(ts.isna().sum())} rows have a date not in the format MM/DD/YYYY HH:MM:SS")
        if (ts.dt.normalize() != REPLAY_DAY).any():
            raise ValueError(f"all events must be on {REPLAY_DAY:%d %b %Y}")
        unknown = set(df["user"]) - set(self.users["user"])
        if unknown:
            raise ValueError(f"{len(unknown)} unknown user(s), e.g. {sorted(unknown)[0]}")
        before = len(self.events)
        self.events = pd.concat([self.events, df], ignore_index=True).drop_duplicates("id")
        added = len(self.events) - before
        if added == 0:
            raise ValueError("every event in this file was already uploaded")
        all_ts = pd.to_datetime(self.events["date"], format=config.DATE_FORMAT)
        latest = all_ts.max()
        hour = latest.hour + latest.minute / 60
        as_of = float(next(b for a, b in SLOTS if a <= hour < b))
        snapshot = self._score(as_of)
        snapshot.update(upload=len(self.snapshots) + 1, file=name, new_events=added, total_events=len(self.events),
                        as_of=f"{int(as_of):02d}:00", uploaded_at=datetime.now().isoformat(timespec="seconds"),
                        window=[f"{all_ts[-added:].min():%H:%M}" if added else None, f"{latest:%H:%M}"])
        prev = {u["user"]: u for u in self.snapshots[-1]["users"]} if self.snapshots else {}
        for u in snapshot["users"]:
            u["previous_risk"] = prev[u["user"]]["risk"] if u["user"] in prev else None
            u["previous_percentile"] = prev[u["user"]]["percentile"] if u["user"] in prev else None
        self.snapshots.append(snapshot)
        self._save()
        return snapshot

    def _observed(self):
        ev = self.events.copy()
        ev = ingest.add_time(ev)
        out = {}
        if (s := ev[ev["source"] == "logon"]).size:
            out["logon"] = ingest.aggregate_logon(s, self.primary)
        if (s := ev[ev["source"] == "device"]).size:
            out["device"] = ingest.aggregate_device(s)
        if (s := ev[ev["source"] == "file"]).size:
            out["file"] = ingest.aggregate_file(s)
        if (s := ev[ev["source"] == "email"]).size:
            out["email"] = ingest.aggregate_email(s)
        if (s := ev[ev["source"] == "http"]).size:
            visits = ingest.http_visits(s).reset_index()
            rare = {d for d in visits["domain"] if d not in self.known_domains and d.removeprefix("www.") not in self.known_domains}
            out["http"] = ingest.aggregate_http_visits(visits, rare)
        return {k: v.reset_index() for k, v in out.items()}, ev

    def _usual(self, users):
        out = {}
        for src in SOURCES:
            h = self.history[src]
            h = h[h["user"].isin(users)].sort_values(KEYS).groupby("user").tail(config.BASELINE_WINDOW)
            out[src] = h.drop(columns="day").groupby("user").agg(
                {c: ("median" if c in HOUR_COLS else "mean") for c in h.columns if c not in KEYS})
        return out

    def _project(self, observed, users, as_of):
        usual = self._usual(users)
        start = usual["logon"]["logon_first_hour"].reindex(users).fillna(8.5)
        end = usual["logon"]["logoff_last_hour"].reindex(users).fillna(17.5)
        share = ((end - as_of) / (end - start).clip(lower=1)).clip(0, 1) if as_of < 24 else pd.Series(0.0, index=users)
        frames = []
        for src in SOURCES:
            cols = [c for c in self.history[src].columns if c not in KEYS]
            obs = observed.get(src, pd.DataFrame(columns=KEYS + cols)).set_index("user")[cols].reindex(users)
            exp = usual[src].reindex(users)[cols]
            proj = pd.DataFrame(index=pd.Index(users, name="user"))
            for c in cols:
                o, e = obs[c], exp[c]
                if c == "logon_first_hour":
                    proj[c] = o.where(o.notna(), e.where(share > 0))
                elif c == "logoff_last_hour":
                    proj[c] = np.where(share > 0, np.fmax(o, e), o)
                elif c in MAX_COLS:
                    proj[c] = np.where(share > 0, np.fmax(o.fillna(0), e.fillna(0)), o.fillna(0))
                else:
                    proj[c] = (o.fillna(0) + e.fillna(0) * share).round()
            proj = proj.reset_index()
            proj["day"] = REPLAY_DAY
            frames.append(proj[KEYS + cols])
        return frames

    def _score(self, as_of):
        observed, ev = self._observed()
        users = sorted(set(self.events["user"]))
        projected = self._project(observed, users, as_of)
        frames = [pd.concat([self.history[s][self.history[s]["user"].isin(users)], p], ignore_index=True)
                  for s, p in zip(SOURCES, projected)]
        feats = build(combine_daily(frames), self.users)
        rows = self._apply_peers(feats[feats["day"] == REPLAY_DAY].reset_index(drop=True))
        feats = pd.concat([feats[feats["day"] != REPLAY_DAY], rows], ignore_index=True)
        risk = self.model.predict(rows[self.features])
        stories = explain(rows, self.model, self.features, risk=risk, levels=self.levels)

        hist = feats.merge(self.history_risk, on=KEYS, how="left")
        today = hist["day"] == REPLAY_DAY
        hist.loc[today, "risk"] = hist.loc[today, "user"].map(dict(zip(rows["user"], risk)))
        hist["risk"] = hist["risk"].fillna(0)
        tracked = track(hist, pd.Series(dtype="datetime64[ns]", index=pd.Index([], dtype=object, name="user"), name="departure_day"))
        recent = tracked[tracked["day"] > REPLAY_DAY - pd.Timedelta(days=30)]

        counts = ev.groupby("user").size()
        out = []
        for i, r in rows.iterrows():
            u = r["user"]
            t = tracked[(tracked["user"] == u) & (tracked["day"] == REPLAY_DAY)].iloc[0]
            mine = recent[recent["user"] == u]
            firsts = {STAGES[s]: (mine.loc[mine[f"ev_{s}"] == 1, "day"].min().strftime("%Y-%m-%d")
                                  if (mine[f"ev_{s}"] == 1).any() else None) for s in range(1, 5)}
            firsts[STAGES[5]] = None
            out.append({
                "user": u, "role": str(self.roles.get(u)) if u in self.roles.index else None,
                "risk": float(risk[i]), "level": self.levels.level(risk[i]), "percentile": round(self.levels.percentile(risk[i]), 2),
                "stage": int(t["stage"]), "stage_name": STAGES[int(t["stage"])], "stage_first": firsts,
                "story": stories.iloc[i]["story"], "reasons": json.loads(stories.iloc[i]["reasons"]),
                "events": int(counts.get(u, 0)),
            })
        out.sort(key=lambda x: (-x["risk"], x["user"]))
        lv = pd.Series([u["level"] for u in out])
        return {"users": out, "summary": {"monitored": len(out), "high": int((lv == "High").sum()),
                                          "medium": int((lv == "Medium").sum()), "watch": int((lv == "Watch").sum()),
                                          "normal": int((lv == "Normal").sum()), "staging_plus": sum(1 for u in out if u["stage"] >= 3)}}

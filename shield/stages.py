import logging

import numpy as np
import pandas as pd

from . import config

log = logging.getLogger(__name__)

STAGES = {0: "Normal", 1: "Reconnaissance", 2: "Collection", 3: "Staging", 4: "Exfiltration", 5: "Departure"}
EVIDENCE_GATE = 0.2
WINDOW_DAYS = 30
DEPARTURE_LOOKBACK_DAYS = 60


def _usual(t, col):
    ratio = t[f"{col}_ratio_u"].replace(0, np.nan)
    return ((t[col] + 1) / ratio - 1).clip(lower=0)


def _above_normal(t, col):
    v = t[col]
    usual = _usual(t, col)
    peers = t.get(f"{col}_zr", pd.Series(np.nan, index=t.index))
    clearly_more = usual.isna() | (v > usual * 1.2 + 0.5) | (peers > 1.5) | (t[f"{col}_first_time"] == 1)
    return (v > 0) & clearly_more


def _evidence(t):
    return {
        1: _above_normal(t, "http_job") | _above_normal(t, "http_hack"),
        2: _above_normal(t, "file_n") | (t["logon_after_hours"] > 0) | (t["logon_other_pc"] > 0),
        3: _above_normal(t, "usb_n") | (t["usb_after_hours"] > 0) | (t["file_zip"] > 0) | (t["file_exe"] > 0),
        4: (t["http_leak"] > 0) | _above_normal(t, "http_cloud") | _above_normal(t, "email_ext_attachments"),
    }


def _departures(t):
    ldap = sorted((config.release_dir() / "LDAP").glob("*.csv"))
    final = set(pd.read_csv(ldap[-1], dtype=str)["user_id"])
    return t.loc[~t["user"].isin(final)].groupby("user")["day"].max().rename("departure_day")


def track(t, departures=None):
    t = t.sort_values(["user", "day"]).reset_index(drop=True)
    suspicious = t["risk"] >= EVIDENCE_GATE
    current = pd.Series(0, index=t.index)
    for stage, flag in _evidence(t).items():
        counted = flag & suspicious
        t[f"ev_{stage}"] = counted.astype(np.int8)
        last_seen = t["day"].where(counted).groupby(t["user"]).ffill()
        active = (t["day"] - last_seen).dt.days.le(WINDOW_DAYS)
        current = current.where(~active, stage)
    t["stage"] = current.astype(np.int8)

    dep = _departures(t) if departures is None else departures
    t = t.merge(dep, left_on="user", right_index=True, how="left")
    recent = t["stage"].groupby(t["user"]).transform(
        lambda s: s.rolling(DEPARTURE_LOOKBACK_DAYS, min_periods=1).max())
    leaving = (t["day"] == t["departure_day"]) & (recent >= 1)
    t.loc[leaving, "stage"] = 5
    t["stage_name"] = t["stage"].map(STAGES)
    t["escalated"] = (t["stage"] > t.groupby("user")["stage"].shift(1).fillna(0)).astype(np.int8)
    return t


def _summary(t, insiders):
    rows = []
    for user, g in t.groupby("user"):
        reached = {s: g.loc[g[f"ev_{s}"] == 1, "day"].min() for s in range(1, 5)}
        reached[5] = g.loc[g["stage"] == 5, "day"].min()
        row = {"user": user, "max_stage": int(g["stage"].max()), "max_stage_name": STAGES[int(g["stage"].max())],
               "escalations": int(g["escalated"].sum()), "max_risk": round(float(g["risk"].max()), 4)}
        for s in range(1, 6):
            row[f"first_{STAGES[s].lower()}"] = reached[s].date() if pd.notna(reached[s]) else None
        if user in insiders.index:
            ins = insiders.loc[user]
            start = pd.to_datetime(ins["start"], format=config.DATE_FORMAT).normalize()
            end = pd.to_datetime(ins["end"], format=config.DATE_FORMAT).normalize()
            row.update(insider=1, scenario=int(ins["scenario"]), attack_start=start.date(), attack_end=end.date())
            if pd.notna(reached[3]):
                row["staging_days_before_attack_end"] = int((end - reached[3]).days)
        else:
            row.update(insider=0)
        rows.append(row)
    return pd.DataFrame(rows).sort_values(["max_stage", "max_risk"], ascending=False)


def _bar(row):
    parts = []
    for s in range(1, 6):
        d = row[f"first_{STAGES[s].lower()}"]
        parts.append(f"{'[x]' if pd.notna(d) and d is not None else '[ ]'} {STAGES[s]}" + (f" {d}" if pd.notna(d) and d is not None else ""))
    return " > ".join(parts)


def run():
    feats = pd.read_parquet(config.FEATURES_DIR / "user_day.parquet")
    scores = pd.read_parquet(config.REPORTS_DIR / "cv_scores.parquet")[["user", "day", "cv_score"]]
    t = feats.merge(scores, on=["user", "day"]).rename(columns={"cv_score": "risk"})
    t = track(t)

    insiders = pd.read_csv(config.answers_dir() / "insiders.csv", dtype=str)
    insiders = insiders[insiders["dataset"].str.strip() == config.RELEASE.lstrip("r")].set_index("user")
    summary = _summary(t, insiders)

    t.loc[t["escalated"] == 1, ["user", "day", "stage", "stage_name", "risk", "label", "scenario"]] \
        .to_csv(config.REPORTS_DIR / "stage_escalations.csv", index=False)
    t[["user", "day", "risk", "stage", "stage_name", "escalated", "label"]] \
        .to_parquet(config.REPORTS_DIR / "stage_timeline.parquet", index=False)
    summary.to_csv(config.REPORTS_DIR / "stage_users.csv", index=False)

    ins, non = summary[summary["insider"] == 1], summary[summary["insider"] == 0]
    lines = ["# Shield attack stages", ""]
    lines.append("| Highest stage reached | Insiders (of %d) | Other users (of %d) |" % (len(ins), len(non)))
    lines.append("|---|---|---|")
    for s in range(5, -1, -1):
        lines.append(f"| {s} {STAGES[s]} | {int((ins['max_stage'] == s).sum())} | {int((non['max_stage'] == s).sum())} |")
    lines.append("")
    for _, r in summary.head(15).iterrows():
        who = f"insider, scenario {int(r['scenario'])}, attack {r['attack_start']} to {r['attack_end']}" if r["insider"] else "not an insider"
        lines += [f"**{r['user']}** ({who}): highest stage {r['max_stage_name']}", "", _bar(r), ""]
    (config.REPORTS_DIR / "stages.md").write_text("\n".join(lines), encoding="utf-8")

    log.info("Highest stage reached (insiders / other users):")
    for s in range(5, -1, -1):
        log.info("  %d %-14s %3d / %3d", s, STAGES[s], int((ins["max_stage"] == s).sum()), int((non["max_stage"] == s).sum()))
    staged = ins["staging_days_before_attack_end"].dropna()
    log.info("Insiders reaching Staging or beyond: %d/%d; median %.0f days before their attack ended",
             int((ins["max_stage"] >= 3).sum()), len(ins), staged.median() if len(staged) else float("nan"))
    log.info("Other users reaching Staging or beyond: %d/%d", int((non["max_stage"] >= 3).sum()), len(non))
    for sc, g in ins.groupby("scenario"):
        log.info("  scenario %d: %d/%d reached Staging+; evidence seen: recon %d, collection %d, staging %d, exfiltration %d, departure %d",
                 sc, int((g["max_stage"] >= 3).sum()), len(g),
                 *[int(g[f"first_{STAGES[k].lower()}"].notna().sum()) for k in range(1, 6)])
    log.info("Saved stage_users.csv, stage_escalations.csv, stage_timeline.parquet, stages.md")
    return summary

import csv
import json
import logging

import numpy as np
import pandas as pd

from . import config
from .train import NON_FEATURES, fit

log = logging.getLogger(__name__)

REPLAY_DAY = pd.Timestamp("2011-05-18")
N_USERS = 100
SLOTS = [(0, 10), (10, 12), (12, 14), (14, 17), (17, 24)]
ATTACKS = [
    ("PSF0133", "2010-09-01", 2),
    ("FSC0601", "2011-03-03", 2),
    ("BBS0039", "2010-08-12", 3),
    ("AJR0932", "2010-09-10", 1),
    ("BIH0745", "2010-07-13", 1),
]
COLUMNS = ["source", "id", "date", "user", "pc", "activity", "filename", "url", "to", "cc", "bcc", "from", "size", "attachments"]
RAW_COLUMNS = {
    "logon": ["id", "date", "user", "pc", "activity"],
    "device": ["id", "date", "user", "pc", "activity"],
    "file": ["id", "date", "user", "pc", "filename"],
    "email": ["id", "date", "user", "pc", "to", "cc", "bcc", "from", "size", "attachments"],
    "http": ["id", "date", "user", "pc", "url"],
}
DETAIL_FIELDS = {
    "logon": ["activity"], "device": ["activity"], "file": ["filename"], "http": ["url"],
    "email": ["to", "cc", "bcc", "from", "size", "attachments"],
}


def replay_dir():
    d = config.DATA_DIR / "replay" / f"{REPLAY_DAY:%Y-%m-%d}"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _ldap_emails():
    last = sorted((config.release_dir() / "LDAP").glob("*.csv"))[-1]
    df = pd.read_csv(last, dtype=str)
    return set(df["user_id"]), dict(zip(df["user_id"], df["email"]))


def _pick_users(insiders):
    logon = pd.read_parquet(config.INTERIM_DIR / "logon_daily.parquet")
    labels = pd.read_parquet(config.INTERIM_DIR / "labels.parquet")
    still_employed, _ = _ldap_emails()
    recent = logon[logon["day"] > REPLAY_DAY - pd.Timedelta(days=8)]
    excluded = insiders | set(labels["user"])
    pool = sorted(set(recent["user"]) & still_employed - excluded)
    rng = np.random.default_rng(config.SEED + 18)
    users = sorted(rng.choice(pool, size=N_USERS, replace=False))
    last_day = logon[logon["user"].isin(users)].groupby("user")["day"].max()
    attackers = sorted(rng.choice(users, size=len(ATTACKS), replace=False))
    return users, last_day, dict(zip(attackers, ATTACKS))


def _redate(dates):
    t = pd.to_datetime(dates, format=config.DATE_FORMAT)
    return (REPLAY_DAY + (t - t.dt.normalize())).dt.strftime(config.DATE_FORMAT)


def _background(users, last_day):
    wanted = {(u, f"{d:%m/%d/%Y}") for u, d in last_day.items()}
    frames = []
    for src, cols in RAW_COLUMNS.items():
        log.info("  reading %s.csv for %d user-days", src, len(wanted))
        for chunk in pd.read_csv(config.release_dir() / f"{src}.csv", usecols=cols, dtype=str,
                                 chunksize=config.CHUNK_ROWS, on_bad_lines="skip", encoding_errors="replace"):
            keep = chunk[chunk["user"].isin(users)]
            keep = keep[[(u, d[:10]) in wanted for u, d in zip(keep["user"], keep["date"])]]
            if len(keep):
                frames.append(keep.assign(source=src))
    bg = pd.concat(frames, ignore_index=True)
    bg["date"] = _redate(bg["date"])
    return bg


def _attack_events(target, insider, day, scenario, primary, emails):
    path = config.answers_dir() / f"{config.RELEASE}-{scenario}" / f"{config.RELEASE}-{scenario}-{insider}.csv"
    insider_pc = primary.get(insider)
    rows = []
    for rec in csv.reader(open(path, encoding="utf-8", errors="replace")):
        if len(rec) < 5 or rec[3] != insider or not rec[2].startswith(pd.Timestamp(day).strftime("%m/%d/%Y")):
            continue
        src = rec[0]
        row = {"source": src, "id": rec[1], "date": rec[2], "user": target,
               "pc": primary.get(target) if rec[4] == insider_pc else rec[4]}
        row.update(dict(zip(DETAIL_FIELDS[src], rec[5:5 + len(DETAIL_FIELDS[src])])))
        if src == "email":
            row["from"] = emails.get(target, row.get("from"))
        rows.append(row)
    ev = pd.DataFrame(rows)
    ev["date"] = _redate(ev["date"])
    return ev


def _train_holdout_model():
    df = pd.read_parquet(config.FEATURES_DIR / "user_day.parquet")
    sources = {a[0] for a in ATTACKS}
    train = df[~df["user"].isin(sources)]
    features = [c for c in df.columns if c not in NON_FEATURES]
    log.info("Training holdout model without the %d replayed insiders (%s user-days)", len(sources), f"{len(train):,}")
    model = fit(train, features)
    model.save_model(str(config.MODELS_DIR / "holdout_lgbm.txt"))
    (config.MODELS_DIR / "holdout_feature_contract.json").write_text(json.dumps(
        {"features": features, "excluded_insiders": sorted(sources), "replay_day": f"{REPLAY_DAY:%Y-%m-%d}"}, indent=2))


def run():
    ins = pd.read_csv(config.answers_dir() / "insiders.csv", dtype=str)
    insiders = set(ins.loc[ins["dataset"].str.strip() == config.RELEASE.lstrip("r"), "user"])
    users, last_day, attackers = _pick_users(insiders)
    primary = pd.read_parquet(config.INTERIM_DIR / "primary_pc.parquet").set_index("user")["primary_pc"]
    _, emails = _ldap_emails()
    log.info("Replay day %s: %d employees, %d attackers", f"{REPLAY_DAY:%Y-%m-%d}", len(users), len(attackers))

    bg = _background(users, last_day)
    attacks = [_attack_events(t, *a, primary, emails) for t, a in attackers.items()]
    events = pd.concat([bg] + attacks, ignore_index=True).reindex(columns=COLUMNS)
    events["ts"] = pd.to_datetime(events["date"], format=config.DATE_FORMAT)
    events = events.sort_values("ts")

    out = replay_dir()
    for f in out.glob("upload_*.csv"):
        f.unlink()
    hours = events["ts"].dt.hour + events["ts"].dt.minute / 60
    for i, (a, b) in enumerate(SLOTS, 1):
        part = events[(hours >= a) & (hours < b)].drop(columns="ts")
        part.to_csv(out / f"upload_{i}_{a:02d}00-{b:02d}00.csv", index=False)
        log.info("  upload %d (%02d:00-%02d:00): %s events", i, a, b, f"{len(part):,}")

    truth = pd.DataFrame({"user": users})
    truth["attacker"] = truth["user"].isin(attackers).astype(int)
    truth["replayed_insider"] = truth["user"].map({t: a[0] for t, a in attackers.items()})
    truth["source_day"] = truth["user"].map({t: a[1] for t, a in attackers.items()})
    truth["scenario"] = truth["user"].map({t: a[2] for t, a in attackers.items()})
    truth["background_from_day"] = truth["user"].map(lambda u: f"{last_day[u]:%Y-%m-%d}")
    truth.to_csv(out / "ground_truth.csv", index=False)
    log.info("  attackers: %s", ", ".join(f"{t} <- {a[0]} (scenario {a[2]})" for t, a in attackers.items()))
    _train_holdout_model()
    log.info("Saved uploads and ground_truth.csv to %s", out)

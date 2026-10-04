"""Preprocessing: turn raw CERT event logs into one row per (user, day) per source.

Large files (email, http) are streamed in chunks so memory stays bounded.
"""
import logging
import re

import numpy as np
import pandas as pd

from . import config

log = logging.getLogger(__name__)

KEYS = ["user", "day"]


def _read(source, usecols, chunksize=None):
    path = config.release_dir() / f"{source}.csv"
    return pd.read_csv(path, usecols=usecols, chunksize=chunksize, dtype=str, on_bad_lines="skip",
                       encoding="utf-8", encoding_errors="replace")


def add_time(df):
    ts = pd.to_datetime(df["date"], format=config.DATE_FORMAT, errors="coerce")
    bad = int(ts.isna().sum())
    if bad:
        log.warning("  dropped %d rows with unparseable dates", bad)
    df = df[ts.notna()].copy()
    ts = ts[ts.notna()]
    df["day"] = ts.dt.normalize()
    hour = ts.dt.hour
    df["after_hours"] = ((hour < config.WORK_START_HOUR) | (hour >= config.WORK_END_HOUR)).astype(np.int32)
    df["weekend"] = (ts.dt.dayofweek >= 5).astype(np.int32)
    df["hour"] = hour + ts.dt.minute / 60
    return df.drop(columns="date")


def _save(df, name):
    df = df.reset_index() if not set(KEYS).issubset(df.columns) else df
    path = config.INTERIM_DIR / f"{name}.parquet"
    df.to_parquet(path, index=False)
    log.info("  saved %s: %s rows", path.name, f"{len(df):,}")


def users():
    """Latest role/department per user from the monthly LDAP snapshots, plus psychometrics."""
    log.info("Reading LDAP snapshots")
    frames = []
    for path in sorted((config.release_dir() / "LDAP").glob("*.csv")):
        df = pd.read_csv(path, dtype=str)
        df["month"] = pd.to_datetime(path.stem, format="%Y-%m")
        frames.append(df)
    df = pd.concat(frames)
    df.columns = [c.strip().lower() for c in df.columns]
    df = df.rename(columns={"user_id": "user"}).sort_values("month")
    latest = df.drop_duplicates("user", keep="last").set_index("user")
    out = latest[[c for c in ("role", "functional_unit", "department") if c in latest.columns]].copy()

    psych = config.release_dir() / "psychometric.csv"
    if psych.exists():
        p = pd.read_csv(psych, dtype={"user_id": str}).rename(columns={"user_id": "user"}).set_index("user")
        out = out.join(p[["O", "C", "E", "A", "N"]])
    _save(out, "users")


def aggregate_logon(df, primary):
    is_on = df["activity"].str.lower() == "logon"
    df = df.assign(other_pc=(df["pc"] != df["user"].map(primary)).astype(np.int32))
    g = df[is_on].groupby(KEYS)
    out = pd.DataFrame({
        "logon_n": g.size(),
        "logon_after_hours": g["after_hours"].sum(),
        "logon_weekend": g["weekend"].sum(),
        "logon_other_pc": g["other_pc"].sum(),
        "logon_distinct_pc": g["pc"].nunique(),
        "logon_first_hour": g["hour"].min(),
    })
    off = df[~is_on].groupby(KEYS)
    return out.join(pd.DataFrame({
        "logoff_n": off.size(),
        "logoff_after_hours": off["after_hours"].sum(),
        "logoff_last_hour": off["hour"].max(),
    }), how="outer")


def logon():
    log.info("Aggregating logon.csv")
    df = add_time(_read("logon", ["date", "user", "pc", "activity"]))
    on = df[df["activity"].str.lower() == "logon"]
    primary = on.groupby(["user", "pc"]).size().reset_index(name="n")
    primary = primary.sort_values("n").drop_duplicates("user", keep="last").set_index("user")["pc"]
    primary.rename("primary_pc").reset_index().to_parquet(config.INTERIM_DIR / "primary_pc.parquet", index=False)
    _save(aggregate_logon(df, primary), "logon_daily")


def aggregate_device(df):
    df = df[df["activity"].str.lower() == "connect"]
    g = df.groupby(KEYS)
    return pd.DataFrame({
        "usb_n": g.size(),
        "usb_after_hours": g["after_hours"].sum(),
        "usb_weekend": g["weekend"].sum(),
        "usb_distinct_pc": g["pc"].nunique(),
    })


def device():
    log.info("Aggregating device.csv")
    _save(aggregate_device(add_time(_read("device", ["date", "user", "pc", "activity"]))), "device_daily")


def aggregate_file(df):
    ext = df["filename"].fillna("").str.extract(r"\.([A-Za-z0-9]+)$", expand=False).str.lower()
    df = df.assign(**{f"file_{e}": (ext == e).astype(np.int32) for e in config.FILE_EXTENSIONS})
    g = df.groupby(KEYS)
    out = pd.DataFrame({
        "file_n": g.size(),
        "file_after_hours": g["after_hours"].sum(),
        "file_distinct": g["filename"].nunique(),
        "file_distinct_pc": g["pc"].nunique(),
    })
    return out.join(g[[f"file_{e}" for e in config.FILE_EXTENSIONS]].sum())


def file():
    log.info("Aggregating file.csv")
    _save(aggregate_file(add_time(_read("file", ["date", "user", "pc", "filename"]))), "file_daily")


def _count_addresses(series):
    return series.fillna("").str.count("@")


def _count_external(series):
    s = series.fillna("")
    return s.str.count("@") - s.str.count("@" + re.escape(config.ORG_EMAIL_DOMAIN))


def _email_part(df):
    df = df.copy()
    df["n_to"] = sum(_count_addresses(df[c]) for c in ("to", "cc", "bcc"))
    df["n_ext"] = sum(_count_external(df[c]) for c in ("to", "cc", "bcc"))
    df["n_bcc"] = _count_addresses(df["bcc"])
    df["has_ext"] = (df["n_ext"] > 0).astype(np.int32)
    df["from_personal"] = (~df["from"].fillna("").str.contains(config.ORG_EMAIL_DOMAIN, regex=False)).astype(np.int32)
    df["size"] = pd.to_numeric(df["size"], errors="coerce").fillna(0)
    df["attachments"] = pd.to_numeric(df["attachments"], errors="coerce").fillna(0)
    df["ext_attach"] = df["attachments"] * df["has_ext"]
    return df.groupby(KEYS).agg(
        email_n=("size", "size"),
        email_after_hours=("after_hours", "sum"),
        email_recipients=("n_to", "sum"),
        email_ext_recipients=("n_ext", "sum"),
        email_to_ext=("has_ext", "sum"),
        email_bcc=("n_bcc", "sum"),
        email_from_personal=("from_personal", "sum"),
        email_size=("size", "sum"),
        email_size_max=("size", "max"),
        email_attachments=("attachments", "sum"),
        email_ext_attachments=("ext_attach", "sum"),
    )


def _combine_email(parts):
    out = pd.concat(parts)
    sums = [c for c in out.columns if c != "email_size_max"]
    return out.groupby(level=KEYS).agg({**{c: "sum" for c in sums}, "email_size_max": "max"})


def aggregate_email(df):
    return _combine_email([_email_part(df)])


def email():
    log.info("Aggregating email.csv (chunked)")
    parts = []
    cols = ["date", "user", "to", "cc", "bcc", "from", "size", "attachments"]
    for i, chunk in enumerate(_read("email", cols, chunksize=config.CHUNK_ROWS)):
        parts.append(_email_part(add_time(chunk)))
        log.info("  chunk %d: %s rows", i + 1, f"{len(chunk):,}")
    _save(_combine_email(parts), "email_daily")


def http_visits(df):
    url = df["url"].fillna("").str.lower()
    df = df.assign(domain=url.str.extract(r"^(?:[a-z]+://)?([^/]+)", expand=False).fillna(""),
                   **{f"kw_{n}": url.str.contains("|".join(map(re.escape, w))).astype(np.int32)
                      for n, w in config.URL_KEYWORDS.items()})
    g = df.groupby(KEYS + ["domain"])
    agg = g[["after_hours"] + [f"kw_{n}" for n in config.URL_KEYWORDS]].sum()
    agg["n"] = g.size()
    return agg


def aggregate_http_visits(visits, rare_domains):
    visits = visits.copy()
    visits["rare"] = visits["domain"].isin(rare_domains).astype(np.int32)
    visits["rare_n"] = visits["n"] * visits["rare"]
    g = visits.groupby(KEYS)
    out = pd.DataFrame({
        "http_n": g["n"].sum(),
        "http_after_hours": g["after_hours"].sum(),
        "http_distinct_domains": g.size(),
        "http_rare_visits": g["rare_n"].sum(),
        "http_rare_domains": g["rare"].sum(),
    })
    for name in config.URL_KEYWORDS:
        out[f"http_{name}"] = g[f"kw_{name}"].sum()
    return out


def rare_domain_limit(n_users):
    return max(1, config.RARE_DOMAIN_USER_SHARE * n_users)


def http():
    log.info("Aggregating http.csv (chunked; the 14 GB file, this is the slow step)")
    parts = []
    for i, chunk in enumerate(_read("http", ["date", "user", "url"], chunksize=config.CHUNK_ROWS)):
        parts.append(http_visits(add_time(chunk)))
        log.info("  chunk %d: %s rows", i + 1, f"{len(chunk):,}")
    visits = pd.concat(parts).groupby(level=KEYS + ["domain"]).sum().reset_index()
    domain_users = visits.groupby("domain")["user"].nunique().rename("users")
    domain_users.reset_index().to_parquet(config.INTERIM_DIR / "domains.parquet", index=False)
    limit = rare_domain_limit(visits["user"].nunique())
    _save(aggregate_http_visits(visits, set(domain_users[domain_users <= limit].index)), "http_daily")


STEPS = {"users": users, "logon_daily": logon, "device_daily": device,
         "file_daily": file, "email_daily": email, "http_daily": http}


def run(force=False):
    for name, step in STEPS.items():
        if not force and (config.INTERIM_DIR / f"{name}.parquet").exists():
            log.info("Skipping %s (already built)", name)
            continue
        step()

"""Feature extraction: join the per-source daily aggregates into one training table.

Beyond raw daily counts, each activity is compared with
  * the user's own recent history (rolling baseline, past days only), and
  * the same role's typical behaviour on that day,
because insider activity shows up as a change in behaviour, not a raw volume.
"""
import logging

import numpy as np
import pandas as pd

from . import config

log = logging.getLogger(__name__)

KEYS = ["user", "day"]
SOURCES = ["logon", "device", "file", "email", "http"]
HOUR_COLS = ["logon_first_hour", "logoff_last_hour"]

# Activity columns that get baseline / peer deviation features.
DEVIATION_COLS = [
    "logon_n", "logon_after_hours", "logon_other_pc", "logon_distinct_pc",
    "usb_n", "usb_after_hours",
    "file_n", "file_after_hours", "file_distinct", "file_exe", "file_zip", "file_doc",
    "email_n", "email_ext_recipients", "email_to_ext", "email_attachments", "email_ext_attachments",
    "email_after_hours", "email_size",
    "http_n", "http_after_hours", "http_rare_visits", "http_job", "http_leak", "http_hack", "http_cloud",
]


def combine_daily(frames):
    table = None
    for df in frames:
        df = df.reset_index() if not set(KEYS).issubset(df.columns) else df
        table = df if table is None else table.merge(df, on=KEYS, how="outer")
    counts = [c for c in table.columns if c not in KEYS + HOUR_COLS]
    table[counts] = table[counts].fillna(0).astype(np.float32)
    return table.sort_values(KEYS).reset_index(drop=True)


def _load_daily():
    return combine_daily([pd.read_parquet(config.INTERIM_DIR / f"{src}_daily.parquet") for src in SOURCES])


def _add_baseline(table):
    """Compare each day with the same user's previous BASELINE_WINDOW days (never the future)."""
    g = table.groupby("user", sort=False)
    new = {}
    for col in DEVIATION_COLS:
        roll = g[col].shift(1).groupby(table["user"]).rolling(config.BASELINE_WINDOW, min_periods=config.BASELINE_MIN_PERIODS)
        mean = roll.mean().reset_index(level=0, drop=True)
        std = roll.std().reset_index(level=0, drop=True)
        new[f"{col}_zu"] = ((table[col] - mean) / (std + 1.0)).astype(np.float32)
        new[f"{col}_ratio_u"] = ((table[col] + 1.0) / (mean + 1.0)).astype(np.float32)
        # First time this user has ever done this kind of activity.
        before = g[col].cumsum() - table[col]
        new[f"{col}_first_time"] = ((before == 0) & (table[col] > 0)).astype(np.int8)
    for col in HOUR_COLS:
        med = g[col].shift(1).groupby(table["user"]).rolling(config.BASELINE_WINDOW, min_periods=config.BASELINE_MIN_PERIODS).median()
        new[f"{col}_shift"] = (table[col] - med.reset_index(level=0, drop=True)).astype(np.float32)
    return pd.concat([table, pd.DataFrame(new, index=table.index)], axis=1)


def _add_peer(table):
    """Compare each day with users in the same role on the same day."""
    grp = table.groupby(["role", "day"], observed=True)
    new = {}
    for col in DEVIATION_COLS:
        mean = grp[col].transform("mean")
        std = grp[col].transform("std").fillna(0)
        new[f"{col}_zr"] = ((table[col] - mean) / (std + 1.0)).astype(np.float32)
    return pd.concat([table, pd.DataFrame(new, index=table.index)], axis=1)


def build(table, users):
    table = table.merge(users, on="user", how="left")
    table["dow"] = table["day"].dt.dayofweek.astype(np.int8)
    table["is_weekend"] = (table["dow"] >= 5).astype(np.int8)
    table["days_active"] = table.groupby("user").cumcount().astype(np.int32)
    table = _add_baseline(table)
    table = _add_peer(table)
    for c in ("role", "functional_unit", "department"):
        if c in table.columns:
            table[c] = table[c].astype("category")
    return table


def run():
    log.info("Building feature table")
    table = _load_daily()
    log.info("  %s user-days, %d users", f"{len(table):,}", table["user"].nunique())
    table = build(table, pd.read_parquet(config.INTERIM_DIR / "users.parquet"))

    labels = pd.read_parquet(config.INTERIM_DIR / "labels.parquet")
    table = table.merge(labels[KEYS + ["label", "scenario"]], on=KEYS, how="left")
    table["label"] = table["label"].fillna(0).astype(np.int8)
    table["scenario"] = table["scenario"].fillna(0).astype(np.int8)
    missing = len(labels) - int(table["label"].sum())
    if missing:
        log.warning("  %d labelled user-days had no activity rows", missing)

    path = config.FEATURES_DIR / "user_day.parquet"
    table.to_parquet(path, index=False)
    log.info("  saved %s: %s rows x %d columns, %d malicious user-days (%.3f%%)",
             path.name, f"{len(table):,}", table.shape[1], int(table["label"].sum()), 100 * table["label"].mean())

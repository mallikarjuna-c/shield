"""Build (user, day) ground-truth labels from the CERT answer key.

The answer key lists, for each malicious insider, a CSV of the exact log events
that belong to their attack. Any user-day containing one of those events is a
positive; every other user-day is negative.
"""
import csv
import logging
from datetime import datetime

import pandas as pd

from . import config

log = logging.getLogger(__name__)


def run():
    answers = config.answers_dir()
    insiders = pd.read_csv(answers / "insiders.csv", dtype=str)
    insiders.columns = [c.strip().lower() for c in insiders.columns]
    insiders = insiders[insiders["dataset"].str.strip() == config.RELEASE.lstrip("r")]
    log.info("Answer key: %d insiders in %s, by scenario %s", len(insiders), config.RELEASE,
             insiders["scenario"].value_counts().sort_index().to_dict())

    rows = []
    for _, ins in insiders.iterrows():
        name = ins["details"].strip()
        detail = answers / f"{config.RELEASE}-{ins['scenario'].strip()}" / name
        if not detail.exists():
            matches = list(answers.rglob(name))
            if not matches:
                log.warning("  missing detail file %s", name)
                continue
            detail = matches[0]
        with open(detail, encoding="utf-8", errors="replace") as fh:
            for rec in csv.reader(fh):
                if len(rec) < 4:
                    continue
                try:
                    ts = datetime.strptime(rec[2].strip(), config.DATE_FORMAT)
                except ValueError:
                    continue
                rows.append((rec[3].strip(), pd.Timestamp(ts).normalize(), int(ins["scenario"])))

    labels = pd.DataFrame(rows, columns=["user", "day", "scenario"]).drop_duplicates(["user", "day"])
    labels["label"] = 1
    labels.to_parquet(config.INTERIM_DIR / "labels.parquet", index=False)
    log.info("  %d malicious user-days across %d users", len(labels), labels["user"].nunique())

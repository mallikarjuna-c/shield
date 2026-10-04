"""Central configuration for the Shield insider-threat pipeline."""
import os
from pathlib import Path

PROJECT_DIR = Path(__file__).resolve().parent.parent

# Data lives outside the (OneDrive-synced) project folder; ~15 GB raw.
# SHIELD_ROOT points everything at a throwaway directory for smoke tests.
if "SHIELD_ROOT" in os.environ:
    PROJECT_DIR = Path(os.environ["SHIELD_ROOT"])
    DATA_DIR = PROJECT_DIR / "data"
else:
    DATA_DIR = Path(os.environ.get("SHIELD_DATA_DIR", Path.home() / "shield_data"))

RAW_DIR = DATA_DIR / "raw"            # CERT release in RAW_DIR / RELEASE, answer key in RAW_DIR / "answers"
INTERIM_DIR = DATA_DIR / "interim"    # per-source daily aggregates
FEATURES_DIR = DATA_DIR / "features"  # final user-day training table
MODELS_DIR = PROJECT_DIR / "models"
REPORTS_DIR = PROJECT_DIR / "reports"

RELEASE = "r4.2"
DATE_FORMAT = "%m/%d/%Y %H:%M:%S"
CHUNK_ROWS = 2_000_000

# Working hours used for the after-hours flags.
WORK_START_HOUR = 7
WORK_END_HOUR = 19

ORG_EMAIL_DOMAIN = "dtaa.com"

# Keyword groups matched against visited URLs.
URL_KEYWORDS = {
    "job": ["job", "career", "recruit", "resume", "hiring", "monster", "indeed", "headhunt"],
    "leak": ["wikileaks", "leak"],
    "hack": ["keylog", "spyware", "hack", "exploit", "crack"],
    "cloud": ["dropbox", "drive", "box.com", "upload", "mega", "sendspace", "file"],
}

FILE_EXTENSIONS = ["doc", "pdf", "txt", "jpg", "zip", "exe"]

# A domain is "rare" if at most this share of users ever visited it.
RARE_DOMAIN_USER_SHARE = 0.01

# Personal-baseline window (days) for deviation features.
BASELINE_WINDOW = 30
BASELINE_MIN_PERIODS = 5

EXCLUDED_FEATURES = [
    "http_n", "http_n_zu", "http_n_ratio_u", "http_n_first_time", "http_n_zr",
    "days_active", "O", "C", "E", "A", "N",
    "role", "functional_unit", "department",
    *[b + s for b in ("logon_n", "logoff_n", "email_n", "email_recipients", "http_distinct_domains")
      for s in ("", "_zu", "_ratio_u", "_first_time", "_zr")],
]

SEED = 42
N_FOLDS = 5

LGBM_PARAMS = {
    "objective": "binary",
    "learning_rate": 0.03,
    "num_leaves": 31,
    "min_child_samples": 20,
    "feature_fraction": 0.7,
    "bagging_fraction": 0.8,
    "bagging_freq": 1,
    "lambda_l2": 1.0,
    "verbose": -1,
    "seed": SEED,
}
NUM_BOOST_ROUND = 800

for _d in (INTERIM_DIR, FEATURES_DIR, MODELS_DIR, REPORTS_DIR):
    _d.mkdir(parents=True, exist_ok=True)


def release_dir() -> Path:
    return RAW_DIR / RELEASE


def answers_dir() -> Path:
    return RAW_DIR / "answers"

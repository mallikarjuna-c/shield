import json
import logging

import numpy as np
import pandas as pd

from . import config
from .train import NON_FEATURES, _insiders, _metrics, fit

log = logging.getLogger(__name__)

TIME_CUTOFF = pd.Timestamp("2011-01-01")
LOCKED_SHARE = 0.2
BUDGETS = {"Medium+": 0.01, "High": 0.002}


def _locked_users(df):
    rng = np.random.default_rng(config.SEED + 1000)
    per_user = df.groupby("user")["label"].max()
    locked = set()
    for flag in (0, 1):
        pool = per_user.index[per_user == flag].to_numpy()
        locked |= set(rng.choice(pool, size=round(len(pool) * LOCKED_SHARE), replace=False))
    return df["user"].isin(locked)


def _confusion(test, share):
    threshold = float(test["score"].quantile(1 - share))
    pred = test["score"] >= threshold
    y = test["label"] == 1
    tp, fp, fn = int((pred & y).sum()), int((pred & ~y).sum()), int((~pred & y).sum())
    return {"budget": share, "threshold": threshold, "alerts": int(pred.sum()), "true_alerts": tp, "false_alerts": fp,
            "missed_malicious_days": fn, "precision": tp / max(tp + fp, 1), "recall": tp / max(tp + fn, 1)}


def _run_test(name, df, train_mask, test_mask, features, insiders):
    train, test = df[train_mask], df[test_mask].copy()
    model = fit(train, features)
    test["score"] = model.predict(test[features])
    result = _metrics(test, "score", insiders)
    result["at_budget"] = {level: _confusion(test, share) for level, share in BUDGETS.items()}
    result["train"] = {"user_days": int(train_mask.sum()), "users": int(df.loc[train_mask, "user"].nunique()),
                       "malicious_days": int(df.loc[train_mask, "label"].sum())}
    result["test"] = {"user_days": int(test_mask.sum()), "users": int(test["user"].nunique()),
                      "malicious_days": int(test["label"].sum())}
    d, u = result["user_day"], result["user"]
    log.info("%s", name)
    log.info("  train: %s user-days (%d users, %d malicious) | test: %s user-days (%d users, %d malicious)",
             f"{result['train']['user_days']:,}", result["train"]["users"], result["train"]["malicious_days"],
             f"{result['test']['user_days']:,}", result["test"]["users"], result["test"]["malicious_days"])
    log.info("  user-day PR-AUC %.3f (random %.4f), ROC-AUC %.3f | user ROC-AUC %.3f, insiders in top 50: %d/%d",
             d["pr_auc"], d["random_pr_auc"], d["roc_auc"], u["roc_auc"], u["insiders_in_top_50"], u["insiders"])
    for level, c in result["at_budget"].items():
        log.info("  %-7s riskiest %.1f%%: %d alerts, %d correct, %d false, %d malicious days missed (precision %.2f, recall %.2f)",
                 level, 100 * c["budget"], c["alerts"], c["true_alerts"], c["false_alerts"], c["missed_malicious_days"],
                 c["precision"], c["recall"])
    return result


def run():
    df = pd.read_parquet(config.FEATURES_DIR / "user_day.parquet")
    features = [c for c in df.columns if c not in NON_FEATURES]
    insiders = _insiders()
    locked = _locked_users(df)
    future = df["day"] >= TIME_CUTOFF

    results = {
        "locked_users": _run_test("Test A: locked 20% of users, never used in training",
                                  df, ~locked, locked, features, insiders),
        "future_days": _run_test(f"Test B: train before {TIME_CUTOFF.date()}, test on later days",
                                 df, ~future, future, features, insiders),
        "locked_users_future_days": _run_test("Test C: unseen users AND future days",
                                              df, ~locked & ~future, locked & future, features, insiders),
    }
    pd.Series(locked.groupby(df["user"]).first(), name="locked").to_csv(config.REPORTS_DIR / "locked_test_users.csv")
    (config.REPORTS_DIR / "test_results.json").write_text(json.dumps(results, indent=2, default=float))
    log.info("Saved %s", config.REPORTS_DIR / "test_results.json")
    return results

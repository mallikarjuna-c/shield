"""Train and evaluate the Shield LightGBM model.

Evaluation uses cross-validation grouped by user: a user's days are never split
between train and test, so the score reflects catching *new* insiders, not
recognising ones already seen. Insiders are under 1% of user-days, so accuracy
is meaningless; we report PR-AUC, ROC-AUC and how many insiders appear at the
top of the alert ranking.
"""
import json
import logging

import lightgbm as lgb
import numpy as np
import pandas as pd
from sklearn.metrics import average_precision_score, roc_auc_score
from sklearn.model_selection import StratifiedGroupKFold

from . import config

log = logging.getLogger(__name__)

NON_FEATURES = {"user", "day", "label", "scenario", *config.EXCLUDED_FEATURES}


def _pos_weight(labels):
    pos = labels.sum()
    return float((len(labels) - pos) / max(pos, 1)) ** 0.5


def fit(train, features):
    params = dict(config.LGBM_PARAMS, scale_pos_weight=_pos_weight(train["label"]))
    return lgb.train(params, lgb.Dataset(train[features], train["label"]), config.NUM_BOOST_ROUND)


def _insiders():
    ins = pd.read_csv(config.answers_dir() / "insiders.csv", dtype=str)
    return set(ins.loc[ins["dataset"].str.strip() == config.RELEASE.lstrip("r"), "user"].str.strip())


def _metrics(df, score_col, insiders):
    y, s = df["label"].to_numpy(), df[score_col].to_numpy()
    order = np.argsort(-s)
    day = {
        "pr_auc": average_precision_score(y, s),
        "roc_auc": roc_auc_score(y, s),
        "random_pr_auc": float(y.mean()),
        "precision_at_100": float(y[order[:100]].mean()),
        "recall_at_top_1pct": float(y[order[:int(0.01 * len(y))]].sum() / max(y.sum(), 1)),
    }
    users = df.groupby("user").agg(label=("label", "max"), score=(score_col, "max"))
    users = users[(users["label"] == 0) | users.index.isin(insiders)]
    uy, us = users["label"].to_numpy(), users["score"].to_numpy()
    uorder = np.argsort(-us)
    user = {
        "users": len(users),
        "insiders": int(uy.sum()),
        "pr_auc": average_precision_score(uy, us),
        "roc_auc": roc_auc_score(uy, us),
        "insiders_in_top_50": int(uy[uorder[:50]].sum()),
        "insiders_in_top_100": int(uy[uorder[:100]].sum()),
    }
    return {"user_day": day, "user": user}


def run():
    df = pd.read_parquet(config.FEATURES_DIR / "user_day.parquet")
    features = [c for c in df.columns if c not in NON_FEATURES]
    log.info("Training on %s user-days, %d features, %d malicious days, %d insiders",
             f"{len(df):,}", len(features), int(df["label"].sum()), df.loc[df["label"] == 1, "user"].nunique())

    insiders = _insiders()
    user_label = df.groupby("user")["label"].transform("max")
    cv = StratifiedGroupKFold(n_splits=config.N_FOLDS, shuffle=True, random_state=config.SEED)
    df["cv_score"] = np.nan
    for fold, (tr, te) in enumerate(cv.split(df, user_label, groups=df["user"]), 1):
        model = fit(df.iloc[tr], features)
        df.iloc[te, df.columns.get_loc("cv_score")] = model.predict(df.iloc[te][features])
        m = _metrics(df.iloc[te], "cv_score", insiders)
        log.info("  fold %d: user-day PR-AUC %.3f | user ROC-AUC %.3f | %d insiders in test",
                 fold, m["user_day"]["pr_auc"], m["user"]["roc_auc"], m["user"]["insiders"])

    metrics = _metrics(df, "cv_score", insiders)
    cutoff = df["cv_score"].quantile(0.99)
    metrics["recall_top_1pct_by_scenario"] = {
        int(s): float((g["cv_score"] >= cutoff).mean()) for s, g in df[df["label"] == 1].groupby("scenario")}

    d, u = metrics["user_day"], metrics["user"]
    log.info("Cross-validated results on users the model never saw:")
    log.info("  user-day: PR-AUC %.3f (random %.4f), ROC-AUC %.3f, precision@100 %.2f",
             d["pr_auc"], d["random_pr_auc"], d["roc_auc"], d["precision_at_100"])
    log.info("  user:     PR-AUC %.3f, ROC-AUC %.3f, insiders in top 50: %d/%d, top 100: %d/%d",
             u["pr_auc"], u["roc_auc"], u["insiders_in_top_50"], u["insiders"], u["insiders_in_top_100"], u["insiders"])
    log.info("  recall in top 1%% of user-days by scenario: %s", metrics["recall_top_1pct_by_scenario"])

    log.info("Fitting final model on all data (%d trees)", config.NUM_BOOST_ROUND)
    final = fit(df, features)

    final.save_model(str(config.MODELS_DIR / "shield_lgbm.txt"))
    categories = {c: list(df[c].cat.categories) for c in features if isinstance(df[c].dtype, pd.CategoricalDtype)}
    (config.MODELS_DIR / "feature_contract.json").write_text(json.dumps(
        {"features": features, "categories": categories, "release": config.RELEASE}, indent=2))

    importance = pd.Series(final.feature_importance("gain"), index=features).sort_values(ascending=False)
    importance.to_csv(config.REPORTS_DIR / "feature_importance.csv", header=["gain"])
    (config.REPORTS_DIR / "metrics.json").write_text(json.dumps(metrics, indent=2, default=float))
    df[["user", "day", "cv_score", "label", "scenario"]].to_parquet(config.REPORTS_DIR / "cv_scores.parquet", index=False)
    df.sort_values("cv_score", ascending=False).head(500)[["user", "day", "cv_score", "label", "scenario"]] \
        .to_csv(config.REPORTS_DIR / "top_alerts_cv.csv", index=False)

    log.info("Top features: %s", ", ".join(importance.head(10).index))
    log.info("Saved model to %s", config.MODELS_DIR / "shield_lgbm.txt")
    return metrics

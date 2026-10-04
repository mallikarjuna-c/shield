import numpy as np
import pandas as pd

from . import config

LEVELS = [("High", 0.002), ("Medium", 0.01), ("Watch", 0.02)]


class Levels:
    def __init__(self, scores):
        self.sorted = np.sort(np.asarray(scores, dtype=float))
        self.cutoffs = {name: float(np.quantile(self.sorted, 1 - share)) for name, share in LEVELS}

    @classmethod
    def load(cls):
        return cls(pd.read_parquet(config.REPORTS_DIR / "cv_scores.parquet", columns=["cv_score"])["cv_score"])

    def level(self, risk):
        for name, _ in LEVELS:
            if risk >= self.cutoffs[name]:
                return name
        return "Normal"

    def percentile(self, risk):
        return float(100 * np.searchsorted(self.sorted, risk, side="right") / len(self.sorted))

    def describe(self):
        return [{"level": n, "top_share": s, "cutoff": self.cutoffs[n]} for n, s in LEVELS]

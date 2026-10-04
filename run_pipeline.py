"""Run the Shield pipeline.

    python run_pipeline.py                  # preprocess -> labels -> features -> train -> evaluate -> explain -> stages -> replay
    python run_pipeline.py --to features    # stop after feature extraction
    python run_pipeline.py --only train     # one stage
"""
import argparse
import logging
import sys
import time

from shield import config, evaluate, explain, features, ingest, labels, replay, stages, train

STAGES = {
    "preprocess": ingest.run,
    "labels": labels.run,
    "features": features.run,
    "train": train.run,
    "evaluate": evaluate.run,
    "explain": explain.run,
    "stages": stages.run,
    "replay": replay.run,
}


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--from", dest="start", choices=STAGES, help="start at this stage")
    parser.add_argument("--to", dest="stop", choices=STAGES, help="stop after this stage")
    parser.add_argument("--only", choices=STAGES, help="run a single stage")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
        handlers=[logging.StreamHandler(sys.stdout),
                  logging.FileHandler(config.REPORTS_DIR / "pipeline.log", encoding="utf-8")],
    )
    names = list(STAGES)
    if args.only:
        names = [args.only]
    else:
        if args.start:
            names = names[names.index(args.start):]
        if args.stop:
            names = names[:names.index(args.stop) + 1]

    logging.info("Data: %s", config.DATA_DIR)
    for name in names:
        t0 = time.time()
        logging.info("=== stage: %s ===", name)
        STAGES[name]()
        logging.info("=== %s done in %.1f min ===", name, (time.time() - t0) / 60)


if __name__ == "__main__":
    main()

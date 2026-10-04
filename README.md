# Shield — insider-threat detection

Scores every **user-day** for insider-threat risk with LightGBM, trained on the public
[CERT Insider Threat Test Dataset](https://kilthub.cmu.edu/articles/dataset/Insider_Threat_Test_Dataset/12841247)
release r4.2 (1,000 users, Jan 2010 – May 2011, 70 labelled insiders).

## Data setup (once)

Download `r4.2.tar.bz2` and `answers.tar.bz2` from the link above and extract them so you have:

```
C:\Users\<you>\shield_data\raw\r4.2\        logon.csv, device.csv, file.csv, email.csv, http.csv, LDAP\, psychometric.csv
C:\Users\<you>\shield_data\raw\answers\     insiders.csv, r4.2-1\, r4.2-2\, r4.2-3\
```

Data stays outside this project folder (it is ~15 GB). Use `SHIELD_DATA_DIR` to point elsewhere.

## Run

```bash
pip install -r requirements.txt
python run_pipeline.py                 # preprocess -> labels -> features -> train
python run_pipeline.py --to features   # stop after feature extraction
python run_pipeline.py --only train    # retrain from the existing feature table
```

## Stages

| Stage | Module | Writes |
|---|---|---|
| preprocess | `shield/ingest.py` | `shield_data/interim/*_daily.parquet`: one row per (user, day) per source |
| labels | `shield/labels.py` | `shield_data/interim/labels.parquet`: user-days with a known malicious event |
| features | `shield/features.py` | `shield_data/features/user_day.parquet`: daily counts + change vs the user's own 30-day baseline + change vs same-role peers |
| train | `shield/train.py` | `models/shield_lgbm.txt`, `models/feature_contract.json`, `reports/metrics.json` |

## Notes on the data

- **Labels** come from `answers/`: every user-day containing an event listed in an insider's detail file is malicious (986 of 330,452 user-days, 0.298%).
- **Hijacked accounts.** In scenario 3 a sysadmin logs in as their supervisor, so two supervisors (FAW0032, FBA0348) have malicious days on their accounts. Their days stay labelled malicious (Shield should flag a compromised account), but user-level metrics count only the 70 real insiders.
- **Scenario balance.** Scenario 2 (theft before quitting) spans weeks and has 861 malicious days; scenario 1 has 85 and scenario 3 has 40, so results are also reported per scenario.
- **Baselines** use only past days (30-day window, at least 5 days), so no feature sees the future. A user's first days have no baseline yet and are left empty.
- **After hours** means outside 07:00–19:00.

## Results (r4.2, 5-fold CV on unseen users)

**Shortcut removed.** In CERT, each employee browses an almost fixed number of web pages per day (86 on average,
identical on 99.8% of normal days) and attack events are added on top of it. A model that counts pages learns
"more pages than your fixed number = attack", which scores very well on CERT but means nothing for real people.
A simulation test exposed it: adding one ordinary web page to a normal day moved the risk from 0.00 to 0.98.

Model choices (all compared with the same 5-fold cross-validation; scratch experiments, not part of the pipeline):

| Version | Features | User-day PR-AUC | Insiders in top 100 users |
|---|---|---|---|
| With page count, early stopping (old) | 160 | 0.956 (inflated by the shortcut) | 70/70 |
| Page count removed, early stopping | 155 | 0.407 | 58/70 |
| Page count removed, fixed 400 trees | 155 | 0.609 | 68/70 |
| + identity and role removed, 400 trees | 146 | 0.645 | 69/70 |
| + 800 trees | 146 | 0.676 | 70/70 |
| **+ logon/email/website totals removed, 800 trees (current)** | **133** | **0.526** | **65/70** |

- Early stopping on a small slice of users was unstable (some folds stopped after 50 trees). Training now uses a
  fixed 800 trees, chosen by cross-validation.
- `config.EXCLUDED_FEATURES` removes the page count (`http_n` and its four deviation features), `days_active`,
  the five personality scores and role/unit/department as direct inputs. These describe who a person is, not what
  they did; removing them made the model slightly better. Role is still used to compare a person with colleagues.
- Logon, email and website totals were removed too (see "Model change made during this work" below): every CERT
  employee logs on exactly once a day and sends an almost fixed number of emails, so these totals were shortcuts.
- The tree count was chosen on the same cross-validation that is reported, so these numbers are slightly optimistic.

Current results:

| Level | PR-AUC | ROC-AUC | Other |
|---|---|---|---|
| User-day | 0.526 (random 0.003) | 0.959 | precision@100 alerts = 1.00 |
| User | 0.926 | 0.986 | top 50 users: 49 insiders; top 100: 65 of 70 |

Recall in the top 1% of user-days: scenario 1 89%, scenario 2 70%, scenario 3 45%. Results vary between folds
because each fold holds only 13 to 15 insiders.

## Stricter tests (`python run_pipeline.py --only evaluate`)

Each test trains a fresh model on one part of the data and scores it once on a part it never saw. Alerts use the
same alert budgets as the rest of Shield: **Medium+** = the riskiest 1% of the test user-days, **High** = the
riskiest 0.2%. Results go to `reports/test_results.json`; the locked users are listed in `reports/locked_test_users.csv`.

| Test | Train on | Test on | Test malicious days | PR-AUC (random) | Medium+ (riskiest 1%) | High (riskiest 0.2%) |
|---|---|---|---|---|---|---|
| A: locked users | 800 users | 200 other users, all dates | 142 (14 insiders) | 0.669 (0.002) | 656 alerts, 121 correct; recall 0.85, precision 0.18 | 132 alerts, 82 correct; recall 0.58, precision 0.62 |
| B: future days | all users, 2010 | all users, Jan–May 2011 | 246 (19 insiders) | 0.566 (0.003) | 841 alerts, 176 correct; recall 0.72, precision 0.21 | 169 alerts, 116 correct; recall 0.47, precision 0.69 |
| C: unseen users + future | 800 users, 2010 | 200 other users, 2011 | 56 (3 insiders) | 0.506 (0.004) | 162 alerts, 38 correct; recall 0.68, precision 0.23 | 33 alerts, 23 correct; recall 0.41, precision 0.70 |

In every test all insiders in the test set are among the 50 riskiest users.

- Test A is the classic held-out test set; test B mimics real use (learn from the past, predict the future).
- Test C is the strictest but has only 3 insiders, so treat it as indicative only.
- Features and settings were designed before these tests were added, using the cross-validation results above, not these test sets.

## Story alerts (`python run_pipeline.py --only explain`)

Every user-day in the riskiest 1% (Medium or High, see Alert levels) gets a plain-English explanation, written to `reports/alerts.csv` and
`reports/alerts.md`. Example:

> JGT0221 (ITAdmin) on Thu 15 Jul 2010: browsed more than usual (121 pages, more than others in the same role),
> sent more email than usual (13 emails, usually 10.4 a day), connected a USB drive 2 times (for the first time
> ever) and browsed the web after hours (28 pages).

How a story is built:

1. SHAP values (`pred_contrib=True` in LightGBM) give how much each of the 133 features pushed the risk up.
2. Features are grouped into readable signals (all USB features → "USB", all logon-time features → "logon time"),
   and their pushes are added up. Context features (role, personality, weekday) are never used as reasons.
3. The strongest signals become sentences filled with the person's real numbers, compared with their own
   30-day average or with same-role peers.
4. A signal is only mentioned if today's activity is clearly above normal (at least 20% more than the person's
   usual, a first-ever occurrence, or well above peers), so the story never cites *less* activity as a reason.
5. Up to 4 reasons per alert (3.5 on average); 8 of 842 alerts have no single clear reason and say "unusual
   activity overall".

Risk levels follow the alert budget (High = riskiest 0.2%, Medium = riskiest 1%). Scores come from the cross-validation models, so each story is
about a user the scoring model never saw.

Results with the current model: 3,305 alerts (the riskiest 1%), 698 on labelled attack days.

Stories are template-based (free, offline). An LLM (e.g. Claude) can rewrite them more naturally later, using the
`reasons` column as input.

## Attack-stage tracker (`python run_pipeline.py --only stages`)

Follows each user day by day and records how far an attack has progressed.

| Stage | Evidence on a day |
|---|---|
| 1 Reconnaissance | job-search or hacking/keylogger sites clearly above the user's normal |
| 2 Collection | file copying clearly above normal, after-hours logon, or logon to someone else's PC |
| 3 Staging | USB use clearly above normal or first ever, after-hours USB, .zip or .exe copied |
| 4 Exfiltration | leak site visited, upload/file-sharing sites or external attachments clearly above normal |
| 5 Departure | the user leaves the company (missing from the final LDAP list) with stage ≥ 1 in the previous 60 days |

Rules:

- Evidence only counts on days the model already rates risky (CV risk ≥ 0.2). Many innocent users visit job sites,
  and the "leak" keyword also matches harmless URLs (61 users have one, only 30 are insiders), so evidence without
  model risk produced 35 innocent users at Exfiltration; with the gate it is 6.
- Evidence fades after 30 days. The current stage is the highest stage with evidence in the last 30 days, and every
  increase is logged as an escalation.
- Stages are not forced to happen in order: real attacks often show several in one day.

Results:

| Highest stage reached | Insiders (of 70) | Other users (of 930) |
|---|---|---|
| Staging or beyond | 67 | 43 |
| Normal or lower stages | 3 | 887 |

- 67 of 70 insiders reach Staging or beyond, a median of 10 days before their attack ends; 43 other users (4.6%) do too.
- Lowering the evidence gate to the Medium or Watch level catches 69 insiders but 121 or 217 other users, so the
  gate stays at 0.2.
- Scenario 3 (sysadmin) rarely shows exfiltration evidence (3 of 10): the attack is a mass email from the
  supervisor's account, which shows up on the supervisor's account, not the insider's.

Outputs: `reports/stages.md` (progress bars for the top users), `reports/stage_users.csv` (one row per user, first
date of each stage), `reports/stage_escalations.csv` (every stage increase), `reports/stage_timeline.parquet`
(stage for every user-day).

## Attack-replay monitoring and dashboard

`http://127.0.0.1:8000/` is a public **landing page** (what Shield does, how it works, attack stages); its figures are
read from `reports/metrics.json` and `reports/test_results.json` through `/api/summary`, and its example alert is a real
alert from the evaluation data. The dashboard is at `http://127.0.0.1:8000/app`.

The dashboard is a web interface organised like Grafana, with a time picker in the top bar (Today (live), last 7 / 30 / 90 days,
last year, all data, or an absolute From–To range):

| Page | Purpose |
|---|---|
| **Dashboards** | Period views include an **alert calendar** (one square per day, coloured relative to the other days in the range, High alerts counting double). With **Today (live)**: the replay day as received so far (threat level and counts by level, risk through the day, every employee with their main reason, and for the selected employee the reasons and attack stages). With a period: alerts per day, highest attack stage, riskiest employees and alert stories for that range, including today's live data when it falls in the range. |
| **Explore** | Without an employee selected: the employees flagged today; search covers all employees (`/api/users`). With an employee: peak risk, highest stage and alert days for the selected range, the daily risk percentile and the alert stories; for the monitored day also the live explanation, attack stages and an **activity timeline** (every event on a 24-hour axis by type, flagged events with their reason: after hours, other PC, job / leak / upload / hacking / rare site, outside recipient, USB; identical flagged events are grouped). Individual events exist only for the monitored day; 2010–2011 keeps daily totals. |
| **Data sources** | Upload activity log CSV files (the five upload files are in `shield_data/replay/2011-05-18`), see each upload slot with what was received and the alerts after it, reset the day. |

The sidebar menu shows live counts: Dashboards shows the number of Medium and High alerts (red when any is High), Explore
shows the employee under investigation, and Data sources shows uploads received (e.g. 3/5). The top bar shows the page,
the live status of the day (upload progress and the time the data reaches), the Ground truth toggle, the time picker and
refresh. The menu can be collapsed to icons from the top bar (remembered per browser, collapsed by default below 1024 px),
and the open page is kept in the URL (`/app#explore`), so reload and the browser back button work.

**Ground truth** (top bar) compares Shield with the answer key; it is for evaluation only, a real deployment has no answer
key. It never changes a score, level or ranking, and the server only sends the answers while it is on.

- Today (live): a card with attackers caught (Watch or above) out of the 5 replayed attackers, flagged employees and false
  alarms, and each attacker's rank, risk and stage; employee tables get a Truth column.
- A period: real attack days that got a Medium or High alert, attacker accounts alerted, and alerts that were real attacks
  (over all data: 698 of 991 attack days alerted, 698 of 3,309 alerts real); employees and alerts are labelled.
- Explore: the employee is labelled attacker or normal.

Scenario 3 insiders log on as their supervisor, so their attack days are recorded under the supervisor's account: 70
insiders, 72 accounts with attack activity in 2010–2011.

```bash
pip install fastapi "uvicorn[standard]"
python run_pipeline.py --only replay      # builds the 5 uploads + ground truth + holdout model (~12 min, once)
cd web && npm install && npm run build && cd ..
python -m server                          # open http://127.0.0.1:8000 (landing) or /app (dashboard)
```

### The replay day (`shield/replay.py`)

The day is **Wed 18 May 2011**, the day after the CERT data ends, so the model has never seen it.

- 100 employees still employed at the end of the data, none of them real insiders.
- 95 of them get their **real activity from their most recent workday**, moved to 18 May.
- 5 of them additionally get a **real CERT attack replayed onto their account**, keeping its time of day:

| Attacker | Replayed insider | Scenario | Attack times |
|---|---|---|---|
| BAJ0654 | PSF0133, 1 Sep 2010 | Theft before quitting (job sites + USB) | 10:04–17:57 |
| CMW0783 | FSC0601, 3 Mar 2011 | Theft before quitting (USB + email) | 10:21–16:44 |
| GJD0298 | BBS0039, 12 Aug 2010 | Rogue admin | 10:24–19:15 |
| POB0343 | AJR0932, 10 Sep 2010 | Data leak (night logon, USB, Wikileaks) | 19:12–20:50 |
| SVL0940 | BIH0745, 13 Jul 2010 | Data leak | 20:15–21:20 |

- The events are split into five uploads by time: 00–10, 10–12, 12–14, 14–17, 17–24
  (`shield_data/replay/2011-05-18/upload_*.csv`, in a single CERT-style format with a `source` column).
  `ground_truth.csv` lists the attackers and is only read when "Ground truth" is switched on.
- A **holdout model** (`models/holdout_lgbm.txt`) is trained on all 2010–2011 data except the 5 replayed insiders, so it
  has never seen these attacks.

### How an upload is scored (`shield/monitor.py`)

1. New events are added to the day's events so far (duplicate event ids are ignored).
2. They are summarised per employee with the training preprocessing functions.
3. **Now-cast:** a partial day is completed with each employee's usual activity for the rest of their workday
   (their 30-day average × the share of their usual workday still to come, rounded). At 24:00 nothing is estimated.
4. Features are built with the training `build()` function against the employee's real history. The comparison with
   colleagues uses each role's last 30 days across all 1,000 employees, because only 100 people are uploaded.
5. The holdout model scores the day; the story and attack stage are produced as in training.

### Alert levels (`shield/levels.py`)

Attacks are 0.3% of user-days, so raw probabilities for real attacks are often small. Levels are therefore set by
**alert budget** from the cross-validation scores of 2010–2011 (also used by the story alerts and Dashboards):

| Level | Riskiest share of employee-days | Risk cut-off | In history |
|---|---|---|---|
| High | 0.2% | 0.526 | 1.3 alerts/day, 64% are real attack days |
| Medium | 1% | 0.0085 | 6.6 alerts/day, 71% of attack days caught |
| Watch | 2% | 0.0011 | 13 alerts/day |

The interface shows each score as a **percentile**: "riskier than 99.3% of all 2010–2011 employee-days".

### Result of the five uploads

| Data up to | Attackers | Other employees flagged |
|---|---|---|
| 10:00 | none flagged (no attack has started) | 3 Medium, 4 Watch |
| 12:00 | BAJ0654 Watch | 2 Medium, 6 Watch |
| 14:00 | BAJ0654 Watch | 1 High, 2 Medium, 3 Watch |
| 17:00 | BAJ0654 Medium, CMW0783 Watch | 2 Watch |
| 24:00 | **all 5**: POB0343 and SVL0940 High; GJD0298, CMW0783, BAJ0654 Watch | 3 Watch |

- Early uploads have more false alarms: the rest-of-day estimate is approximate.
- The thefts and the rogue admin stay at Watch: in CERT, 4.5% of normal days already have 5 or more USB connections,
  so USB use alone is weak evidence. The night leaks (leak site + first-ever USB at night) are clear.

### Dashboards over a period

Any range from the time picker (up to 18 May 2011): alerts per day, highest attack stage per employee, riskiest
employees and every alert with its story; clicking an employee opens Explore. 2010–2011 uses the cross-validation
scores; 18 May 2011 uses the latest upload.

### Model change made during this work

Testing the replay day showed two more CERT shortcuts: each employee logs on exactly once a day and sends an almost fixed
number of emails, and attacks add on top. The model reacted to one extra estimated email. The volume totals
(`logon_n`, `logoff_n`, `email_n`, `email_recipients`, `http_distinct_domains` and their deviation features) are now
excluded as well (`config.EXCLUDED_FEATURES`, 133 features). Cross-validated user-day PR-AUC is 0.526 (random
0.003), 65 of 70 insiders are in the top 100 users, and the top features are behavioural: USB use against colleagues
and own history, job sites, files copied, logons on other PCs, after-hours activity.

## Tests

```bash
python -m pytest
```

`tests/test_shield.py` checks the properties the results depend on:

- personal baselines never use future days, and first-time flags fire only once;
- preprocessing counts (after-hours logons, logons on another PC, first logon / last logoff) are correct;
- features built for a subset of users (as the live monitor does) are identical to the training table;
- the saved models never use the excluded shortcut features or any answer-key column;
- every stored alert is exactly a model score at or above the Medium cutoff (the answer key only labels alerts, it never selects them);
- alert levels are ordered and percentiles are monotonic;
- stories never cite activity that is lower than usual as a reason;
- the monitor rejects invalid uploads (missing columns, wrong day, unknown user or source) and ignores duplicates;
- the server blocks path traversal and oversized uploads, and employee search covers every employee.

The traversal test found a real bug during development: the web-page route served any file path, including the
project's source code. It now only serves files inside `web/dist`.

## Project structure

```
shield/            pipeline package
  config.py        paths, settings, excluded features
  ingest.py        raw logs -> one row per user-day per source
  labels.py        answer key -> malicious user-days
  features.py      daily table + own-history and peer deviation features
  train.py         5-fold grouped CV + final LightGBM model
  evaluate.py      locked-user, future-day and combined tests
  explain.py       SHAP -> plain-English stories
  stages.py        attack-stage tracker
  levels.py        alert budgets and percentiles
  replay.py        replay day uploads, ground truth, holdout model
  monitor.py       scores uploads for the replay day (now-cast)
server/            FastAPI backend (python -m server)
web/               React + TypeScript + Tailwind frontend: Dashboards, Explore, Data sources (npm run build)
tests/             pytest suite
models/            shield_lgbm.txt (main), holdout_lgbm.txt (replay day), feature contracts
reports/           metrics, test results, alerts, stage reports
```

Data (`%USERPROFILE%\shield_data`) stays outside the project: raw CERT files, interim tables, features and the replay day.

## Evaluation

Insiders are under 1% of user-days, so accuracy is misleading. Shield reports PR-AUC, ROC-AUC,
and insiders found in the top 50 / 100 users, from 5-fold cross-validation grouped by user
(every score comes from users the model never saw in training).

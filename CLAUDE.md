# Working agreement

## Deliver to a link, every time

Feedback is not addressed when the code is fixed, or committed, or merged. It is
addressed when there is a link in the chat that opens the running app.

So any change to `web/` runs all the way through:

```bash
python3 scripts/fetch_logos.py   # only when the universe gained new symbols
python3 scripts/build_web.py     # fold data/ + logos into a single-file page
                                 # then publish web/top300.html as an Artifact,
                                 # to the SAME url as the standing link below
git add -A && git commit && git push
```

then the reply ends with that link.

Do not hand back a file to open locally, a "rebuild it with this command", or a
new artifact url. Run the build, republish over the existing url, paste it.

**Every reply ends with the app link — no exceptions, including replies that
changed nothing.** If the app moved, republish first; if it did not, repeat the
standing link verbatim.

### Standing link

```
https://claude.ai/code/artifact/b0309d40-75ba-4dd8-83ec-9953aed70963
```

Unlike the Snack ids this replaced, **this url is stable**: republishing the same
file path within a session updates it in place, and from a new session passing it
as `url` does the same. Never publish without that `url` — it mints a second
artifact and strands the one people already have. The artifact is private to the
account owner until they share it from the page's own share menu.

## The page carries everything it shows

The artifact's Content-Security-Policy blocks every external request — no fetch
to GitHub, no logo CDN, no fonts. So nothing is loaded at view time; it is all
baked in at build time. Two consequences worth remembering:

- **A data rebuild does not reach the published page on its own.** Regenerating
  `data/` changes nothing until `build_web.py` runs and the artifact is
  republished. There is no runtime fetch to pick it up.
- **Logos live in `web/logos.json`**, base64 WebP keyed by symbol, committed.
  `fetch_logos.py` fills it, skipping symbols already cached, so it only costs
  network on genuinely new names — rerun it after a universe change, not on
  every build.

Logos come in two incompatible kinds and the tile has a mode for each: a
transparent mark sits inset on the dark tile, while art baked onto its own
opaque background fills the tile edge to edge and is clipped by its radius.
Classifying them by hand is not necessary — `fetch_logos.py` measures the alpha
channel and writes the `opaque` list itself, over the cache, at no network cost.

Keep an eye on the total: the artifact host rejects anything over 16MB, and
`build_web.py` warns within 1MB of it. Today's page is ~8.8MB, roughly two
thirds data and one third logos.

## Why there is no Snack any more

The app shipped as an Expo Snack until Expo's own runtime project — the EAS
Update endpoint every `exp://` link points at, which Expo Go fetches before
running a line of our code — began returning

```
HTTP 429: The number of Monthly Updating Users has exceeded the Free tier's
quota for this account.
```

for hours at a stretch, breaking every Snack in the world at once and leaving
the phone on "Connecting…" with no error and no clue. Nothing in this repo could
fix it, and no amount of care over SDK versions or dependency pinning mattered
while it was down.

An anonymous Snack was also immutable, so every app change minted a new id and a
new link, and possibly cost the user their watchlist along with it.

The web edition owes Expo nothing, updates in place, and is the delivery channel
now. `app/src/` is the retired React Native original, kept because
`web/index.template.html` is a hand port of it and the model code is worth
diffing against; it is no longer built or published.

## Merge authority

Merging is delegated — do not ask. Open the PR, merge it, and report the outcome.
The same goes for the rest of repo maintenance: branches, follow-up PRs,
regenerating artifacts. Raise something only when it genuinely cannot be done
without the account owner.

Nothing currently needs the account owner. Data is rebuilt by running
`scripts/build_snapshot.py` here and committing the result, so no repository
secret has to exist for the pipeline to run.

## Repository shape

| Path | What it is |
| --- | --- |
| `scripts/build_snapshot.py` | The pipeline: universe, prices, benchmarks, metrics, validation, atomic write |
| `scripts/remetric.py` | Replays changed formulas over the committed history; `--fetch-benchmarks` refreshes the factor series |
| `scripts/fetch_logos.py` | Caches every company logo into `web/logos.json` |
| `scripts/build_web.py` | Folds `data/` and the logos into one self-contained page |
| `web/index.template.html` | **The app — edit here** |
| `web/logos.json` | Base64 WebP logos by symbol, plus which are opaque |
| `web/top300.html` | Generated page — never edit, never commit |
| `data/index.json` | The list of universes — the first file the app reads |
| `data/snapshot.json` | The Top 300 |
| `data/next300.json` | The next 300 — ranks 301-600 by market cap |
| `data/sectors/*.json` | The top 100 in each sector |
| `app/src/` | The retired React Native original, kept for reference |

Changing a *formula* rather than the data does not need an FMP key or a refetch:
`remetric.py` imports the pipeline's own functions and replays them over the
`history` already committed, keeping the data date. Edit the metric in
`build_snapshot.py` — it stays the one definition — then run remetric. The one
exception is the score, which has no pipeline-side formula at all: it lives in
`web/index.template.html`, so changing it is a template edit and a rebuild, no
data run of any kind.

Invariants worth not breaking:

- The two whole-market bands are separate universes, not one list of six
  hundred. A company is #1 of the next 300 rather than #301 overall, because a
  placing only means something against the field it was measured in — the same
  reason a sector file ranks itself. `NEXT_N` sizes the band.
- Nothing in `data/` is ranked — and no momentum score is published either.
  The score is a function of the reader's formula settings (lookback window,
  skip, volatility adjustment, market/sector residuals, 50/50 blend), so the
  app computes it at view time from each ticker's `history` and the table's
  `benchmarks`, then ranks against the rows on screen. Publish raw series
  only; a precomputed score in `data/` would be a second, contradictory
  answer, and is exactly what this system replaced.
- `benchmarks` is what the pipeline owes that scoring: VTI plus one SPDR
  sector fund per sector present, aligned to the same shared calendar as every
  ticker, in every table file. Betas are estimated over the 504 sessions
  ending at a window's cutoff, so the calendar must stay comfortably past 504
  sessions plus the deepest skip (21). Benchmarks are funds, not companies —
  they must never appear as table rows.
- The default formula is the 50/50 blend of 12M (252 sessions, skip 21) and
  6M (126, skip 10), vol-adjusted, market-residual, sector residual off. The
  skip per window is round(lookback/12), written out as {63: 5, 126: 10,
  189: 16, 252: 21} because 126's is defined as 10 where `Math.round` says 11.
  Windows are counted in trading days from the as-of date, never snapped to
  calendar months, and the score is never annualised: a constant √252 reorders
  nothing, and annualising one half of a ratio inflates exactly the most
  extreme names. That bug shipped once and put a 30-bagger nine times clear of
  the field.

- The pipeline validates entirely in memory and writes by atomic rename, so a
  failed refresh leaves every published file byte-for-byte intact. Keep it that
  way; never write before validating.
- Dedupe is by SEC CIK. FMP reports every listing of an issuer with that
  issuer's whole market cap, so without it `GOOG` doubles `GOOGL` and Verizon's
  2054 notes outrank real companies.

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
| `scripts/build_snapshot.py` | The pipeline: universe, prices, metrics, validation, atomic write |
| `scripts/remetric.py` | Replays changed formulas over the committed history, no refetch |
| `scripts/fetch_logos.py` | Caches every company logo into `web/logos.json` |
| `scripts/build_web.py` | Folds `data/` and the logos into one self-contained page |
| `web/index.template.html` | **The app — edit here** |
| `web/logos.json` | Base64 WebP logos by symbol, plus which are opaque |
| `web/top300.html` | Generated page — never edit, never commit |
| `data/index.json` | The list of universes — the first file the app reads |
| `data/snapshot.json` | The Top 300 |
| `data/sectors/*.json` | The top 100 in each sector |
| `app/src/` | The retired React Native original, kept for reference |

Changing a *formula* rather than the data does not need an FMP key or a refetch:
`remetric.py` imports the pipeline's own functions and replays them over the
`history` already committed, keeping the data date. Edit the metric in
`build_snapshot.py` — it stays the one definition — then run remetric.

Three invariants worth not breaking:

- Nothing in `data/` is ranked. Every score and placing the app shows is
  measured against the rows on screen, so a filter re-ranks the field. Publish
  the raw measure and let the app do the ranking.
- MOM is a sum of eleven daily-Sharpe terms over rolling 21-session blocks, and
  both halves of each term are daily quantities on purpose. The blocks are
  counted in trading days from the as-of date, never snapped to calendar months
  — that keeps the skip a fixed month rather than letting it breathe between one
  and two depending on the day of the run. Do not annualise it: annualising both
  halves only multiplies by √252 and changes no ordering, and doing it to the
  numerator alone — compounding a simple return over a log-return volatility —
  mixes two scales and inflates exactly the most extreme names. That bug shipped
  once and put a 30-bagger nine times clear of the field.

- The pipeline validates entirely in memory and writes by atomic rename, so a
  failed refresh leaves every published file byte-for-byte intact. Keep it that
  way; never write before validating.
- Dedupe is by SEC CIK. FMP reports every listing of an issuer with that
  issuer's whole market cap, so without it `GOOG` doubles `GOOGL` and Verizon's
  2054 notes outrank real companies.

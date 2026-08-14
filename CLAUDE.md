# Working agreement

## Deliver to a tap, every time

Feedback is not addressed when the code is fixed, or committed, or merged. It is
addressed when there is a link in the chat that opens the running app on the
phone.

So any change to `app/` runs all the way through:

```bash
scripts/bundle_snack.sh          # fold app/src into the single-file bundle
python3 scripts/publish_snack.py # save it as a Snack, print the tap link
git add -A && git commit && git push
```

then the reply ends with the fresh **Tap link** (`exp://…`), with the web link
(`https://snack.expo.dev/<id>`) beside it as the fallback for anywhere a custom
scheme is not clickable.

Do not hand back a QR code to scan, a file tree to paste into Snack, or a
"regenerate it with this command". Run the command and paste the result.

**Every reply ends with a tap link — no exceptions, including replies that
changed nothing.** Which link depends on whether the app moved:

| Did this reply change `app/`? | Link to end with |
| --- | --- |
| Yes | Publish a new Snack and use that; update the standing link below |
| No | Repeat the standing link verbatim |

### Standing link

```
exp://u.expo.dev/933fd9c0-1666-11e7-afca-d980795c5824?runtime-version=exposdk%3A55.0.0&channel-name=production&snack=_l78c1v7XG5_cfDeKl0Zb
https://snack.expo.dev/_l78c1v7XG5_cfDeKl0Zb
```

Keep this block current — it is the answer to "what do I tap right now".

The split exists because **an anonymous Snack is immutable**. Passing an
existing id to the save endpoint mints a *new* id and leaves the original
untouched, so there is no way to update a published link in place without an
Expo account. Every app change therefore burns a new id, and if Expo Go scopes
`AsyncStorage` per Snack rather than per runtime, a new id costs the user their
watchlist. That is unverified either way, so do not spend ids casually:
republish when the app actually changed, and otherwise repeat the standing link.

A Snack is a **frozen copy** of the bundle at save time. Editing `app/src/` does
nothing to an already-published link, so republishing is not optional after an
app change — the old link would keep serving the old bug. Data is different:
`snapshot.json` is fetched at runtime from `main`, so daily refreshes reach an
already-published Snack on their own and only app changes need a republish.

## Merge authority

Merging is delegated — do not ask. Open the PR, merge it, and report the outcome.
The same goes for the rest of repo maintenance: branches, follow-up PRs,
regenerating artifacts. Raise something only when it genuinely cannot be done
without the account owner.

There is exactly one such thing today: **`FMP_API_KEY`** must be added under
*Settings → Secrets and variables → Actions*. It cannot be set through the API
available here, and a credential should not be routed through an agent anyway.
Until it exists, the nightly refresh fails and the app serves a frozen snapshot.

## Snack publishing, the part that bites

Expo serves a Snack runtime for only some SDK versions, and saving against an
unsupported one **fails silently** — the save returns an id and the page loads,
but the deep link comes back without its `snack=` parameter and the phone has
nothing to open. `publish_snack.py` catches this by reading the deep link back
off the Snack's own page and walking SDK versions downward until one binds.
Trust that check; never hand over a link whose `snack=` parameter is missing.

## Repository shape

| Path | What it is |
| --- | --- |
| `scripts/build_snapshot.py` | The pipeline: universe, prices, metrics, validation, atomic write |
| `scripts/bundle_snack.sh` | Folds `app/` into `app/snack/App.js` |
| `scripts/publish_snack.py` | Saves that bundle as a Snack, prints the tap link |
| `scripts/make_snack_url.py` | Multi-file Snack link, for editing the modular project |
| `app/src/` | The real app — **edit here** |
| `app/snack/App.js` | Generated bundle — never edit |
| `data/snapshot.json` | Published data, rewritten by the workflow after each close |

Two invariants worth not breaking:

- The pipeline validates entirely in memory and writes by atomic rename, so a
  failed refresh leaves the previous `snapshot.json` byte-for-byte intact. Keep
  it that way; never write before validating.
- Dedupe is by SEC CIK. FMP reports every listing of an issuer with that
  issuer's whole market cap, so without it `GOOG` doubles `GOOGL` and Verizon's
  2054 notes outrank real companies.

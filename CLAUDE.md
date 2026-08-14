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
exp://u.expo.dev/933fd9c0-1666-11e7-afca-d980795c5824?runtime-version=exposdk%3A54.0.0&channel-name=production&snack=02pCbDUHTTHXZz-Us885s
https://snack.expo.dev/02pCbDUHTTHXZz-Us885s
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
`data/` is fetched at runtime from `main`, so a rebuilt table reaches an
already-published Snack on its own and only app changes need a republish.

## Merge authority

Merging is delegated — do not ask. Open the PR, merge it, and report the outcome.
The same goes for the rest of repo maintenance: branches, follow-up PRs,
regenerating artifacts. Raise something only when it genuinely cannot be done
without the account owner.

Nothing currently needs the account owner. The nightly Actions refresh is gone —
data is rebuilt by running `scripts/build_snapshot.py` here and committing the
result — so no repository secret has to exist for the pipeline to run.

## Snack publishing, the part that bites

The SDK version is the whole difficulty, and it fails in two different ways.

**It can fail silently on Snack's side.** Saving against an SDK with no Snack
runtime still returns an id and still loads a page, but the deep link comes
back without its `snack=` parameter and the phone has nothing to open.

**It can also bind on Snack and still be wrong for the phone.** An SDK newer
than the installed Expo Go produces a link that opens Expo Go and then dies on
"Project is incompatible with this version of Expo Go". This is the one that
actually shipped a broken link: SDK 55 bound perfectly server-side and was
useless on the device.

So **"newest version that binds" is the wrong target.** The right one is the
runtime Snack itself falls back to, which is what its Expo Go integration ships
against. Only a *saved* Snack's page renders that value, so `publish_snack.py`
saves a probe against an impossible SDK, reads the fallback runtime off its
page, and publishes against exactly that — then asserts the link it hands back
carries both `snack=<id>` and the runtime it asked for. Do not replace that
probe with the versions API; that API lists SDKs Expo Go cannot run.

Never hand over a link that has not passed both assertions.

**Import a native package from exactly one module.** The bundler emits one
import statement per importing module, and Snack's runtime evaluates the
package once for each of them. `react-native-svg` registers native views at
module scope, so a second evaluation throws *"Tried to register two views with
the same name RNSVGCircle"* — after the app has already started rendering. Two
importers happened to survive; a third did not. `app/src/components/svg.js`
re-exports the package and everything draws through it, so the bundle contains
one import however many components use it. Check with:

```bash
grep -c 'from "react-native-svg"' app/snack/App.js   # must print 1
```

**Pin dependencies to the SDK, never `*`.** `react-native-svg`, AsyncStorage and
`expo-haptics` all ship inside Expo Go, but a `*` version spec does not match
the bundled copy, so Snack hands the package to Snackager to build from npm
instead — and that fails on the device with "Unable to fetch module
react-native-svg@* for ios" after the app has already started rendering.
`publish_snack.py` reads the real versions from
`exp.host/--/api/v2/sdks/<sdk>/native-modules` and refuses to publish if any
dependency has no version published for that SDK. Snackager is unreachable from
this environment, so a bad pin cannot be caught here — it surfaces on the
phone.

## Repository shape

| Path | What it is |
| --- | --- |
| `scripts/build_snapshot.py` | The pipeline: universe, prices, metrics, validation, atomic write |
| `scripts/bundle_snack.sh` | Folds `app/` into `app/snack/App.js` |
| `scripts/publish_snack.py` | Saves that bundle as a Snack, prints the tap link |
| `scripts/make_snack_url.py` | Multi-file Snack link, for editing the modular project |
| `app/src/` | The real app — **edit here** |
| `app/snack/App.js` | Generated bundle — never edit |
| `data/index.json` | The list of universes — the first file the app reads |
| `data/snapshot.json` | The Top 300 |
| `data/sectors/*.json` | The top 100 in each sector |

Two invariants worth not breaking:

- The pipeline validates entirely in memory and writes by atomic rename, so a
  failed refresh leaves every published file byte-for-byte intact. Keep it that
  way; never write before validating.
- Dedupe is by SEC CIK. FMP reports every listing of an issuer with that
  issuer's whole market cap, so without it `GOOG` doubles `GOOGL` and Verizon's
  2054 notes outrank real companies.

#!/usr/bin/env python3
"""
Build a one-click Expo Snack URL for the app in ``app/``.

Snack's ``files`` parameter accepts externally hosted code, so the URL lists
each file's raw.githubusercontent.com address rather than inlining 50 KB of
source. Opening the link gives you the real modular project -- not a flattened
bundle -- and editing a file in the repo is picked up on the next load.

Usage:
    python3 scripts/make_snack_url.py [--branch BRANCH] [--check]

``--check`` verifies every referenced URL resolves before printing the link.
"""

import argparse
import json
import sys
import urllib.error
import urllib.parse
import urllib.request

OWNER = "vandyckmed-droid"
REPO = "thisone"
APP_DIR = "app"

# Everything except package.json, whose dependencies are passed as their own
# query parameter -- Snack manages that file itself.
FILES = [
    "App.js",
    "src/source.js",
    "src/theme.js",
    "src/storage.js",
    "src/data.js",
    "src/components/Sparkline.js",
    "src/components/PriceChart.js",
    "src/components/TickerRow.js",
    "src/components/UI.js",
    "src/screens/RanksScreen.js",
    "src/screens/WatchlistScreen.js",
    "src/screens/TickerScreen.js",
    "src/screens/SettingsScreen.js",
]

DEPENDENCIES = ["react-native-svg", "@react-native-async-storage/async-storage"]


def raw_url(branch: str, path: str) -> str:
    # refs/heads/ keeps branch names containing slashes unambiguous.
    return (
        f"https://raw.githubusercontent.com/{OWNER}/{REPO}/"
        f"refs/heads/{branch}/{APP_DIR}/{path}"
    )


def snapshot_url(branch: str) -> str:
    return (
        f"https://raw.githubusercontent.com/{OWNER}/{REPO}/"
        f"refs/heads/{branch}/data/snapshot.json"
    )


def build(branch: str, data_branch: str | None = None) -> str:
    files = {path: {"type": "CODE", "url": raw_url(branch, path)} for path in FILES}

    # Before the app's branch is merged, main has no snapshot.json to read. The
    # one module holding that default is small enough to inline, so a preview
    # link opens against real data instead of the error screen.
    if data_branch:
        files["src/source.js"] = {
            "type": "CODE",
            "contents": f"export const DEFAULT_SOURCE =\n  '{snapshot_url(data_branch)}';\n",
        }

    query = {
        "name": "Top 100",
        "description": "Top 100 US stocks by market cap, ranked daily",
        "files": json.dumps(files, separators=(",", ":")),
        "dependencies": ",".join(DEPENDENCIES),
        "platform": "mydevice",   # opens on the QR pane for Expo Go
        "theme": "dark",
        "deviceAppearance": "dark",
        "supportedPlatforms": "mydevice,ios,android",
    }
    return "https://snack.expo.dev/?" + urllib.parse.urlencode(query)


def check(branch: str) -> bool:
    ok = True
    for path in FILES:
        url = raw_url(branch, path)
        try:
            req = urllib.request.Request(url, method="HEAD")
            with urllib.request.urlopen(req, timeout=20) as resp:
                status = resp.status
        except urllib.error.HTTPError as exc:
            status = exc.code
        except Exception as exc:  # noqa: BLE001 - report and keep going
            print(f"  ERROR {path}: {exc}")
            ok = False
            continue
        print(f"  {status} {path}")
        if status != 200:
            ok = False
    return ok


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--branch", default="main",
                        help="branch holding the app source")
    parser.add_argument("--data-branch", default=None,
                        help="pin snapshot.json to this branch (default: whatever "
                             "src/source.js says, i.e. main)")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()

    if args.check:
        print(f"Checking {len(FILES)} files on '{args.branch}':")
        if not check(args.branch):
            print("\nSome files are missing -- push the branch first.")
            return 1
        print()

    url = build(args.branch, args.data_branch)
    print(url)
    print(f"\n({len(url)} characters)", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())

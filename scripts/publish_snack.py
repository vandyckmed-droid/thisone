#!/usr/bin/env python3
"""
Publish app/snack/App.js as a saved Expo Snack and print a tap-to-open link.

Why saving matters: a Snack built from URL parameters is ephemeral, so the only
way onto a phone is scanning its QR code. Saving mints a permanent id, and a
saved Snack can be opened by an `exp://` deep link that launches Expo Go
directly -- one tap, no QR, no copy-paste.

Expo only serves a Snack runtime for some SDK versions, and saving against an
unsupported one fails *silently*: the save succeeds and the page loads, but the
deep link comes back without its `snack=` parameter and the phone has nothing
to open. So this script saves, reads the deep link back off the Snack's own
page, and treats a missing `snack=` as failure -- walking SDK versions from
newest down until one actually binds.

Usage:
    python3 scripts/publish_snack.py [--bundle] [--sdk 54.0.0]

    --bundle   regenerate app/snack/App.js first
    --sdk      force one SDK version instead of probing
"""

import argparse
import json
import re
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request

SAVE_ENDPOINT = "https://exp.host/--/api/v2/snack/save"
VERSIONS_ENDPOINT = "https://exp.host/--/api/v2/versions"
SNACK_PAGE = "https://snack.expo.dev/{id}"
BUNDLE = "app/snack/App.js"

DEPENDENCIES = ["react-native-svg", "@react-native-async-storage/async-storage"]
NAME = "Top 100"
DESCRIPTION = "Top 100 US stocks by market cap, ranked daily"

UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)"


def get(url: str, timeout: int = 45) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", "replace")


def candidate_sdks(forced: str | None) -> list[str]:
    if forced:
        return [forced]
    try:
        data = json.loads(get(VERSIONS_ENDPOINT))
        versions = list((data.get("data") or data).get("sdkVersions", {}))
    except Exception:
        versions = []
    versions.sort(key=lambda v: [int(p) for p in v.split(".")], reverse=True)
    # Newest first; Expo's Snack runtime usually trails the newest SDK by a
    # release or two, so a handful of attempts is plenty.
    return versions[:5] or ["54.0.0"]


def save(code: str, sdk: str) -> str:
    payload = {
        "manifest": {
            "name": NAME,
            "description": DESCRIPTION,
            "sdkVersion": sdk,
            "dependencies": {d: "*" for d in DEPENDENCIES},
        },
        "code": {"App.js": {"type": "CODE", "contents": code}},
        "dependencies": {d: {"version": "*"} for d in DEPENDENCIES},
    }
    req = urllib.request.Request(
        SAVE_ENDPOINT,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json", "User-Agent": UA},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=90) as resp:
        return json.loads(resp.read().decode())["id"]


def deep_link(snack_id: str) -> str | None:
    """Read the Snack's own deep link back, minus the ephemeral edit channel.

    A bindable Snack renders `snack=<id>` in its link. One saved against an
    unsupported runtime does not, which is the only reliable signal that the
    save was useless.
    """
    html = get(SNACK_PAGE.format(id=snack_id))
    links = re.findall(r"exp://u\.expo\.dev/[^\"'\\ ]+", html)
    for link in links:
        link = link.replace("&amp;", "&")
        if f"snack={snack_id}" not in link:
            continue
        # snack-channel drives live reload for an open editor tab and is
        # meaningless in a link someone taps tomorrow.
        parsed = urllib.parse.urlparse(link)
        kept = [
            (k, v) for k, v in urllib.parse.parse_qsl(parsed.query)
            if k != "snack-channel"
        ]
        return urllib.parse.urlunparse(parsed._replace(
            query=urllib.parse.urlencode(kept)))
    return None


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--bundle", action="store_true")
    parser.add_argument("--sdk", default=None)
    args = parser.parse_args()

    if args.bundle:
        subprocess.run(["scripts/bundle_snack.sh"], check=True)

    try:
        code = open(BUNDLE, encoding="utf-8").read()
    except OSError:
        print(f"{BUNDLE} is missing -- run scripts/bundle_snack.sh first.", file=sys.stderr)
        return 1

    source = re.search(r"https://raw\.githubusercontent\.com[^'\"]*snapshot\.json", code)
    print(f"Bundle: {len(code):,} bytes, reading {source.group(0) if source else 'UNKNOWN'}")

    for sdk in candidate_sdks(args.sdk):
        print(f"Saving against SDK {sdk} ... ", end="", flush=True)
        try:
            snack_id = save(code, sdk)
        except urllib.error.HTTPError as exc:
            print(f"save failed ({exc.code})")
            continue

        link = deep_link(snack_id)
        if not link:
            print(f"saved as {snack_id} but the runtime will not bind it")
            continue

        print("ok")
        print(f"\n  Snack id : {snack_id}")
        print(f"  Tap link : {link}")
        print(f"  Web link : {SNACK_PAGE.format(id=snack_id)}")
        return 0

    print("\nNo SDK version produced a bindable Snack.", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())

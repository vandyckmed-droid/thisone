#!/usr/bin/env python3
"""
Publish app/snack/App.js as a saved Expo Snack and print a tap-to-open link.

Why saving matters: a Snack built from URL parameters is ephemeral, so the only
way onto a phone is scanning its QR code. Saving mints a permanent id, and a
saved Snack can be opened by an `exp://` deep link that launches Expo Go
directly -- one tap, no QR, no copy-paste.

Picking the SDK version is the whole difficulty, and it fails in two different
ways:

1. Saving against an SDK whose Snack runtime does not exist fails *silently* --
   the save succeeds and the page loads, but the deep link comes back without
   its `snack=` parameter and the phone has nothing to open.
2. Worse, an SDK can bind on Snack's side and still be too new for the Expo Go
   actually installed on the phone, which greets the tap with "Project is
   incompatible with this version of Expo Go".

Case 2 means "newest version that binds" is the wrong target. The right target
is the runtime Snack itself falls back to, which is the one its Expo Go
integration ships against. Only the page of a *saved* Snack renders that value,
so this script saves a deliberately unbindable probe, reads the fallback
runtime off its page, and then publishes against exactly that.

Usage:
    python3 scripts/publish_snack.py [--bundle] [--sdk 54.0.0]

    --bundle   regenerate app/snack/App.js first
    --sdk      force one SDK version instead of probing for it
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
SNACK_PAGE = "https://snack.expo.dev/{id}"
NATIVE_MODULES = "https://exp.host/--/api/v2/sdks/{sdk}/native-modules"
BUNDLE = "app/snack/App.js"

DEPENDENCIES = ["react-native-svg", "@react-native-async-storage/async-storage", "expo-haptics"]
NAME = "Top 300"
DESCRIPTION = "Top 300 US stocks and the top 100 per sector, ranked"

UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)"


def get(url: str, timeout: int = 45) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", "replace")


# An SDK far beyond anything Expo will ship, so the probe is guaranteed not to
# bind and its page is guaranteed to show the fallback runtime.
IMPOSSIBLE_SDK = "99.0.0"


def runtime_pattern(html: str) -> str | None:
    m = re.search(r"exposdk(?:%3A|:)([0-9]+\.[0-9]+\.[0-9]+)", html)
    return m.group(1) if m else None


def default_runtime(code: str) -> str | None:
    """The SDK Snack falls back to -- i.e. the one Expo Go can actually run.

    Only a saved Snack's page renders a runtime-version, so this saves a probe
    against an impossible SDK. Snack cannot bind it, falls back to its default,
    and renders that default in the page's deep link.
    """
    try:
        probe_id = save(code, IMPOSSIBLE_SDK)
    except urllib.error.HTTPError:
        return None
    return runtime_pattern(get(SNACK_PAGE.format(id=probe_id)))


def dependency_versions(sdk: str) -> dict[str, str]:
    """Pin each dependency to the version Expo bundles with this SDK.

    Asking for "*" makes Snackager try to build whatever npm currently calls
    latest, which need not work against an older runtime -- it failed outright
    with "Unable to fetch module react-native-svg@* for ios". Expo publishes the
    version it actually ships per SDK, so use that.
    """
    try:
        rows = json.loads(get(NATIVE_MODULES.format(sdk=sdk)))["data"]
    except Exception:
        return {d: "*" for d in DEPENDENCIES}
    published = {r["npmPackage"]: r["versionRange"] for r in rows}
    return {d: published.get(d, "*") for d in DEPENDENCIES}


def save(code: str, sdk: str, versions: dict[str, str] | None = None,
         name: str | None = None) -> str:
    if versions is None:
        versions = {d: "*" for d in DEPENDENCIES}
    payload = {
        "manifest": {
            "name": name or NAME,
            "description": DESCRIPTION,
            "sdkVersion": sdk,
            "dependencies": dict(versions),
        },
        "code": {"App.js": {"type": "CODE", "contents": code}},
        "dependencies": {d: {"version": v} for d, v in versions.items()},
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
    # The two flags below exist for bisecting a Snack that will not load. The
    # SDK a Snack must target is whatever the installed Expo Go supports, and
    # nothing reachable from here reports that -- so the only way to find it is
    # to publish a trivial app at two SDKs and see which one opens.
    parser.add_argument("--file", default=BUNDLE,
                        help="publish this file instead of the app bundle")
    parser.add_argument("--no-deps", action="store_true",
                        help="publish with no dependencies, to rule them out")
    parser.add_argument("--name", default=None)
    args = parser.parse_args()

    if args.bundle:
        subprocess.run(["scripts/bundle_snack.sh"], check=True)

    try:
        code = open(args.file, encoding="utf-8").read()
    except OSError:
        print(f"{args.file} is missing -- run scripts/bundle_snack.sh first.", file=sys.stderr)
        return 1

    source = re.search(r"https://raw\.githubusercontent\.com[^'\"]*/data/", code)
    print(f"Bundle: {len(code):,} bytes, reading {source.group(0) if source else 'UNKNOWN'}")

    sdk = args.sdk or default_runtime(code)
    if not sdk:
        print("Could not determine the Snack runtime version.", file=sys.stderr)
        return 1
    print(f"Snack runtime: SDK {sdk}")

    versions = {} if args.no_deps else dependency_versions(sdk)
    for dep, version in versions.items():
        print(f"  {dep} @ {version}")
    unpinned = [d for d, v in versions.items() if v == "*"]
    if unpinned:
        print(f"Expo publishes no SDK {sdk} version for: {', '.join(unpinned)}", file=sys.stderr)
        return 1

    snack_id = save(code, sdk, versions, name=args.name)
    link = deep_link(snack_id)
    if not link:
        print(f"Saved as {snack_id}, but the runtime will not bind it.", file=sys.stderr)
        return 1

    # The rendered runtime is what the phone will be asked for. If it drifted
    # from what we saved, the tap would fail on the device rather than here.
    served = runtime_pattern(link)
    if served != sdk:
        print(f"Snack serves SDK {served}, not the {sdk} it was saved with.", file=sys.stderr)
        return 1

    print(f"\n  Snack id : {snack_id}")
    print(f"  Tap link : {link}")
    print(f"  Web link : {SNACK_PAGE.format(id=snack_id)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

"""Verify Rust's JNI entry points survive R8 in the actual release APK."""

import re
import subprocess
import sys
import tempfile
import zipfile


def verify(apk, dexdump):
    expected = {
        ("GoogleOAuthManager", "start", "(Landroid/content/Context;Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;Z)V"),
        ("NativeHttp", "request", "(Landroid/content/Context;Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;Z)Ljava/lang/String;"),
        ("GoogleOAuthBridge", "finishOAuth", "(Ljava/lang/String;Ljava/lang/String;)V"),
    }
    with zipfile.ZipFile(apk) as archive, tempfile.TemporaryDirectory() as directory:
        for name in archive.namelist():
            if not re.fullmatch(r"classes\d*\.dex", name):
                continue
            output = subprocess.run(
                [dexdump, archive.extract(name, directory)],
                capture_output=True, text=True, errors="replace", check=True,
            ).stdout
            for section in output.split("Class #")[1:]:
                for cls, method, signature in expected.copy():
                    if f"Class descriptor  : 'Lcom/passwordkeeper/vault/{cls};'" not in section:
                        continue
                    pattern = (
                        r"name\s+: '" + re.escape(method) + r"'\s+"
                        r"type\s+: '" + re.escape(signature) + r"'\s+"
                        r"access\s+: [^\n]*\(PUBLIC STATIC[^\n]*\)"
                    )
                    if re.search(pattern, section):
                        expected.remove((cls, method, signature))
    if expected:
        for cls, method, signature in sorted(expected):
            print(f"Missing JNI entry point: {cls}.{method}{signature}", file=sys.stderr)
        return 1
    print("Release APK: all three JNI entry points preserved with exact signatures.")
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("Usage: verify-android-jni.py <apk> <dexdump>")
    sys.exit(verify(*sys.argv[1:]))

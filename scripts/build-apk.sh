#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
sdk_root="${ANDROID_SDK_ROOT:-/workspace/android-tools/sdk}"
build_tools="${ANDROID_BUILD_TOOLS:-$sdk_root/build-tools/35.0.0}"
android_jar="${ANDROID_JAR:-$sdk_root/platforms/android-35/android.jar}"
ecj_jar="${ECJ_JAR:-/workspace/android-tools/downloads/ecj.jar}"
signing_store="${APK_SIGNING_KEYSTORE:-var/android-signing/founders-morning.jks}"
signing_pass="${APK_SIGNING_PASSWORD_FILE:-var/android-signing/store.pass}"
for path in "$build_tools/aapt2" "$build_tools/d8" "$build_tools/zipalign" "$build_tools/apksigner" "$android_jar" "$ecj_jar"; do
  test -f "$path" || { echo "Missing build prerequisite: $path" >&2; exit 1; }
done
mkdir -p android/build/classes android/build/dex android/build/generated dist "$(dirname "$signing_store")" "$(dirname "$signing_pass")"
if [ ! -f "$signing_store" ]; then
  if [ ! -f "$signing_pass" ]; then
    python3 - "$signing_pass" <<'PY'
import pathlib,secrets,sys
p=pathlib.Path(sys.argv[1]);p.write_text(secrets.token_urlsafe(32));p.chmod(0o600)
PY
  fi
  keytool -genkeypair -keystore "$signing_store" -alias founders-morning -storepass:file "$signing_pass" -keypass:file "$signing_pass" -keyalg RSA -keysize 3072 -sigalg SHA256withRSA -validity 10000 -dname 'CN=Founders Morning, O=talQen, C=KE'
  chmod 600 "$signing_store"
fi
test -f "$signing_pass" || { echo 'Signing password file is missing; restore the original private signing files.' >&2; exit 1; }
"$build_tools/aapt2" compile --dir android/app/src/main/res -o android/build/compiled.zip
"$build_tools/aapt2" link -o android/build/resources.apk -I "$android_jar" --manifest android/app/src/main/AndroidManifest.xml --java android/build/generated -A android/app/src/main/assets android/build/compiled.zip
java -jar "$ecj_jar" -source 8 -target 8 -classpath "$android_jar" -d android/build/classes android/app/src/main/java/app/talqen/foundersmorning/MainActivity.java
python3 <<'PY'
from pathlib import Path
from zipfile import ZipFile
root=Path('android/build/classes')
with ZipFile('android/build/classes.jar','w') as z:
 for p in root.rglob('*.class'): z.write(p,p.relative_to(root))
PY
"$build_tools/d8" --lib "$android_jar" --min-api 26 --output android/build/dex android/build/classes.jar
cp android/build/resources.apk android/build/unsigned.apk
zip -q -j android/build/unsigned.apk android/build/dex/classes*.dex
"$build_tools/zipalign" -f -p 4 android/build/unsigned.apk android/build/aligned.apk
"$build_tools/apksigner" sign --ks "$signing_store" --ks-key-alias founders-morning --ks-pass "file:$signing_pass" --out dist/founders-morning-offline.apk android/build/aligned.apk
"$build_tools/apksigner" verify --verbose dist/founders-morning-offline.apk
"$build_tools/zipalign" -c -v 4 dist/founders-morning-offline.apk >/dev/null
sha256sum dist/founders-morning-offline.apk >dist/SHA256SUMS
echo 'Built and verified dist/founders-morning-offline.apk'

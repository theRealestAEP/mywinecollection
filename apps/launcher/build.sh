#!/bin/sh
# Builds Cellar, the Android app for a wall tablet: dist/cellar.apk.
# Needs the Android SDK (platform android-35 and build-tools) and a JDK.
# The first build makes a signing key, launcher.keystore, which stays out of
# git; keep it, since an update must be signed with the same key.
set -e
cd "$(dirname "$0")"
SDK="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
TOOLS="$SDK/build-tools/$(ls "$SDK/build-tools" | tail -1)"
ANDROID_JAR="$SDK/platforms/android-35/android.jar"
WORK=../../dist/launcher

rm -rf "$WORK"
mkdir -p "$WORK/classes"

# The manifest and the icon
"$TOOLS/aapt2" compile --dir res -o "$WORK/res.zip"
"$TOOLS/aapt2" link -o "$WORK/app.apk" -I "$ANDROID_JAR" --manifest AndroidManifest.xml "$WORK/res.zip"

# The code
javac -source 8 -target 8 -bootclasspath "$ANDROID_JAR" -nowarn -d "$WORK/classes" src/*.java
"$TOOLS/d8" --lib "$ANDROID_JAR" --min-api 30 --output "$WORK" $(find "$WORK/classes" -name '*.class')
(cd "$WORK" && zip -q app.apk classes.dex)

# Align and sign
"$TOOLS/zipalign" -f 4 "$WORK/app.apk" "$WORK/app-aligned.apk"
if [ ! -f launcher.keystore ]; then
  keytool -genkeypair -keystore launcher.keystore -storepass wineportraits -keypass wineportraits \
    -alias launcher -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Wine Portraits"
fi
"$TOOLS/apksigner" sign --ks launcher.keystore --ks-pass pass:wineportraits --out ../../dist/cellar.apk "$WORK/app-aligned.apk"
echo "Built dist/cellar.apk"

@echo off
rem Builds the Sukoon Android app.
rem   1. builds the website            (npm run build)
rem   2. copies it into this project   (scripts\android-sync.mjs)
rem   3. builds the signed APK         (Gradle)
rem   4. puts a copy next to this file as Sukoon-v<version>.apk
rem The full Gradle output goes to build.log in this folder.

set "JAVA_HOME=C:\Users\Analyst Profile\Android\jdk-25.0.4.1+1"
set "ANDROID_HOME=C:\Users\Analyst Profile\Android\Sdk"
set "ANDROID_SDK_ROOT=%ANDROID_HOME%"
set "PATH=%JAVA_HOME%\bin;%ANDROID_HOME%\platform-tools;%PATH%"
set "PROJECT=%~dp0"

cd /d "%PROJECT%.."
echo === 1/3 Building the website ===
call npm run build
if errorlevel 1 goto failed
call node scripts\android-sync.mjs
if errorlevel 1 goto failed

cd /d "%PROJECT%"
echo === 2/3 Building the APK (a few minutes the first time) ===
echo === GRADLE assembleRelease === > "%PROJECT%build.log"
call "%PROJECT%gradlew.bat" --no-daemon --console=plain --warning-mode=summary :app:assembleRelease >> "%PROJECT%build.log" 2>&1
if errorlevel 1 (
  echo BUILD_EXIT 1 >> "%PROJECT%build.log"
  echo.
  echo The APK build failed. The last lines of build.log:
  powershell -NoProfile -Command "Get-Content -LiteralPath '%PROJECT%build.log' -Tail 40"
  goto failed
)
echo BUILD_EXIT 0 >> "%PROJECT%build.log"

echo === 3/3 Copying the APK ===
copy /y "%PROJECT%app\build\outputs\apk\release\app-release.apk" "%PROJECT%Sukoon-v1.2.0.apk" > nul
if errorlevel 1 goto failed
echo.
echo BUILD_OK  The app is at %PROJECT%Sukoon-v1.2.0.apk
exit /b 0

:failed
echo.
echo BUILD_FAILED
exit /b 1

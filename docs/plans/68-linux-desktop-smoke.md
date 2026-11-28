# #68: Linux desktop smoke

Start with the native boundaries requested for Linux: launch a production-mode
Tauri build, open a copy of the checkout fixture through GTK, rename an element,
save to that file, reopen it, and export a Markdown review through the GTK save
dialog. Assert the saved bytes and Markdown contain the renamed element.

Run the suite opt-in on an isolated X11 display with tauri-driver,
WebKitWebDriver, xdotool, and Python 3. Use WebDriver for the WebView, and real
keyboard events for the native chooser and menu. Keep all app data and test
files isolated. On failure, retain the driver log and desktop screenshot.
Keep default CI unchanged until the real GTK interactions are proven reliable
on the hosted runner. File associations, the system keyring, updates, signing,
macOS, and Windows remain outside this first slice of #68.

## Run locally

Install `tauri-driver` (`cargo install --locked tauri-driver`), the matching OS
`WebKitWebDriver` package (Ubuntu: `webkit2gtk-driver`), and `xdotool`. On an
isolated X11 desktop with a window manager and the repo's Node version active,
run from the checkout:

```sh
npx tauri build --debug --no-bundle
python3 scripts/desktop-smoke.py --artifacts test-results/desktop
```

Use `--binary` to exercise a different production-mode build, or `--driver` and
`--native-driver` if the drivers are not on `PATH`. Do not interact with the
desktop during the run: the test types into real GTK dialogs. The failure
screenshot uses ImageMagick's `import` when available, otherwise it captures
only the WebView. The test uses a disposable XDG profile and fixture copy.

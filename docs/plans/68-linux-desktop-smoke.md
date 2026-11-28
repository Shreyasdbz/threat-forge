# #68: Linux desktop smoke

Start with the native boundaries requested for Linux: launch a production-mode
Tauri build, open a copy of the checkout fixture through GTK, rename an element,
save to that file, reopen it, and export a Markdown review from the native File
menu. Assert the saved bytes and Markdown contain the renamed element.

Run the suite opt-in on an isolated X11 display with tauri-driver,
WebKitWebDriver, xdotool, and Python 3. Use WebDriver for the WebView, and real
keyboard events for the native chooser and menu. Keep all app data and test
files isolated. On failure, retain the driver log and desktop screenshot.
Keep default CI unchanged until the real GTK interactions are proven reliable
on the hosted runner. File associations, the system keyring, updates, signing,
macOS, and Windows remain outside this first slice of #68.

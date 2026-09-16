# Living Room Remote

Control an Android TV from your phone browser: live screen, tap and swipe, directional pad, keyboard, volume and fullscreen. A computer on the same network bridges the phone to the TV over ADB. No cloud account or Node runtime dependencies.

This is an early personal-use project, tested with an Android 9 TCL TV and iPhone Safari. It is not a universal TV remote: your TV must allow ADB debugging and scrcpy screen capture/input.

## What it does

- Continuous H.264 capture through scrcpy, converted to an MJPEG feed for Safari.
- Persistent scrcpy control connection for keys, taps and swipes.
- Fullscreen live view with touch coordinates adjusted for letterboxing; expanded viewport fallback on browsers without element fullscreen.
- Hold-to-repeat navigation, volume, keyboard and VLC/T-Cast shortcuts (apps must already be installed).
- Editable TV and room names under **Personalize**, stored on the host computer.
- Private pairing link, authenticated stream/control endpoints and local settings.

The current stream targets 20 fps. Latency depends on the TV, encoder and Wi-Fi. It does not transmit audio, wake a sleeping computer or bypass protected video capture restrictions.

## Requirements

- Node.js 20 or later.
- [Android platform tools (ADB)](https://developer.android.com/tools/releases/platform-tools).
- [scrcpy 3.3.4](https://github.com/Genymobile/scrcpy/releases/tag/v3.3.4), including its matching `scrcpy-server` file.
- [FFmpeg](https://ffmpeg.org/download.html) on the host.
- A TV with ADB debugging enabled and authorized for your computer.

The server/protocol version is pinned to scrcpy 3.3.4. A different version may require adapting the bridge. Dependencies are installed separately; none of their binaries are included here.

## Setup

```sh
mkdir -p .local
cp config.example.json .local/config.json
```

Edit `.local/config.json`:

| Setting | Value |
| --- | --- |
| `host` | Your computer's Wi-Fi IPv4 address. The default `127.0.0.1` allows only this computer. |
| `device` | The TV's ADB serial, as shown by `adb devices`; often `TV_IP:5555`. |
| `adb`, `ffmpeg` | Executable names on PATH or absolute paths. |
| `scrcpyServer` | Absolute path to the installed scrcpy 3.3.4 server file. |
| `screenWidth`, `screenHeight` | TV display size used by the fallback screenshot controls. |
| `streamWidth`, `streamHeight` | Actual encoded dimensions (default `960 × 544` for the tested 1080p TV). Must match the encoder output for touch input. |
| `tvName`, `roomName` | Your own names; also editable in the phone interface. |

For network ADB, connect and authorize the computer using your TV's debugging workflow:

```sh
adb connect YOUR_TV_IP:5555
adb devices
npm start
```

Open the **complete pairing URL printed in the terminal**, including its `#` suffix, in Safari on the phone. Both devices must share the same trusted Wi-Fi. Keep the computer awake. Safari → Share → Add to Home Screen creates an app-style shortcut; a separate browser context may need pairing again.

On macOS, double-click `Start Remote.command` to keep the computer awake while the remote runs. Stop with Control-C. Only run one bridge instance at a time.

Environment overrides: `REMOTE_HOST`, `PORT`, `TV_ADB_SERIAL`, `ADB_PATH`, `FFMPEG_PATH`, `SCRCPY_SERVER_PATH`.

## Use

**Remote** provides the directional pad and playback controls. **Touch TV** opens the live feed; tap or swipe the picture. Choose **Fullscreen** and rotate the phone for a larger view. **Keyboard** sends text to a field already focused on the TV. English/ASCII text is supported; `%` is rejected. **Personalize** saves TV and room names locally for all paired phones.

## Privacy and access

- `.local/` is ignored by Git. It contains your machine-specific config and pairing token.
- Never share terminal logs or the pairing URL: the URL grants TV control.
- The default server binds to loopback. Setting a LAN host enables LAN access. This uses plain HTTP and is intended only for a trusted local network; do not expose its ports or ADB to the internet.
- Every stream and control request requires pairing. Host/Origin checks and allowlisted commands limit access; there is no arbitrary shell endpoint.
- Frames are held in memory. No recordings, screenshots, telemetry or cloud uploads are written by the app.
- To revoke all pairings: stop the server, delete `.local/token`, then restart and pair again.
- App shortcuts and simulated input have the same effects as using your physical remote. Some apps restrict screen capture or injected input.

## Development

```sh
npm test
npm run check:privacy
```

Tests use a fake TV for authentication, input validation and settings, and verify the scrcpy control packet layout. The privacy check examines Git-tracked/staged files for common sensitive patterns and local configuration values; it is a guardrail, not a guarantee. Review `git diff --cached` before publishing.

Connection troubleshooting: confirm `adb devices` lists the TV as `device`, verify paths and scrcpy versions, check the host firewall, and refresh the phone page. A black video region may be protected content. Incorrect tap positions usually mean `streamWidth`/`streamHeight` differ from the actual encoded dimensions. The bridge logs encoder details on startup.

## License and credits

MIT for this project's code; see [LICENSE](LICENSE). It interoperates with [scrcpy](https://github.com/Genymobile/scrcpy) (Apache-2.0) and separately installed FFmpeg/ADB. Those projects retain their own licenses. This project is not affiliated with Apple, Google or TCL.

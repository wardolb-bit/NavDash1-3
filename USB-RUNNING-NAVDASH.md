# Running NavDash From A USB Drive With Portable Node

Recommended USB layout:

```text
USB:\
  nodejs\
    node.exe
    npm.cmd
  NavDash\
    Start-NavDash-USB.bat
    package.json
    node_modules\
    app\
    server\
    data\
```

Optional iPad client layout:

```text
USB:\
  nodejs\
  NavDash\
  NavDash-iPad-client\
    Start-iPad-Client-USB.bat
```

## One-Time USB Setup

1. Put the Windows portable Node folder on the USB as `nodejs`.
2. Build NavDash on the laptop, not on the ship computer.
3. Copy the whole `NavDash` folder to the USB after the laptop build finishes.
4. Keep `NavDash\node_modules` with it so the app can run without internet.
5. Keep `NavDash\.next` with it. This is the prebuilt main site.
6. Keep `NavDash\data` with it if you want the current loaded route and deck log.

The locked-down ship computer should not need to run `npm install`, `npm run build`, or use the internet.

The important shared files are:

```text
NavDash\data\loaded-route.json
NavDash\data\deck-log.json
```

## Start NavDash

Double-click:

```text
NavDash\Start-NavDash-USB.bat
```

The launcher only runs the already-built app. If `.next` or `node_modules` is missing, it stops and tells you to rebuild/copy again from the laptop.

The host computer can open:

```text
http://localhost:3000
```

Other ship computers use:

```text
http://HOST-COMPUTER-IP:3000
```

AIS/WebSocket traffic is served at:

```text
ws://HOST-COMPUTER-IP:8081
```

## Optional iPad Client

If using the separate iPad client, copy `NavDash-iPad-client` beside `NavDash` and double-click:

```text
NavDash-iPad-client\Start-iPad-Client-USB.bat
```

The iPad client must also be built on the laptop first. Keep its `dist` and `node_modules` folders when copying it to the USB.

Then open:

```text
http://HOST-COMPUTER-IP:5174
```

## Serial Port Settings

Default AIS settings:

```text
AIS_PORT=COM4
AIS_BAUD=38400
```

To override them before starting, set environment variables in the command window:

```bat
set AIS_PORT=COM5
set AIS_BAUD=38400
Start-NavDash-USB.bat
```

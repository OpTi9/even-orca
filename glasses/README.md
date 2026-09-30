# Orca for Even Realities G2

An [Even Hub](https://hub.evenrealities.com/docs) app that puts your Orca oh-my-pi (`omp`) sessions on G2 glasses. You can see which sessions need you, read what each one last said, and reply by voice.

It is a separate web app with its own install, like `mobile/`. It connects to Orca as an ordinary paired mobile client, using the phone app's encrypted connection code from `mobile/src/transport/` unchanged. So it sees the same local, WSL and SSH sessions the phone app does, and needs no desktop changes.

## How it works

```
Orca desktop ──encrypted WebSocket (mobile pairing)── Even App WebView on the phone ──BLE── G2
   worktree.ps / terminal.send / speech.dictation.*          this app                display + input
```

- **Sessions.** The app polls `worktree.ps` every 3 s, or every 15 s in the background, and passes the last snapshot id so an unchanged host answers with almost nothing. It lists top-level agent rows whose type is `omp`, with sessions that need you first. State labels and stale-status decay reuse the phone app's `agent-row-display.ts`.
- **Replies.** Voice audio from the glasses (16 kHz, 16-bit) streams to Orca's own `speech.dictation.*`, so transcription runs on your computer with the model chosen in Orca's voice settings. The text is typed into the pane the same way the desktop's agent-note send does:
  1. A bracketed paste with `requireAgentStatus: 'sendable'`.
  2. A 50 ms pause.
  3. A separately guarded Enter.

  The host refuses a guarded send while OMP is waiting on a permission, so speech never lands in an approval prompt. Approvals are still answered in Orca.

- **Display.** The screen is 576×288 and built from text and list containers. Text is stripped of ANSI escapes, split into pages of about 380 characters, and limited to glyphs the G2 firmware font has, since missing glyphs are silently dropped.

## Controls

| Where        | Tap            | Double-tap    | Swipe                | Hold            |
| ------------ | -------------- | ------------- | -------------------- | --------------- |
| Session list | Open session   | Exit dialogue | Move selection       |                 |
| Session      | Reply by voice | Back          | Previous / next page | Push-to-talk    |
| Listening    | Stop           | Cancel        |                      | Release to stop |
| Review       | Send           | Discard       |                      |                 |

## Setup

1. In Orca, open **Settings > Mobile** and copy the pairing code. Pair the glasses as their own device.
2. `cd glasses && pnpm install && pnpm dev`
3. `pnpm qr`, then scan the code with the Even App to sideload the app onto the glasses.
4. On the phone page, paste the pairing link and tap **Pair**. The pairing is kept in Even App storage and reconnects automatically.

Dictation needs voice dictation turned on in Orca, with a downloaded model.

## Development

```sh
pnpm test        # vitest: reducer, projection, input mapping, client, renderer, app wiring
pnpm typecheck
pnpm lint        # extends the repo .oxlintrc.json
pnpm build
pnpm pack        # .ehpk for Even Hub
```

The app imports mobile and shared sources directly. `vite.config.ts` points their `zod`, `tweetnacl` and `expo-crypto` imports at this package (`expo-crypto` maps to a Web Crypto shim), and pins the tsconfig used to compile shared files. Replies from the host are parsed with lenient schemas, per [remote wire compatibility](../docs/reference/remote-wire-compatibility.md).

## Not done yet

- **Only tested against fakes.** Nothing has been checked on G2 hardware or the Even Hub simulator. The page, input and lifecycle quirks handled here come from the SDK notes, not from observation.
- **Direct connection only.** The pairing's `ws://` address must be reachable from the phone (LAN or Tailscale). The Orca relay path is not wired up. It isn't known yet whether the Even App WebView allows plain `ws://` to a LAN address.
- **Packaging.** `app.json`'s `network` whitelist holds a placeholder. Set it to your Orca address before `pnpm pack`.
- **Approving from the glasses.** This needs the keystrokes OMP's approval prompt expects, taken from a recorded transcript ([agent PTY transcript capture](../docs/reference/agent-pty-transcript-capture.md)), not guessed.

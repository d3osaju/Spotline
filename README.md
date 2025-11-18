# Music Lyrics GNOME Extension

A GNOME Shell extension that displays the currently playing song from Spotify, YouTube Music, or any MPRIS-compatible player in the top bar. Shows lyrics when available, otherwise displays the song name and artist.

## Features

- **Real-time synced lyrics** - Shows the current line of lyrics synchronized with playback
- **Multi-player support** - Works with Spotify, YouTube Music, and other MPRIS players
- Automatically fetches lyrics from LRCLIB (free, no API key required)
- Falls back to song name and artist if lyrics aren't available
- Updates in real-time as the song plays
- Supports both synced (LRC format) and plain lyrics
- Automatically switches between active players

## Installation

### System-wide installation (requires sudo):
```bash
sudo mkdir -p /usr/share/gnome-shell/extensions/spotify-lyrics@gnome-shell-extension
sudo cp -r * /usr/share/gnome-shell/extensions/spotify-lyrics@gnome-shell-extension/
```

### User installation (no sudo required):
```bash
mkdir -p ~/.local/share/gnome-shell/extensions/spotify-lyrics@gnome-shell-extension
cp -r * ~/.local/share/gnome-shell/extensions/spotify-lyrics@gnome-shell-extension/
```

### After installation:

1. Restart GNOME Shell:
   - On X11: Press `Alt+F2`, type `r`, and press Enter
   - On Wayland: Log out and log back in

2. Enable the extension:
   ```bash
   gnome-extensions enable spotify-lyrics@gnome-shell-extension
   ```

   Or use GNOME Extensions app.

## How It Works

The extension uses:
- **LRCLIB API** - A free, open-source lyrics database (no API key needed)
- **MPRIS DBus interface** - To monitor music playback from desktop apps and browsers
- **LRC format parsing** - For time-synced lyrics that update as the song plays

When a song plays, the extension:
1. Detects active music players (desktop apps or browser tabs)
2. Fetches synced lyrics from LRCLIB
3. Parses the LRC timestamps
4. Displays the current line based on playback position
5. Updates every 500ms for smooth transitions
6. Automatically switches to whichever player is currently playing

## Requirements

- GNOME Shell 45 or 46
- Spotify, YouTube Music, or any MPRIS-compatible music player
- DBus support (standard on most Linux systems)
- Internet connection (for fetching lyrics)

## Supported Players

- **Spotify** - Desktop app and web player (in browser)
- **YouTube Music** - Desktop app and web player (in browser)
- **Browser-based players** - Works with Chromium, Chrome, Firefox, Brave, Edge
- Any MPRIS-compatible media player

The extension automatically detects music playing in your browser tabs and displays lyrics just like desktop apps.

## Development

To test changes:
```bash
# View logs
journalctl -f -o cat /usr/bin/gnome-shell

# Reload extension (X11 only)
# Alt+F2, then type 'r' and press Enter
```

## Troubleshooting

- **Extension not showing**: Check if a supported music player is running
- **"No music playing" message**: Start your music player and play a song
- **Browser players not detected**: Make sure your browser supports MPRIS (most modern browsers do). You may need to enable media control in browser settings
- **No lyrics showing**: Not all songs have synced lyrics in the database. The extension will fall back to showing the song name
- **Lyrics out of sync**: The extension relies on the player's position reporting. Try pausing and resuming the song
- **Multiple players**: The extension prioritizes the currently playing player. If multiple players are active, it connects to the one that's playing
- **Check available players**: List all MPRIS players on your system:
  ```bash
  dbus-send --session --dest=org.freedesktop.DBus --type=method_call --print-reply /org/freedesktop/DBus org.freedesktop.DBus.ListNames | grep mpris
  ```
- **Check player metadata**: Test if a specific player is working:
  ```bash
  # For Spotify
  dbus-send --print-reply --dest=org.mpris.MediaPlayer2.spotify /org/mpris/MediaPlayer2 org.freedesktop.DBus.Properties.Get string:org.mpris.MediaPlayer2.Player string:Metadata
  
  # For browser players (replace instance number)
  dbus-send --print-reply --dest=org.mpris.MediaPlayer2.chromium.instance12345 /org/mpris/MediaPlayer2 org.freedesktop.DBus.Properties.Get string:org.mpris.MediaPlayer2.Player string:Metadata
  ```
- **Check logs**: View GNOME Shell logs for errors:
  ```bash
  journalctl -f -o cat /usr/bin/gnome-shell
  ```

# Spotify Lyrics GNOME Extension

A GNOME Shell extension that displays the currently playing song from Spotify in the top bar. Shows lyrics when available, otherwise displays the song name and artist.

## Features

- **Real-time synced lyrics** - Shows the current line of lyrics synchronized with playback
- Automatically fetches lyrics from LRCLIB (free, no API key required)
- Falls back to song name and artist if lyrics aren't available
- Updates in real-time as the song plays
- Supports both synced (LRC format) and plain lyrics

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
- **MPRIS DBus interface** - To monitor Spotify playback and get track position
- **LRC format parsing** - For time-synced lyrics that update as the song plays

When a song plays, the extension:
1. Fetches synced lyrics from LRCLIB
2. Parses the LRC timestamps
3. Displays the current line based on playback position
4. Updates every 500ms for smooth transitions

## Requirements

- GNOME Shell 45 or 46
- Spotify running on your system
- DBus support (standard on most Linux systems)
- Internet connection (for fetching lyrics)

## Development

To test changes:
```bash
# View logs
journalctl -f -o cat /usr/bin/gnome-shell

# Reload extension (X11 only)
# Alt+F2, then type 'r' and press Enter
```

## Troubleshooting

- **Extension not showing**: Check if Spotify is running
- **"Spotify not running" message**: Start Spotify and restart the extension
- **No lyrics showing**: Not all songs have synced lyrics in the database. The extension will fall back to showing the song name
- **Lyrics out of sync**: The extension relies on Spotify's position reporting. Try pausing and resuming the song
- **No updates**: Check DBus connection with:
  ```bash
  dbus-send --print-reply --dest=org.mpris.MediaPlayer2.spotify /org/mpris/MediaPlayer2 org.freedesktop.DBus.Properties.Get string:org.mpris.MediaPlayer2.Player string:Metadata
  ```
- **Check logs**: View GNOME Shell logs for errors:
  ```bash
  journalctl -f -o cat /usr/bin/gnome-shell
  ```

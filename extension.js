import GObject from 'gi://GObject';
import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

const MPRIS_PLAYER_PATH = '/org/mpris/MediaPlayer2';
const MPRIS_PLAYER_INTERFACE = 'org.mpris.MediaPlayer2.Player';

// Lyrics API configuration
const LYRICS_API_URL = 'https://lrclib.net/api/get';

// Helper function to check if a bus name is a supported music player
function isSupportedPlayer(busName) {
    // Desktop apps
    if (busName === 'org.mpris.MediaPlayer2.spotify' ||
        busName === 'org.mpris.MediaPlayer2.youtube-music') {
        return true;
    }
    
    // Browser-based players (chromium, chrome, firefox, etc.)
    // These have instance IDs like: org.mpris.MediaPlayer2.chromium.instance12345
    const browserPatterns = [
        /^org\.mpris\.MediaPlayer2\.chromium\.instance\d+$/,
        /^org\.mpris\.MediaPlayer2\.chrome\.instance\d+$/,
        /^org\.mpris\.MediaPlayer2\.firefox\.instance\d+$/,
        /^org\.mpris\.MediaPlayer2\.brave\.instance\d+$/,
        /^org\.mpris\.MediaPlayer2\.edge\.instance\d+$/
    ];
    
    return browserPatterns.some(pattern => pattern.test(busName));
}

const MusicLyricsIndicator = GObject.registerClass(
class MusicLyricsIndicator extends PanelMenu.Button {
    _init() {
        super._init(0.0, 'Music Lyrics Indicator');

        this._label = new St.Label({
            text: 'No music playing',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'spotify-lyrics-label'
        });
        
        // Enable text clipping with ellipsis
        this._label.clutter_text.ellipsize = 3; // PANGO_ELLIPSIZE_END

        this.add_child(this._label);

        this._currentTrack = null;
        this._currentLyrics = null;
        this._currentLine = '';
        this._proxy = null;
        this._propertiesChangedId = null;
        this._lyricsTimeoutId = null;
        this._currentBusName = null;
        this._busWatchId = null;

        this._setupDBusMonitoring();
    }

    _setupDBusMonitoring() {
        // Watch for new media players appearing on the bus
        this._busWatchId = Gio.bus_watch_name(
            Gio.BusType.SESSION,
            'org.mpris.MediaPlayer2.*',
            Gio.BusNameWatcherFlags.NONE,
            () => this._findActivePlayer(),
            () => this._findActivePlayer()
        );

        this._findActivePlayer();
    }

    _findActivePlayer() {
        try {
            const dbusProxy = Gio.DBusProxy.new_for_bus_sync(
                Gio.BusType.SESSION,
                Gio.DBusProxyFlags.NONE,
                null,
                'org.freedesktop.DBus',
                '/org/freedesktop/DBus',
                'org.freedesktop.DBus',
                null
            );

            dbusProxy.call(
                'ListNames',
                null,
                Gio.DBusCallFlags.NONE,
                -1,
                null,
                (proxy, result) => {
                    try {
                        const reply = proxy.call_finish(result);
                        const names = reply.get_child_value(0).deep_unpack();
                        
                        // First try to find a playing supported player
                        let foundPlayer = null;
                        
                        for (const name of names) {
                            if (isSupportedPlayer(name)) {
                                if (this._isPlayerPlaying(name)) {
                                    foundPlayer = name;
                                    break;
                                }
                            }
                        }
                        
                        // If no playing player, connect to any supported player
                        if (!foundPlayer) {
                            for (const name of names) {
                                if (isSupportedPlayer(name)) {
                                    foundPlayer = name;
                                    break;
                                }
                            }
                        }
                        
                        if (foundPlayer) {
                            this._tryConnectToPlayer(foundPlayer);
                        } else {
                            this._label.set_text('No music playing');
                        }
                    } catch (e) {
                        logError(e, 'Failed to list DBus names');
                        this._label.set_text('No music playing');
                    }
                }
            );
        } catch (e) {
            logError(e, 'Failed to query DBus');
            this._label.set_text('No music playing');
        }
    }

    _isPlayerPlaying(busName) {
        try {
            const playerProxy = Gio.DBusProxy.new_for_bus_sync(
                Gio.BusType.SESSION,
                Gio.DBusProxyFlags.NONE,
                null,
                busName,
                MPRIS_PLAYER_PATH,
                MPRIS_PLAYER_INTERFACE,
                null
            );

            const playbackStatus = playerProxy.get_cached_property('PlaybackStatus');
            if (playbackStatus) {
                const status = playbackStatus.unpack();
                return status === 'Playing';
            }
        } catch (e) {
            // Ignore errors, player might not be available
        }
        return false;
    }

    _tryConnectToPlayer(busName) {
        try {
            // Create proxy for properties interface
            const proxy = Gio.DBusProxy.new_for_bus_sync(
                Gio.BusType.SESSION,
                Gio.DBusProxyFlags.NONE,
                null,
                busName,
                MPRIS_PLAYER_PATH,
                'org.freedesktop.DBus.Properties',
                null
            );

            // Create proxy for player interface to monitor changes
            const playerProxy = Gio.DBusProxy.new_for_bus_sync(
                Gio.BusType.SESSION,
                Gio.DBusProxyFlags.NONE,
                null,
                busName,
                MPRIS_PLAYER_PATH,
                MPRIS_PLAYER_INTERFACE,
                null
            );

            // Disconnect previous player if any
            if (this._propertiesChangedId && this._playerProxy) {
                this._playerProxy.disconnect(this._propertiesChangedId);
            }

            this._proxy = proxy;
            this._playerProxy = playerProxy;
            this._currentBusName = busName;

            this._propertiesChangedId = this._playerProxy.connect(
                'g-properties-changed',
                this._onPropertiesChanged.bind(this)
            );

            this._updateTrackInfo();
            return true;
        } catch (e) {
            return false;
        }
    }

    _onPropertiesChanged() {
        this._updateTrackInfo();
    }

    _updateTrackInfo() {
        if (!this._playerProxy) {
            return;
        }

        try {
            const metadata = this._playerProxy.get_cached_property('Metadata');
            if (!metadata) {
                this._label.set_text('No music playing');
                return;
            }

            const metadataDict = metadata.deep_unpack();
            const title = metadataDict['xesam:title']?.unpack() || 'Unknown';
            const artist = metadataDict['xesam:artist']?.deep_unpack()[0] || 'Unknown';
            
            this._currentTrack = {
                title: title,
                artist: artist
            };

            // Try to fetch lyrics
            this._fetchLyrics(title, artist);
        } catch (e) {
            logError(e, 'Failed to get track info');
        }
    }

    _fetchLyrics(title, artist) {
        // Clear any existing lyrics timeout
        if (this._lyricsTimeoutId) {
            GLib.source_remove(this._lyricsTimeoutId);
            this._lyricsTimeoutId = null;
        }

        // Build API URL
        const url = `${LYRICS_API_URL}?artist_name=${encodeURIComponent(artist)}&track_name=${encodeURIComponent(title)}`;
        

        
        const file = Gio.File.new_for_uri(url);
        
        file.load_contents_async(null, (source, result) => {
            try {
                const [success, contents] = source.load_contents_finish(result);
                
                if (!success) {
                    this._label.set_text(this._truncateText(`${artist} - ${title}`, 80));
                    return;
                }
                
                const decoder = new TextDecoder('utf-8');
                const response = decoder.decode(contents);
                const data = JSON.parse(response);
                
                if (data.syncedLyrics) {
                    this._currentLyrics = this._parseLRC(data.syncedLyrics);
                    this._startLyricsDisplay();
                } else if (data.plainLyrics) {
                    // Fallback to plain lyrics (show first line)
                    const firstLine = data.plainLyrics.split('\n')[0];
                    this._label.set_text(this._truncateText(firstLine || `${artist} - ${title}`, 80));
                } else {
                    this._label.set_text(this._truncateText(`${artist} - ${title}`, 80));
                }
            } catch (e) {
                logError(e, 'Failed to fetch lyrics');
                this._label.set_text(this._truncateText(`${artist} - ${title}`, 80));
            }
        });
    }

    _parseLRC(lrcText) {
        // Parse LRC format: [mm:ss.xx]lyrics
        const lines = [];
        const lrcLines = lrcText.split('\n');
        
        for (const line of lrcLines) {
            const match = line.match(/\[(\d+):(\d+)\.(\d+)\](.*)/);
            if (match) {
                const minutes = parseInt(match[1]);
                const seconds = parseInt(match[2]);
                const centiseconds = parseInt(match[3]);
                const text = match[4].trim();
                
                const timeMs = (minutes * 60 + seconds) * 1000 + centiseconds * 10;
                
                if (text) {
                    lines.push({ time: timeMs, text: text });
                }
            }
        }
        
        return lines.sort((a, b) => a.time - b.time);
    }

    _startLyricsDisplay() {
        if (!this._currentLyrics || this._currentLyrics.length === 0) {
            return;
        }
        
        // Get current playback position
        this._updateCurrentLyricLine();
        
        // Update lyrics every 500ms
        this._lyricsTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
            this._updateCurrentLyricLine();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _updateCurrentLyricLine() {
        if (!this._proxy || !this._currentLyrics || this._currentLyrics.length === 0) {
            return;
        }

        try {
            // Query position via DBus
            this._proxy.call(
                'Get',
                new GLib.Variant('(ss)', [MPRIS_PLAYER_INTERFACE, 'Position']),
                Gio.DBusCallFlags.NONE,
                -1,
                null,
                (proxy, result) => {
                    try {
                        const reply = proxy.call_finish(result);
                        // Reply is a tuple containing a variant, extract the int64 value
                        const positionUs = reply.get_child_value(0).get_variant().get_int64();
                        const positionMs = positionUs / 1000; // Convert microseconds to milliseconds
                        
                        // Find the current lyric line
                        let currentLine = this._currentLyrics[0].text;
                        
                        for (let i = this._currentLyrics.length - 1; i >= 0; i--) {
                            if (this._currentLyrics[i].time <= positionMs) {
                                currentLine = this._currentLyrics[i].text;
                                break;
                            }
                        }
                        
                        if (currentLine !== this._currentLine) {
                            this._currentLine = currentLine;
                            this._label.set_text(this._truncateText(currentLine, 80));
                            log(`[Spotify Lyrics] Updated to: ${currentLine} (position: ${positionMs}ms)`);
                        }
                    } catch (e) {
                        logError(e, 'Failed to parse position');
                    }
                }
            );
        } catch (e) {
            logError(e, 'Failed to update lyric line');
        }
    }

    _truncateText(text, maxLength) {
        if (text.length <= maxLength) {
            return text;
        }
        return text.substring(0, maxLength - 3) + '...';
    }

    destroy() {
        if (this._lyricsTimeoutId) {
            GLib.source_remove(this._lyricsTimeoutId);
            this._lyricsTimeoutId = null;
        }
        
        if (this._propertiesChangedId && this._playerProxy) {
            this._playerProxy.disconnect(this._propertiesChangedId);
            this._propertiesChangedId = null;
        }

        if (this._busWatchId) {
            Gio.bus_unwatch_name(this._busWatchId);
            this._busWatchId = null;
        }
        
        this._proxy = null;
        this._playerProxy = null;
        super.destroy();
    }
});

export default class MusicLyricsExtension {
    constructor() {
        this._indicator = null;
    }

    enable() {
        this._indicator = new MusicLyricsIndicator();
        Main.panel.addToStatusArea('music-lyrics-indicator', this._indicator);
    }

    disable() {
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
    }
}

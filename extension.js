import GObject from 'gi://GObject';
import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

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
        super._init(0.5, 'Music Lyrics Indicator');

        // Create a box to hold label and info icon
        const box = new St.BoxLayout({
            style_class: 'panel-status-menu-box'
        });

        this._label = new St.Label({
            text: 'No music playing',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'spotify-lyrics-label'
        });
        
        // Enable text clipping with ellipsis
        this._label.clutter_text.ellipsize = 3; // PANGO_ELLIPSIZE_END

        // Info icon button
        this._infoIcon = new St.Icon({
            icon_name: 'dialog-information-symbolic',
            style_class: 'system-status-icon',
            icon_size: 16,
            y_align: Clutter.ActorAlign.CENTER,
            opacity: 0,
            reactive: true
        });

        box.add_child(this._label);
        box.add_child(this._infoIcon);
        this.add_child(box);
        
        // Show/hide info icon on hover
        this.connect('enter-event', () => {
            this._infoIcon.ease({
                opacity: 255,
                duration: 200,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD
            });
        });
        
        this.connect('leave-event', () => {
            this._infoIcon.ease({
                opacity: 0,
                duration: 200,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD
            });
        });

        this._currentTrack = null;
        this._currentLyrics = null;
        this._currentLine = '';
        this._proxy = null;
        this._propertiesChangedId = null;
        this._lyricsTimeoutId = null;
        this._currentBusName = null;
        this._busWatchId = null;
        
        // Settings
        this._settings = {
            showLyrics: true,
            maxTextLength: 80,
            updateInterval: 500
        };

        this._buildMenu();
        this._setupDBusMonitoring();
    }
    
    _buildMenu() {
        // Player info section
        this._playerInfoItem = new PopupMenu.PopupMenuItem('No player connected', {
            reactive: false
        });
        this._playerInfoItem.label.style = 'font-size: 0.85em; color: #888;';
        this.menu.addMenuItem(this._playerInfoItem);
        
        // Track info section
        this._trackInfoItem = new PopupMenu.PopupMenuItem('No track playing', {
            reactive: false
        });
        this.menu.addMenuItem(this._trackInfoItem);
        
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        
        // Playback controls
        const controlsBox = new St.BoxLayout({
            style_class: 'popup-menu-item',
            x_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
            style: 'spacing: 12px;'
        });
        
        const prevButton = new St.Button({
            style_class: 'button',
            child: new St.Icon({
                icon_name: 'media-skip-backward-symbolic',
                icon_size: 20
            })
        });
        prevButton.connect('clicked', () => this._controlPlayback('Previous'));
        
        const playPauseButton = new St.Button({
            style_class: 'button',
            child: new St.Icon({
                icon_name: 'media-playback-start-symbolic',
                icon_size: 20
            })
        });
        this._playPauseButton = playPauseButton;
        playPauseButton.connect('clicked', () => this._controlPlayback('PlayPause'));
        
        const nextButton = new St.Button({
            style_class: 'button',
            child: new St.Icon({
                icon_name: 'media-skip-forward-symbolic',
                icon_size: 20
            })
        });
        nextButton.connect('clicked', () => this._controlPlayback('Next'));
        
        controlsBox.add_child(prevButton);
        controlsBox.add_child(playPauseButton);
        controlsBox.add_child(nextButton);
        
        const controlsItem = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false
        });
        controlsItem.add_child(controlsBox);
        this.menu.addMenuItem(controlsItem);
        
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        
        // Toggle lyrics display
        this._lyricsToggle = new PopupMenu.PopupSwitchMenuItem(
            'Show Lyrics',
            this._settings.showLyrics
        );
        this._lyricsToggle.connect('toggled', (item) => {
            this._settings.showLyrics = item.state;
            if (!item.state) {
                if (this._lyricsTimeoutId) {
                    GLib.source_remove(this._lyricsTimeoutId);
                    this._lyricsTimeoutId = null;
                }
                this._updateTrackInfo();
            } else {
                this._updateTrackInfo();
            }
        });
        this.menu.addMenuItem(this._lyricsToggle);
        
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        
        // Refresh button
        const refreshItem = new PopupMenu.PopupMenuItem('Refresh Player');
        refreshItem.connect('activate', () => {
            this._findActivePlayer();
        });
        this.menu.addMenuItem(refreshItem);
        
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        
        // Info submenu
        this._infoSubmenu = new PopupMenu.PopupSubMenuMenuItem('About');
        
        // GitHub link
        const githubItem = new PopupMenu.PopupMenuItem('View on GitHub');
        githubItem.connect('activate', () => {
            Gio.AppInfo.launch_default_for_uri(
                'https://github.com/d3osaju/Spotline',
                null
            );
        });
        this._infoSubmenu.menu.addMenuItem(githubItem);
        
        // Credits
        const creditsItem = new PopupMenu.PopupMenuItem('Created by deosaju', {
            reactive: false
        });
        creditsItem.label.style = 'font-size: 0.9em; color: #888;';
        this._infoSubmenu.menu.addMenuItem(creditsItem);
        
        this.menu.addMenuItem(this._infoSubmenu);
    }
    
    _controlPlayback(action) {
        if (!this._playerProxy) {
            return;
        }
        
        try {
            this._playerProxy.call(
                action,
                null,
                Gio.DBusCallFlags.NONE,
                -1,
                null,
                null
            );
        } catch (e) {
            logError(e, `Failed to ${action}`);
        }
    }
    
    _updatePlayPauseButton() {
        if (!this._playerProxy || !this._playPauseButton) {
            return;
        }
        
        try {
            const playbackStatus = this._playerProxy.get_cached_property('PlaybackStatus');
            if (playbackStatus) {
                const status = playbackStatus.unpack();
                const icon = status === 'Playing' ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic';
                this._playPauseButton.child.icon_name = icon;
            }
        } catch (e) {
            logError(e, 'Failed to update play/pause button');
        }
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

            this._updatePlayerInfo();
            this._updateTrackInfo();
            return true;
        } catch (e) {
            return false;
        }
    }
    
    _updatePlayerInfo() {
        if (!this._currentBusName) {
            this._playerInfoItem.label.text = 'No player connected';
            return;
        }
        
        let playerName = 'Unknown Player';
        let playerIcon = '♪';
        
        if (this._currentBusName.includes('spotify')) {
            playerName = 'Spotify';
            playerIcon = '🎵';
        } else if (this._currentBusName.includes('youtube-music')) {
            playerName = 'YouTube Music';
            playerIcon = '🎵';
        } else if (this._currentBusName.includes('chromium')) {
            playerName = 'Chromium';
            playerIcon = '🌐';
        } else if (this._currentBusName.includes('chrome')) {
            playerName = 'Chrome';
            playerIcon = '🌐';
        } else if (this._currentBusName.includes('firefox')) {
            playerName = 'Firefox';
            playerIcon = '🌐';
        } else if (this._currentBusName.includes('brave')) {
            playerName = 'Brave';
            playerIcon = '🌐';
        } else if (this._currentBusName.includes('edge')) {
            playerName = 'Edge';
            playerIcon = '🌐';
        }
        
        this._playerInfoItem.label.text = `${playerIcon} Playing from ${playerName}`;
    }

    _onPropertiesChanged() {
        this._updateTrackInfo();
        this._updatePlayPauseButton();
    }

    _updateTrackInfo() {
        if (!this._playerProxy) {
            return;
        }

        try {
            const metadata = this._playerProxy.get_cached_property('Metadata');
            if (!metadata) {
                this._label.set_text('No music playing');
                this._trackInfoItem.label.text = 'No track playing';
                return;
            }

            const metadataDict = metadata.deep_unpack();
            const title = metadataDict['xesam:title']?.unpack() || null;
            const artist = metadataDict['xesam:artist']?.deep_unpack()[0] || null;
            const album = metadataDict['xesam:album']?.unpack() || null;
            
            // If both title and artist are missing, show icon or nothing
            if (!title && !artist) {
                this._label.set_text('♪');
                this._trackInfoItem.label.text = 'Unknown track';
                return;
            }
            
            this._currentTrack = {
                title: title || 'Unknown Track',
                artist: artist || 'Unknown Artist',
                album: album || 'Unknown Album'
            };
            
            // Update menu with track info
            this._trackInfoItem.label.text = `${this._currentTrack.artist} - ${this._currentTrack.title}`;

            // Try to fetch lyrics if enabled
            if (this._settings.showLyrics) {
                this._fetchLyrics(this._currentTrack.title, this._currentTrack.artist);
            } else {
                this._label.set_text(this._truncateText(`${this._currentTrack.artist} - ${this._currentTrack.title}`, this._settings.maxTextLength));
            }
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
        
        // Update lyrics based on configured interval
        this._lyricsTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, this._settings.updateInterval, () => {
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

import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class SpotLinePreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage();
        const group = new Adw.PreferencesGroup();

        // Position setting
        const positionRow = new Adw.ComboRow({
            title: 'Panel Position',
            model: new Gtk.StringList({
                strings: ['Left', 'Center', 'Right']
            })
        });

        // Map config values to combo index
        const positions = ['left', 'center', 'right'];
        positionRow.selected = positions.indexOf(settings.get_string('position-in-panel'));

        positionRow.connect('notify::selected', () => {
            settings.set_string('position-in-panel', positions[positionRow.selected]);
        });

        group.add(positionRow);

        // Max Width setting
        const widthRow = new Adw.SpinRow({
            title: 'Max Text Length',
            subtitle: 'Maximum number of characters to display',
            adjustment: new Gtk.Adjustment({
                lower: 10,
                upper: 200,
                step_increment: 5,
                value: settings.get_int('max-text-length')
            })
        });

        widthRow.connect('notify::value', () => {
            settings.set_int('max-text-length', widthRow.get_value());
        });

        group.add(widthRow);

        page.add(group);
        window.add(page);
    }
}

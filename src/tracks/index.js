// Track registry. Add a track: write src/tracks/<id>.js (data only, see DESIGN.md
// "Track data format"), import it here, append it to TRACKS. The gate races every entry.
import beach from './beach.js';
import ice from './ice.js';
import castle from './castle.js';

export const TRACKS = [beach, ice, castle];
export const trackById = id => TRACKS.find(t => t.id === id) || TRACKS[0];

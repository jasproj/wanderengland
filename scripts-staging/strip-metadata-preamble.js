#!/usr/bin/env node
/**
 * strip-metadata-preamble.js
 *
 * Cleans FareHarbor descriptions with metadata-before-narrative structure.
 * Locates the "Activity details" line as a content divider and strips
 * everything up to and including it, keeping only the narrative that follows.
 *
 * Safe by design:
 * - No "Activity details" found → description left untouched
 * - Post-divider content < MIN_LEN → original restored
 *
 * Usage: node strip-metadata-preamble.js
 * Reads/writes: tours-data.json
 * Backup: tours-data.json.pre-preamble-strip
 */

const fs = require('fs');
const FILE = 'tours-data.json';
const BACKUP = FILE + '.pre-preamble-strip';
const MIN_LEN = 60;

function stripMetadataPreamble(desc) {
 if (!desc) return { result: desc, action: 'empty' };
 const match = desc.match(/\b(?:Activity details|Activiteitsdetails|Detalles de la actividad|Detalhes da atividade|Détails de l'activité|Aktivitätsdetails)\s*\n/);
 if (!match) return { result: desc, action: 'no-divider' };
 const after = desc.slice(match.index + match[0].length).trim();
 if (after.length < MIN_LEN) return { result: desc, action: 'restored-too-short' };
 return { result: after, action: 'cleaned' };
}

const tours = JSON.parse(fs.readFileSync(FILE, 'utf8'));
fs.writeFileSync(BACKUP, JSON.stringify(tours, null, 2));

const stats = { cleaned: 0, 'no-divider': 0, 'restored-too-short': 0, empty: 0 };
const samples = { cleaned: [], 'restored-too-short': [] };

for (const tour of tours) {
 const { result, action } = stripMetadataPreamble(tour.description);
 stats[action]++;
 if (samples[action] && samples[action].length < 3) {
 samples[action].push({
 name: tour.name,
 before_len: (tour.description || '').length,
 after_len: (result || '').length,
 before_head: (tour.description || '').slice(0, 100),
 after_head: (result || '').slice(0, 100)
 });
 }
 tour.description = result;
}

fs.writeFileSync(FILE, JSON.stringify(tours, null, 2));

console.log('=== STATS ===');
console.log(JSON.stringify(stats, null, 2));
console.log('\n=== CLEANED SAMPLES (3) ===');
console.log(JSON.stringify(samples.cleaned, null, 2));
console.log('\n=== RESTORED-TOO-SHORT SAMPLES (3) ===');
console.log(JSON.stringify(samples['restored-too-short'], null, 2));

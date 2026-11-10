"""Rebuild the selected Suno catalog from checksum-verified local MP3 originals.

Usage: python3 scripts/import-suno.py /path/to/mp3-directory
Requires ffmpeg/ffprobe. Analysis timings are frozen in music/suno-v1.json;
no audio-analysis library is needed to reproduce charts or run the game.
"""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
DATA = json.loads((ROOT / 'scripts/music/suno-v1.json').read_text())
TRACKS = ROOT / 'dist/assets/tracks'


def write_json(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')


def make_chart(song, level):
    beats = song['beats']
    onsets = song['onsets']
    strengths = sorted(o['strength'] for o in onsets)
    threshold = strengths[len(strengths) // (3 if level == 4 else 2)]
    events = []
    for i, time in enumerate(beats[:-2]):
        if time < 2.8:
            continue
        # Easy follows half-time; higher levels add detected offbeat attacks.
        if level > 1 or i % 2 == 0:
            events.append((time, i, True))
        if level >= 3:
            target = (time + beats[i + 1]) / 2
            onset = min(onsets, key=lambda o: abs(o['time'] - target))
            if abs(onset['time'] - target) < .065 and onset['strength'] >= threshold:
                events.append((onset['time'], i, False))
    events.sort()
    notes = []
    busy = [-1, -1, -1]
    pattern = [0, 1, 2, 1, 0, 2, 1, 2]
    for index, (time, beat, main) in enumerate(events):
        wanted = pattern[(index + beat // 16) % len(pattern)]
        free = [lane for lane in range(3) if time - busy[lane] >= .12]
        if not free:
            continue
        lane = wanted if wanted in free else min(free, key=lambda value: busy[value])
        duration = 0
        if main and beat % 32 == 16:
            duration = round(beats[beat + 2] - time, 6)
        notes.append({'time': round(time, 6), 'lane': lane, 'duration': duration, 'shake': False})
        busy[lane] = time + duration
        # Sparse two-finger accents, never three-finger chords on a phone.
        if level == 4 and main and beat % 8 == 0:
            other = next((value for value in [2 - lane, (lane + 1) % 3]
                          if value != lane and time - busy[value] >= .12), None)
            if other is not None:
                notes.append({'time': round(time, 6), 'lane': other, 'duration': 0, 'shake': False})
                busy[other] = time
    return sorted(notes, key=lambda note: (note['time'], note['lane']))


def pulse_boundaries(song):
    beats = song['beats']
    step = 32 if song['genre'] == 'Drum & Bass' else 16
    ends = [beats[i] for i in range(step, len(beats) - 2, step)]
    last = round(beats[-2] + .3, 6)
    if ends and last - ends[-1] < 6:
        ends.pop()
    return ends + [last]


def main():
    if len(sys.argv) != 2:
        raise SystemExit('Usage: python3 scripts/import-suno.py /path/to/mp3-directory')
    source_dir = Path(sys.argv[1]).expanduser().resolve()
    # Validate every original before changing published assets.
    for song in DATA['tracks']:
        source = source_dir / (song['title'] + '.mp3')
        if hashlib.sha256(source.read_bytes()).hexdigest() != song['sourceSha256']:
            raise SystemExit(f'Unexpected source bytes: {source.name}')
    current = json.loads((ROOT / 'dist/assets/catalog.json').read_text())
    calibration = [song for song in current if song['tutorial']]
    assert len(calibration) == 1, 'Preserve the existing calibration tool'
    catalog, provenance, phrases = [], [], {}
    for song in DATA['tracks']:
        source = source_dir / (song['title'] + '.mp3')
        dest = TRACKS / song['id']
        dest.mkdir(exist_ok=True)
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(source), '-map', '0:a:0',
                        '-map_metadata', '-1', '-c:a', 'aac', '-b:a', '192k', '-ar', '44100',
                        '-ac', '2', '-movflags', '+faststart', str(dest / 'audio.m4a')], check=True)
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(source), '-map', '0:v:0',
                        '-c:v', 'copy', str(dest / 'artwork.jpg')], check=True)
        duration = float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries',
                         'format=duration', '-of', 'default=nw=1:nk=1', str(dest / 'audio.m4a')]))
        levels = {}
        for level in range(1, 5):
            chart = make_chart(song, level)
            assert all(n['time'] + n['duration'] < duration for n in chart)
            write_json(dest / f'{level}.json', chart)
            levels[str(level)] = {'notes': len(chart), 'holds': sum(n['duration'] > 0 for n in chart), 'shakes': 0}
        catalog.append({'id': song['id'], 'title': song['title'], 'artist': song['artist'] + ' · Suno',
                        'duration': duration, 'tutorial': False, 'genre': song['genre'], 'levels': levels})
        provenance.append({key: song[key] for key in ['id', 'title', 'artist', 'sourceSha256', 'sourceComment']})
        phrases[song['id']] = pulse_boundaries(song)
        print(song['title'], duration, levels)
    # Only cataloged song bundles are removed. User originals and saves are untouched.
    keep = {song['id'] for song in catalog + calibration}
    for song in current:
        if song['id'] not in keep:
            shutil.rmtree(TRACKS / song['id'])
    write_json(ROOT / 'dist/assets/catalog.json', catalog + calibration)
    write_json(ROOT / 'dist/assets/music-provenance.json', {'source': 'User-provided Suno exports', 'tracks': provenance})
    (ROOT / 'dist/phrase-charts.js').write_text(
        '// Boundaries from the frozen, audio-derived beat grids in scripts/music/suno-v1.json.\n'
        "export const PHRASE_VERSION = 'random-zones-v1';\n"
        'export const PULSE_CHARTS = ' + json.dumps(phrases, indent=2) + ';\n\n'
        'export const PULSE_COUNTS = ' + json.dumps({song['id']: 3 for song in catalog}, indent=2) + ';\n')


if __name__ == '__main__':
    main()

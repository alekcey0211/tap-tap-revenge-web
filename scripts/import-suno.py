"""Rebuild the selected Suno catalog from checksum-verified local MP3 originals.

Usage: python3 scripts/import-suno.py /path/to/mp3-directory
       python3 scripts/import-suno.py --charts-only
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
    beats, onsets = song['beats'], song['onsets']
    strengths = sorted(o['strength'] for o in onsets)
    threshold = strengths[len(strengths) // (3 if level == 4 else 2)]
    # Different phrase shapes: DnB alternation, dubstep call/response, house offbeats.
    patterns = {
        'Drum & Bass': [[0, 2, 1, 2, 0, 1, 2, 0], [2, 0, 2, 1, 0, 2, 0, 1], [0, 1, 2, 0, 2, 1, 0, 2]],
        'Dubstep': [[0, 0, 1, 2, 2, 1, 0, 2], [2, 2, 0, 1, 0, 0, 2, 1], [0, 1, 0, 2, 1, 2, 2, 0]],
        'Electro House': [[0, 1, 2, 1, 2, 0, 1, 0], [2, 1, 0, 1, 0, 2, 1, 2], [0, 2, 1, 0, 1, 2, 0, 1]],
    }[song['genre']]
    events = {}
    for i, time in enumerate(beats[:-2]):
        if time < 2.8:
            continue
        if level > 1 or i % 2 == 0:
            events[round(time, 6)] = (i, True)
        if level >= 3:
            target = (time + beats[i + 1]) / 2
            onset = min(onsets, key=lambda o: abs(o['time'] - target))
            if abs(onset['time'] - target) < .065 and onset['strength'] >= threshold:
                events[round(onset['time'], 6)] = (i, False)
    # Each four-bar phrase gets one hold at its strongest eligible beat. Different
    # recordings therefore place holds differently, not at a shared beat number.
    hold_beats = set()
    for start in range(0, len(beats) - 2, 32):
        candidates = [i for i in range(start + 8, min(start + 25, len(beats) - 2))
                      if round(beats[i], 6) in events]
        if candidates:
            hold_beats.add(max(candidates, key=lambda i: max(
                (o['strength'] for o in onsets if abs(o['time'] - beats[i]) < .09), default=0)))
    notes, busy, active_until = [], [-1, -1, -1], [-1, -1, -1]
    for index, (time, (beat, main)) in enumerate(sorted(events.items())):
        held = sum(end > time for end in active_until)
        if held >= 2:
            continue
        pattern = patterns[(beat // 16) % len(patterns)]
        wanted = pattern[(beat if main else index + 3) % len(pattern)]
        free = [lane for lane in range(3) if time - busy[lane] >= .12]
        if not free:
            continue
        duration = 0
        if main and beat in hold_beats:
            sides = [lane for lane in free if lane != 1]
            if sides:
                free = sides
                wanted = 0 if (beat // 32) % 2 == 0 else 2
                length = 1 if song['genre'] == 'Electro House' else 2
                duration = round(beats[beat + length] - time, 6)
        lane = wanted if wanted in free else min(free, key=lambda value: busy[value])
        notes.append({'time': time, 'lane': lane, 'duration': duration, 'shake': False})
        busy[lane] = active_until[lane] = time + duration
        # Original sparse hard accents; held fingers still count toward the limit.
        if level == 4 and main and beat % 8 == 0 and held == 0:
            other = next((value for value in [2 - lane, (lane + 1) % 3]
                          if value != lane and time - busy[value] >= .12), None)
            if other is not None:
                notes.append({'time': time, 'lane': other, 'duration': 0, 'shake': False})
                busy[other] = active_until[other] = time
    return sorted(notes, key=lambda note: (note['time'], note['lane']))


def charts_only():
    """Rebuild maps from frozen analysis without touching audio, artwork or calibration."""
    catalog_path = ROOT / 'dist/assets/catalog.json'
    catalog = json.loads(catalog_path.read_text())
    for source in DATA['tracks']:
        song = next(song for song in catalog if song['id'] == source['id'])
        for level in range(1, 5):
            chart = make_chart(source, level)
            assert all(n['time'] + n['duration'] < song['duration'] for n in chart)
            write_json(TRACKS / song['id'] / f'{level}.json', chart)
            song['levels'][str(level)] = {'notes': len(chart), 'holds': sum(n['duration'] > 0 for n in chart), 'shakes': 0}
        print(song['title'], song['levels'])
    write_json(catalog_path, catalog)


def pulse_boundaries(song):
    beats = song['beats']
    step = 32 if song['genre'] == 'Drum & Bass' else 16
    ends = [beats[i] for i in range(step, len(beats) - 2, step)]
    last = round(beats[-2] + .3, 6)
    if ends and last - ends[-1] < 6:
        ends.pop()
    return ends + [last]


def main():
    if sys.argv[1:] == ['--charts-only']:
        charts_only()
        return
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

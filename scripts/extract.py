"""Extract data only. Never execute APK code, Lua, or bundled HTML/JavaScript."""
import base64
import hashlib
import json
import plistlib
import re
from collections import deque
from pathlib import Path
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
APK = ROOT / 'source/tap-tap-revenge-4-4.5.apk'
EXPECTED_HASH = 'edf09a1c36f19c4b6d7cece122baa82f58d3532d7de4d66167202370ff9f4366'
ASSETS = ROOT / 'dist/assets'
LANES = {60: 0, 61: 0, 62: 1, 65: 1, 64: 2, 63: 2}


def decode_archive(data):
    archive = plistlib.loads(data)
    objects = archive['$objects']

    def decode(value):
        if isinstance(value, plistlib.UID):
            return decode(objects[value.data])
        if isinstance(value, list):
            return [decode(item) for item in value]
        if isinstance(value, dict):
            if 'NS.keys' in value:
                return dict(zip(decode(value['NS.keys']), decode(value['NS.objects'])))
            if 'NS.objects' in value:
                return decode(value['NS.objects'])
            return {k: decode(v) for k, v in value.items() if k not in ('$class', 'rawData')}
        return value

    return decode(archive['$top']['root'])


def convert_chart(level):
    notes = []
    for track in level['tracks']:
        active = {}
        for event in track['events']:
            kind, pitch = event['type'], event['note']
            if kind not in (0, 1):
                continue
            key = (event['channel'], pitch)
            if kind == 0 and event['velocity'] > 0:
                if pitch not in LANES:
                    raise ValueError(f'Unmapped pitch: {pitch}')
                active.setdefault(key, deque()).append(event)
            elif active.get(key):
                start = active[key].popleft()
                beats = event['timeInQuarterNotes'] - start['timeInQuarterNotes']
                # Native m_tapAndHoldThresholdDurationInBeats = 0.7.
                duration = event['time'] - start['time'] if beats > 0.7 else 0
                notes.append({'time': start['time'], 'lane': LANES[pitch],
                              'duration': duration, 'shake': pitch in (61, 63, 65)})
        if any(active.values()):
            raise ValueError('Unpaired note-on')
    # Sing contains duplicate simultaneous same-lane MIDI events. Keep one playable head.
    unique = {}
    for note in notes:
        key = (note['time'], note['lane'])
        if key not in unique or note['duration'] > unique[key]['duration']:
            unique[key] = note
    return sorted(unique.values(), key=lambda note: (note['time'], note['lane']))


def main():
    digest = hashlib.sha256(APK.read_bytes()).hexdigest()
    if digest != EXPECTED_HASH:
        raise ValueError(f'Unexpected APK SHA-256: {digest}')
    ASSETS.mkdir(parents=True, exist_ok=True)
    with ZipFile(APK) as archive:
        def copy(member, destination):
            path = ASSETS / destination
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(archive.read(member))

        prefix = 'assets/Resources/'
        theme = prefix + 'Themes/TTRDJ.ttrTheme/'
        for name in ['background.png', 'background-revenge.png', 'space.jpg', 'space-revenge.jpg',
                     'parts.png', 'HUD.png', 'HUD-meters.png', 'multipliers.png', 'progressBall.png',
                     'stars.jpg', 'textFeedback.png']:
            copy(theme + name, 'theme/' + name)
        cfg = archive.read(theme + 'theme.cfg').decode()
        paths = []
        for name in ['left', 'middle', 'right']:
            block = re.search(r'local ' + name + r'CurveXPoints = \{(.*?)\n\};', cfg, re.S)[1]
            points = [[int(x), int(y)] for x, y in re.findall(r'\{(\d+),\s*(\d+)\}', block)]
            paths.append([points[0]] + points)
        (ASSETS / 'paths.json').write_text(json.dumps(paths) + '\n')
        for src, dest in [('action_bar_logo_up.PNG', 'logo.png'),
                          ('action_bar_background.PNG', 'bar.png'),
                          ('background_plate_2x.PNG', 'plate.png'),
                          ('level_icons_available.PNG', 'difficulty.png')]:
            copy('res/drawable-hdpi/' + src, 'ui/' + dest)
        home = archive.read('assets/BakedHTML/pages/home').decode()
        for name, dest in [('graphics_top', 'home-top.png'), ('graphics_bottom', 'home-bottom.jpeg')]:
            match = re.search(r'\.' + name + r'\s*\{[^}]*?url\(data:image/(?:png|jpeg);base64,([^\)]+)\)', home)
            (ASSETS / 'ui' / dest).write_bytes(base64.b64decode(match[1]))
        songs = []
        for member in sorted(archive.namelist()):
            if not re.match(prefix + r'(Tracks|Tutorial)/[^/]+/info.plist$', member):
                continue
            folder = member.rsplit('/', 1)[0]
            info = plistlib.loads(archive.read(member))
            ident = info['kTTRDownloadableItemUniqueIdentifierKey']
            levels = decode_archive(archive.read(folder + '/taptrack.ttr2_track'))
            charts = {str(k): convert_chart(v) for k, v in sorted(levels.items())}
            song = {'id': ident, 'title': info['kTTRDownloadableItemTitleKey'],
                    'artist': info['kTTRDownloadableItemSubtitleKey'],
                    'duration': info['audioFileDuration'], 'tutorial': '/Tutorial/' in member,
                    'genre': info.get('kTTRGenre', 'Calibration'), 'levels': {}}
            copy(folder + '/audio.m4a', f'tracks/{ident}/audio.m4a')
            if folder + '/artwork.png' in archive.namelist():
                copy(folder + '/artwork.png', f'tracks/{ident}/artwork.png')
            for level, notes in charts.items():
                (ASSETS / f'tracks/{ident}/{level}.json').write_text(json.dumps(notes, separators=(',', ':')) + '\n')
                song['levels'][level] = {'notes': len(notes), 'holds': sum(n['duration'] > 0 for n in notes),
                                        'shakes': sum(n['shake'] for n in notes)}
            songs.append(song)
        (ASSETS / 'catalog.json').write_text(json.dumps(songs, indent=2) + '\n')
        print(json.dumps(songs, indent=2))
    (ASSETS / 'provenance.json').write_text(json.dumps({
        'apk_sha256': digest, 'package': 'com.tapulous.taptaprevenge4', 'version': '4.5',
        'source': 'https://apkpure.net/tap-tap-revenge-4/com.tapulous.taptaprevenge4/download',
        'reference_hash': 'https://tap-tap-revenge-4.en.uptodown.com/android/download',
        'notes': 'Data extracted without running the APK. Hash match is not publisher authentication.'
    }, indent=2) + '\n')


if __name__ == '__main__':
    main()

"""Render the code-native three-lane icon without external image libraries."""
from pathlib import Path
import struct
import zlib

root = Path(__file__).resolve().parent.parent / 'dist/assets/identity'

def chunk(name, data):
    return struct.pack('>I', len(data)) + name + data + struct.pack('>I', zlib.crc32(name + data))

for size in (180, 192, 512):
    rows = []
    for y in range(size):
        row = bytearray([0])
        for x in range(size):
            px, py = (x + .5) * 512 / size, (y + .5) * 512 / size
            color = (16, 17, 19)
            if 128 <= py <= 384 and any(abs(px - lane) <= 6 for lane in (192, 256, 320)):
                color = (65, 71, 53)
            if ((px - 192) ** 2 + (py - 300) ** 2 <= 24 ** 2
                    or abs(px - 256) + abs(py - 200) <= 28
                    or (px - 320) ** 2 + (py - 260) ** 2 <= 24 ** 2
                    or (144 <= px <= 368 and abs(py - 368) <= 5)):
                color = (201, 255, 86)
            row.extend(color)
        rows.append(bytes(row))
    data = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0))
    data += chunk(b'IDAT', zlib.compress(b''.join(rows))) + chunk(b'IEND', b'')
    (root / f'icon-{size}.png').write_bytes(data)

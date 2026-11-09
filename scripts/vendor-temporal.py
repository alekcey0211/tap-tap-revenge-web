"""Fetch pinned ESM dependencies, verify tarballs, preserve licenses; never run package scripts."""
import base64
import hashlib
import io
from pathlib import Path
import re
import tarfile
import urllib.request

ROOT = Path(__file__).resolve().parent.parent / 'dist' / 'vendor'
PACKAGES = [
    ('temporal-0.5.1.js', 'https://registry.npmjs.org/@js-temporal/polyfill/-/polyfill-0.5.1.tgz',
     'hloP58zRVCRSpgDxmqCWJNlizAlUgJFqG2ypq79DCvyv9tHjRYMDOcPFjzfl/A1/YxDvRCZz8wvZvmapQnKwFQ==', 'package/dist/index.esm.js', 'package/LICENSE'),
    ('jsbi-4.3.0.js', 'https://registry.npmjs.org/jsbi/-/jsbi-4.3.0.tgz',
     'SnZNcinB4RIcnEyZqFPdGPVgrg2AcnykiBy0sHVJQKHYeaLUvi3Exj+iaPpLnFVkDPZIV4U0yvgC9/R4uEAZ9g==', 'package/dist/jsbi.mjs', 'package/LICENSE'),
]
for name, url, integrity, source, license_path in PACKAGES:
    with urllib.request.urlopen(url, timeout=45) as response:
        data = response.read()
    assert base64.b64encode(hashlib.sha512(data).digest()).decode() == integrity, 'Integrity mismatch'
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as archive:
        code = archive.extractfile(source).read().decode()
        license_text = archive.extractfile(license_path).read().decode()
    if name.startswith('temporal'):
        assert code.count('from"jsbi"') == 1
        code = code.replace('from"jsbi"', 'from"./jsbi-4.3.0.js"')
    code = re.sub(r'//# sourceMappingURL=.*', '', code).rstrip()
    ROOT.mkdir(exist_ok=True)
    (ROOT / name).write_text('/* Vendored by scripts/vendor-temporal.py; import path adjusted; source map omitted.\n'
                             + url + '\n\n' + license_text.rstrip() + '\n*/\n' + code + '\n')
    print(name)

"""Isolated Docker-volume staging smoke/recovery checks; never uses the user's volume."""
import json
import pathlib
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid
import zipfile
import io

root = pathlib.Path(__file__).resolve().parents[2]
artifacts = root / '.local' / 'gate7-deployment'
artifacts.mkdir(parents=True, exist_ok=True)
source = root / '.local' / 'browser-fixture-v2' / 'media'
empty = artifacts / 'empty-source'
empty.mkdir(exist_ok=True)
token = uuid.uuid4().hex[:10]
volume = 'luma-gate7-test-' + token
restored = volume + '-restored'
name = 'luma-gate7-test-' + token
port = 5287
base = f'http://127.0.0.1:{port}'
commands = []
checks = []
containers = set()
volumes = []


def docker(*args):
    commands.append(['docker', *args])
    result = subprocess.run(['docker', *args], text=True, capture_output=True, check=True)
    return result.stdout.strip()


def request(path, method='GET', body=None, raw=False):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(base + path, data=data, method=method,
                                 headers={} if body is None else {'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=10) as response:
        content = response.read()
        return (content, dict(response.headers)) if raw else json.loads(content) if content else None


def wait_ready(version):
    for _ in range(120):
        try:
            if request('/api/status')['schemaVersion'] == version:
                return
        except (OSError, urllib.error.HTTPError):
            pass
        time.sleep(1)
    raise TimeoutError('Container did not become ready')


def start(image, data_volume, offline=False):
    mount = f'{empty}:/media:ro' if offline else f'{source}:/media/collection:ro'
    docker('run', '-d', '--name', name, '-p', f'127.0.0.1:{port}:5080',
           '-v', f'{data_volume}:/data', '-v', mount,
           '-e', 'Luma__Indexing__Libraries__0__Id=1',
           '-e', 'Luma__Indexing__Libraries__0__Name=Verification',
           '-e', 'Luma__Indexing__Libraries__0__Path=/media/collection',
           '-e', 'Luma__Indexing__Libraries__0__CaseSensitive=true',
           '-e', 'Luma__Indexing__Libraries__0__ScanOnStartup=false', image)
    containers.add(name)


def stop():
    docker('stop', name)
    docker('rm', name)
    containers.discard(name)


def scan(force=False):
    accepted = request('/api/libraries/1/scans', 'POST', {'force': force})
    for _ in range(240):
        status = request(f'/api/scans/{accepted["id"]}')
        if status['state'] == 'failed':
            raise AssertionError('Fixture scan failed: ' + str(status['failureCode']))
        if status['state'] == 'completed' and status['pending'] + status['processing'] == 0:
            return status
        time.sleep(1)
    raise TimeoutError('Fixture processing did not finish')


def backup(data_volume, filename):
    docker('run', '--rm', '-v', f'{data_volume}:/data:ro', '-v', f'{artifacts}:/backup',
           'alpine', 'tar', '-C', '/data', '-czf', '/backup/' + filename, '.')


def job(endpoint, body):
    accepted = request(endpoint, 'POST', body)
    for _ in range(120):
        status = request(f'/api/jobs/{accepted["id"]}')
        if status['state'] not in ('queued', 'running'):
            assert status['state'] == 'completed', status
            return status
        time.sleep(0.25)
    raise TimeoutError('Metadata job did not finish')


def verify_saved(media_id, tag_id, cover=False):
    item = request(f'/api/media/{media_id}')
    assert item['preference'] == 'liked'
    assert tag_id in [tag['id'] for tag in item['tags']]
    if cover:
        assert f'/media/{media_id}/' in request('/api/libraries')[0]['coverUrl']
    content, _ = request(item['preview']['url'], raw=True)
    assert len(content) > 100


result = {'targetHardware': False, 'platform': 'Docker Desktop Linux AMD64', 'checks': checks}
try:
    docker('volume', 'create', volume)
    volumes.append(volume)
    old_image = sys.argv[1] if len(sys.argv) > 1 else 'luma-luma:latest'
    start(old_image, volume)
    wait_ready(7)
    status = scan()
    item = request('/api/media?mediaType=image&limit=1')['items'][0]
    media_id = item['id']
    tag = request('/api/tags', 'POST', {'name': 'Staging persistence'})
    request('/api/media/tags', 'POST', {'mediaIds': [media_id], 'addTagIds': [tag['id']], 'removeTagIds': []})
    request(f'/api/media/{media_id}/preference', 'PUT', {'preference': 'liked'})
    stop()
    backup(volume, 'pre-upgrade.tgz')
    checks.append({'name': 'schema-7 baseline and cold backup', 'passed': True, 'scan': status})

    start('luma:gate7-staging', volume)
    wait_ready(11)
    verify_saved(media_id, tag['id'])
    library = request('/api/libraries')[0]
    request(f'/api/folders/{library["rootFolderId"]}/cover', 'PUT', {'mediaId': media_id})
    verify_saved(media_id, tag['id'], True)
    content, headers = request('/api/random?mediaType=image&libraryId=1', raw=True)
    assert headers.get('Cache-Control') == 'no-store' and len(content) > 100
    exported = job('/api/exports/xmp', {'mediaIds': [media_id]})
    content, _ = request(exported['contentUrl'], raw=True)
    with zipfile.ZipFile(io.BytesIO(content)) as archive:
        assert f'{media_id}.xmp' in archive.namelist()
        assert b'Staging persistence' in archive.read(f'{media_id}.xmp')
        assert 'paths.jsonl' in archive.namelist()
    stop()
    backup(volume, 'staging-backup.tgz')
    checks.append({'name': 'schema 7 to 11 upgrade, covers, random and XMP', 'passed': True})

    start('luma:gate7-staging', volume)
    wait_ready(11)
    verify_saved(media_id, tag['id'], True)
    stop()
    checks.append({'name': 'restart persistence', 'passed': True})

    docker('run', '--rm', '-v', f'{volume}:/data', 'alpine', 'sh', '-c',
           'test "$(readlink -f /data/cache)" = /data/cache && rm -rf /data/cache')
    start('luma:gate7-staging', volume)
    wait_ready(11)
    scan(True)
    verify_saved(media_id, tag['id'], True)
    stop()
    checks.append({'name': 'cache loss and force-scan regeneration', 'passed': True})

    start('luma:gate7-staging', volume, True)
    wait_ready(11)
    verify_saved(media_id, tag['id'], True)
    assert request('/api/media?libraryId=1')['items']
    try:
        request(f'/api/media/{media_id}/original', raw=True)
        raise AssertionError('Unavailable original unexpectedly streamed')
    except urllib.error.HTTPError as error:
        assert error.code == 503
        assert json.loads(error.read())['code'] == 'source_unavailable'
    request(f'/api/media/{media_id}/preference', 'PUT', {'preference': 'disliked'})
    exported = job('/api/exports/dislikes', {'mediaIds': [media_id]})
    content, _ = request(exported['contentUrl'], raw=True)
    assert json.loads(content)['path'].startswith('/media/collection/')
    stop()
    checks.append({'name': 'unavailable source cached browsing and path-only export', 'passed': True})

    docker('volume', 'create', restored)
    volumes.append(restored)
    docker('run', '--rm', '-v', f'{restored}:/data', '-v', f'{artifacts}:/backup:ro',
           'alpine', 'tar', '-xzf', '/backup/staging-backup.tgz', '-C', '/data')
    start('luma:gate7-staging', restored)
    wait_ready(11)
    verify_saved(media_id, tag['id'], True)
    stop()
    checks.append({'name': 'consistent backup restored into fresh volume', 'passed': True})
    result['imageId'] = docker('image', 'inspect', 'luma:gate7-staging', '--format', '{{.Id}}')
    result['passed'] = True
except Exception as error:
    result['passed'] = False
    result['failure'] = str(error)
    if name in containers:
        result['containerLogs'] = docker('logs', '--tail', '100', name)
    raise
finally:
    result['commands'] = commands
    for container in containers:
        docker('rm', '-f', container)
    for data_volume in volumes:
        docker('volume', 'rm', data_volume)
    (artifacts / 'results.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps({'passed': result.get('passed'), 'checks': checks, 'artifact': str(artifacts / 'results.json')}, indent=2))

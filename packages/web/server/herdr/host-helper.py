"""Fixed host operation helper. Request values are data, never shell source."""
import base64
import codecs
import ctypes
import errno
import fcntl
import hashlib
import json
import mimetypes
import os
import re
import selectors
import signal
import shutil
import socket
import stat
import subprocess
import sys
import time
import threading
import uuid

MAX_FILE = 8 * 1024 * 1024
MAX_OUTPUT = 16 * 1024 * 1024
changed = False
asset_started = False
asset_deadline_at = None


def stop_helper(signum, frame):
    raise SystemExit(128 + signum)


signal.signal(signal.SIGTERM, stop_helper)
signal.signal(signal.SIGHUP, stop_helper)


class Failure(Exception):
    def __init__(self, status, code, message):
        self.status, self.code, self.message = status, code, message


def fail(status, code, message):
    raise Failure(status, code, message)


def command(argv, env=None, limit=MAX_OUTPUT, cwd_fd=None):
    process = subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env, start_new_session=True, preexec_fn=(lambda: os.fchdir(cwd_fd)) if cwd_fd is not None else None)
    streams = selectors.DefaultSelector()
    streams.register(process.stdout, selectors.EVENT_READ)
    streams.register(process.stderr, selectors.EVENT_READ)
    output, errors, consumed = bytearray(), bytearray(), 0
    deadline = time.monotonic() + 10
    try:
        while streams.get_map():
            if time.monotonic() > deadline:
                fail(504, 'host_timeout', 'The host operation timed out')
            for key, _ in streams.select(0.2):
                chunk = os.read(key.fileobj.fileno(), 65536)
                if not chunk:
                    streams.unregister(key.fileobj)
                    continue
                consumed += len(chunk)
                if consumed > limit:
                    fail(413, 'host_output_too_large', 'The host operation exceeds its output limit')
                (output if key.fileobj is process.stdout else errors).extend(chunk)
        return process.wait(timeout=1), bytes(output), bytes(errors)
    finally:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.wait(timeout=1)
        streams.close()
        process.stdout.close()
        process.stderr.close()


def remote_socket(session):
    env = dict(os.environ)
    for key in ['HERDR_SOCKET_PATH', 'HERDR_CLIENT_SOCKET_PATH', 'HERDR_SESSION', 'HERDR_PANE_ID', 'HERDR_TAB_ID', 'HERDR_WORKSPACE_ID']:
        env.pop(key, None)
    binary = env.get('HERDR_BIN_PATH') or shutil.which('herdr')
    if not binary:
        fail(501, 'remote_herdr_unavailable', 'Remote Herdr is unavailable')
    code, output, _ = command([binary, '--session', session, 'status', 'server', '--json'], env, 65536)
    if code:
        fail(501, 'remote_herdr_unavailable', 'Remote Herdr session is unavailable')
    status = json.loads(output)
    sessions = [None, 'default'] if session == 'default' else [session]
    sock = status.get('socket')
    if status.get('running') is not True or status.get('compatible') is not True or status.get('endpoint_compatible') is not True or type(status.get('protocol')) is not int or status['protocol'] != 22 or status.get('session') not in sessions or not isinstance(sock, str) or not os.path.isabs(sock):
        fail(501, 'remote_herdr_unavailable', 'Remote Herdr session could not be verified')
    return sock


def pane_root(sock, pane_id, terminal_id=None):
    request_id = str(uuid.uuid4())
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
        connection.settimeout(10)
        connection.connect(sock)
        connection.sendall((json.dumps({'id': request_id, 'method': 'session.snapshot', 'params': {}}) + '\n').encode())
        with connection.makefile('rb') as stream:
            consumed = 0
            while True:
                line = stream.readline(MAX_OUTPUT + 1 - consumed)
                consumed += len(line)
                if not line or consumed > MAX_OUTPUT or not line.endswith(b'\n'):
                    fail(502, 'herdr_unavailable', 'Herdr did not return a complete snapshot')
                response = json.loads(line)
                if response.get('id') != request_id:
                    continue
                if 'error' in response:
                    fail(502, 'herdr_unavailable', 'Herdr refused the snapshot request')
                panes = response.get('result', {}).get('snapshot', {}).get('panes')
                if not isinstance(panes, list):
                    fail(502, 'herdr_unavailable', 'Herdr returned an invalid snapshot')
                pane = next((item for item in panes if item.get('pane_id') == pane_id), None)
                if pane is None:
                    fail(404, 'pane_not_found', 'This pane is no longer available')
                if terminal_id is not None:
                    actual_terminal = pane.get('terminal_id')
                    if not isinstance(actual_terminal, str) or not actual_terminal:
                        fail(422, 'terminal_unavailable', 'Herdr has not reported the pane terminal')
                    if actual_terminal != terminal_id:
                        fail(409, 'target_changed', 'The pane terminal changed. Open the file again')
                cwd = pane.get('foreground_cwd') or pane.get('cwd')
                if not isinstance(cwd, str) or not os.path.isabs(cwd):
                    fail(422, 'cwd_unavailable', 'Herdr has not reported a working directory')
                root = os.path.realpath(cwd)
                if not os.path.isdir(root):
                    fail(422, 'directory_unavailable', 'The pane working directory is unavailable')
                return root


def parts(value, empty=False):
    if not isinstance(value, str) or len(value) > 4096 or '\0' in value or os.path.isabs(value):
        fail(403, 'path_forbidden', 'Choose a path inside this pane')
    names = [p for p in value.split('/') if p and p != '.']
    if any(p == '..' or p.casefold() == '.git' for p in names) or (not empty and not names):
        fail(403, 'path_forbidden', 'Choose a path inside this pane')
    return names


def parent(root_fd, value):
    names = parts(value)
    fd = os.dup(root_fd)
    try:
        for name in names[:-1]:
            next_fd = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = next_fd
        return fd, names[-1]
    except Exception:
        os.close(fd)
        raise


def open_path(root_fd, value, directory=False):
    names = parts(value, empty=True)
    fd = os.dup(root_fd)
    try:
        for i, name in enumerate(names):
            flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK
            if i < len(names) - 1 or directory:
                flags |= os.O_DIRECTORY
            next_fd = os.open(name, flags, dir_fd=fd)
            os.close(fd)
            fd = next_fd
        return fd
    except Exception:
        os.close(fd)
        raise


def read_file(root_fd, value):
    fd = open_path(root_fd, value)
    with os.fdopen(fd, 'rb') as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode):
            fail(422, 'not_file', 'Choose a regular file')
        if info.st_size > MAX_FILE:
            fail(413, 'file_too_large', 'Files are limited to 8 MiB')
        data = stream.read(MAX_FILE + 1)
        if len(data) > MAX_FILE:
            fail(413, 'file_too_large', 'Files are limited to 8 MiB')
        return data, hashlib.sha256(data).hexdigest(), info


def asset_deadline(signum, frame):
    fail(504, 'asset_timeout', 'The asset host stopped making progress')


def check_asset_deadline():
    if asset_deadline_at is not None and time.monotonic() >= asset_deadline_at:
        fail(504, 'asset_timeout', 'The file read exceeded its maximum lifetime')


def watch_asset_input():
    # SSH closes this pipe on disconnect. The main thread owns descriptor and
    # subprocess cleanup, including a status command interrupted during setup.
    try:
        os.read(sys.stdin.fileno(), 1)
    except OSError:
        pass
    os.kill(os.getpid(), signal.SIGTERM)


def asset_write(data):
    view = memoryview(data)
    with selectors.DefaultSelector() as ready:
        ready.register(sys.stdout.fileno(), selectors.EVENT_WRITE)
        while view:
            check_asset_deadline()
            for _, _events in ready.select(0.2):
                try:
                    count = os.write(sys.stdout.fileno(), view)
                    view = view[count:]
                except BlockingIOError:
                    continue


def asset_stat_version(root_info, file_info):
    values = [root_info.st_dev, root_info.st_ino, file_info.st_dev, file_info.st_ino,
              file_info.st_size, file_info.st_mtime_ns, file_info.st_ctime_ns]
    return 'stat-v1:' + hashlib.sha256(json.dumps(values, separators=(',', ':')).encode()).hexdigest()


def asset_operation(request, payload):
    global asset_started, asset_deadline_at
    asset_deadline_at = time.monotonic() + 3600
    signal.signal(signal.SIGALRM, asset_deadline)
    signal.setitimer(signal.ITIMER_REAL, 30)
    streaming = payload.get('assetStream') is True
    if streaming:
        threading.Thread(target=watch_asset_input, daemon=True).start()
    sock = payload.get('socketPath') or remote_socket(payload['session'])
    root = pane_root(sock, request['pane_id'], request['terminal_id'])
    if root != request['expectedRoot']:
        fail(409, 'target_changed', 'The pane directory changed. Open the file again')
    value = request['path']
    if not isinstance(value, str) or any(ord(character) < 32 or ord(character) == 127 or character == '\\' for character in value):
        fail(403, 'path_forbidden', 'Choose a path inside this pane')
    value = '/'.join(parts(value))
    root_fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        root_info = os.fstat(root_fd)
        fd = open_path(root_fd, value)
        try:
            info = os.fstat(fd)
            if not stat.S_ISREG(info.st_mode):
                fail(422, 'not_file', 'Choose a regular file')
            if info.st_size < 0 or info.st_size > 9007199254740991:
                fail(413, 'asset_too_large', 'The file size cannot be represented safely')
            version = asset_stat_version(root_info, info)
            if request.get('expectedAssetVersion', version) != version:
                fail(409, 'asset_changed', 'The file changed. Open it again')
            sample = os.pread(fd, min(info.st_size, 8192), 0)
            try:
                if b'\0' in sample:
                    raise UnicodeError()
                codecs.getincrementaldecoder('utf-8')().decode(sample, final=len(sample) == info.st_size)
                sample_kind = 'text'
            except UnicodeError:
                sample_kind = 'binary'
            metadata = {'root': root, 'path': value, 'terminal_id': request['terminal_id'],
                        'assetVersion': version, 'bytes': info.st_size, 'sampleKind': sample_kind}

            def verify():
                if pane_root(sock, request['pane_id'], request['terminal_id']) != root:
                    fail(409, 'target_changed', 'The pane directory changed. Open the file again')
                current_root = os.stat(root, follow_symlinks=False)
                if (current_root.st_dev, current_root.st_ino) != (root_info.st_dev, root_info.st_ino):
                    fail(409, 'target_changed', 'The pane directory was replaced. Open the file again')
                if asset_stat_version(root_info, os.fstat(fd)) != version:
                    fail(409, 'asset_changed', 'The file changed while reading')

            start, length = 0, 0
            if request['operation'] == 'files.raw' and not payload.get('headOnly', False):
                span = payload.get('range')
                if span is None:
                    length = info.st_size
                else:
                    start, end = span.get('start'), span.get('end')
                    if type(start) is not int or type(end) is not int or start < 0 or end < start or end >= info.st_size:
                        fail(416, 'invalid_asset_range', 'The requested file range is unavailable')
                    length = end - start + 1
            verify()
            if request['operation'] == 'files.describe' and not streaming:
                verify()
                print(json.dumps({'result': metadata}, ensure_ascii=True))
                return
            os.set_blocking(sys.stdout.fileno(), False)
            asset_started = True
            asset_write((json.dumps({'metadata': metadata, 'length': length}, ensure_ascii=True) + '\n').encode())
            signal.setitimer(signal.ITIMER_REAL, 0)
            offset, remaining = start, length
            while remaining:
                check_asset_deadline()
                signal.setitimer(signal.ITIMER_REAL, 30)
                chunk = os.pread(fd, min(65536, remaining), offset)
                signal.setitimer(signal.ITIMER_REAL, 0)
                if not chunk:
                    fail(409, 'asset_changed', 'The file changed while reading')
                asset_write(chunk)
                offset += len(chunk)
                remaining -= len(chunk)
            signal.setitimer(signal.ITIMER_REAL, 30)
            verify()
            signal.setitimer(signal.ITIMER_REAL, 0)
            asset_write(b'{"complete":true}\n')
        finally:
            os.close(fd)
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        os.close(root_fd)


def expected_file(parent_fd, name, expected):
    try:
        data, revision, info = read_file(parent_fd, name)
        if expected != revision:
            fail(409, 'file_conflict', 'The file changed. Reload it before editing')
        return info
    except FileNotFoundError:
        if expected is not None:
            fail(409, 'file_conflict', 'The file was removed. Reload before editing')
        return None



def same_directory(left, right):
    return left.st_dev == right.st_dev and left.st_ino == right.st_ino


def verify_parent(root, root_fd, parent_fd, value):
    # flock only serializes this helper's writers. Other editors may rename directories.
    try:
        root_info = os.stat(root, follow_symlinks=False)
        if not stat.S_ISDIR(root_info.st_mode) or not same_directory(root_info, os.fstat(root_fd)):
            fail(409, 'directory_changed', 'The pane directory changed. Reload before making changes')
        current_fd = open_path(root_fd, '/'.join(parts(value)[:-1]), True)
        try:
            if not same_directory(os.fstat(current_fd), os.fstat(parent_fd)):
                fail(409, 'directory_changed', 'A parent folder changed. Reload before making changes')
        finally:
            os.close(current_fd)
    except OSError:
        fail(409, 'directory_changed', 'A parent folder changed. Reload before making changes')


def rename_noreplace(old_fd, old_name, new_fd, new_name):
    libc = ctypes.CDLL(None, use_errno=True)
    if sys.platform == 'darwin':
        result = libc.renameatx_np(old_fd, old_name.encode(), new_fd, new_name.encode(), 4)
    elif hasattr(libc, 'renameat2'):
        result = libc.renameat2(old_fd, old_name.encode(), new_fd, new_name.encode(), 1)
    else:
        fail(501, 'atomic_rename_unavailable', 'This host cannot rename without overwriting')
    if result:
        error = ctypes.get_errno()
        raise OSError(error, os.strerror(error))


def files(root, root_fd, request):
    global changed
    op, value = request['operation'], request.get('path', '')
    result = {'root': root, 'path': value}
    if op == 'files.list':
        fd = open_path(root_fd, value, True)
        try:
            entries = []
            truncated = False
            with os.scandir(fd) as scan:
                for entry in scan:
                    name = entry.name
                    if name in ['.git', 'node_modules']:
                        continue
                    if len(entries) >= 500:
                        truncated = True
                        break
                    info = entry.stat(follow_symlinks=False)
                    entries.append({'name': name, 'path': '/'.join(parts(value, True) + [name]), 'isDirectory': stat.S_ISDIR(info.st_mode), 'size': info.st_size, 'modifiedTime': info.st_mtime * 1000, 'isSymbolicLink': stat.S_ISLNK(info.st_mode)})
            entries.sort(key=lambda item: (not item['isDirectory'], item['name']))
            return dict(result, directory=value, entries=entries, truncated=truncated)
        finally:
            os.close(fd)
    if op == 'files.stat':
        fd = open_path(root_fd, value)
        try:
            info = os.fstat(fd)
            return dict(result, isFile=stat.S_ISREG(info.st_mode), isDirectory=stat.S_ISDIR(info.st_mode), size=info.st_size, mtimeMs=info.st_mtime * 1000)
        finally:
            os.close(fd)
    if op in ['files.read', 'files.binary', 'files.download']:
        data, revision, _ = read_file(root_fd, value)
        if op == 'files.read':
            try:
                content = data.decode('utf-8')
            except UnicodeDecodeError:
                fail(422, 'binary_file', 'This file is not UTF-8 text')
            if '\0' in content:
                fail(422, 'binary_file', 'This file contains binary data')
            return dict(result, content=content, bytes=len(data), revision=revision)
        encoded = base64.b64encode(data).decode('ascii')
        mime = mimetypes.guess_type(value)[0] or 'application/octet-stream'
        if op == 'files.binary':
            return dict(result, dataUrl='data:' + mime + ';base64,' + encoded, bytes=len(data), revision=revision)
        return dict(result, base64=encoded, mime=mime, bytes=len(data), revision=revision)
    if op == 'files.search':
        start = '/'.join(parts(value, True))
        queue, matches, visited, consumed = [start], [], 0, 0
        deadline = time.monotonic() + 5
        while queue:
            if visited >= 5000 or consumed > 16 * 1024 * 1024 or time.monotonic() > deadline:
                return {'root': root, 'results': matches, 'truncated': True}
            directory = queue.pop(0)
            fd = open_path(root_fd, directory, True)
            try:
                scan = os.scandir(fd)
                try:
                    names = []
                    for entry in scan:
                        if visited + len(names) >= 5000:
                            return {'root': root, 'results': matches, 'truncated': True}
                        names.append(entry.name)
                finally:
                    scan.close()
                for name in sorted(names):
                    visited += 1
                    if consumed > 16 * 1024 * 1024 or time.monotonic() > deadline:
                        return {'root': root, 'results': matches, 'truncated': True}
                    if name in ['.git', 'node_modules'] or (name.startswith('.') and not request['includeHidden']):
                        continue
                    entry = '/'.join(filter(None, [directory, name]))
                    info = os.stat(name, dir_fd=fd, follow_symlinks=False)
                    if stat.S_ISDIR(info.st_mode):
                        queue.append(entry)
                    elif stat.S_ISREG(info.st_mode):
                        preview = []
                        if info.st_size <= 256 * 1024:
                            data, _, _ = read_file(root_fd, entry)
                            consumed += len(data)
                            try:
                                text = data.decode('utf-8')
                                if '\0' not in text:
                                    preview = [line[:500] for line in text.splitlines() if request['query'].casefold() in line.casefold()][:3]
                            except UnicodeDecodeError:
                                pass
                        if request['query'].casefold() in name.casefold() or preview:
                            matches.append({'path': entry, 'preview': preview})
                            if len(matches) >= request['maxResults']:
                                return {'root': root, 'results': matches, 'truncated': True}
            finally:
                os.close(fd)
        return {'root': root, 'results': matches, 'truncated': False}
    fd, name = parent(root_fd, value)
    try:
        if op in ['files.write', 'files.upload']:
            data = request['content'].encode('utf-8') if op == 'files.write' else base64.b64decode(request['base64'], validate=True)
            if len(data) > MAX_FILE:
                fail(413, 'file_too_large', 'Files are limited to 8 MiB')
            info = expected_file(fd, name, request['expectedRevision'])
            verify_parent(root, root_fd, fd, value)
            temporary = '.openherdr-write-' + uuid.uuid4().hex
            temporary_fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=fd)
            try:
                with os.fdopen(temporary_fd, 'wb') as stream:
                    stream.write(data)
                    stream.flush()
                    if info:
                        os.fchmod(stream.fileno(), stat.S_IMODE(info.st_mode))
                    os.fsync(stream.fileno())
                expected_file(fd, name, request['expectedRevision'])
                verify_parent(root, root_fd, fd, value)
                changed = True
                if info:
                    os.replace(temporary, name, src_dir_fd=fd, dst_dir_fd=fd)
                else:
                    rename_noreplace(fd, temporary, fd, name)
                os.fsync(fd)
            finally:
                try:
                    os.unlink(temporary, dir_fd=fd)
                except FileNotFoundError:
                    pass
            return dict(result, success=True, revision=hashlib.sha256(data).hexdigest())
        if op == 'files.mkdir':
            verify_parent(root, root_fd, fd, value)
            changed = True
            os.mkdir(name, 0o755, dir_fd=fd)
            return dict(result, success=True)
        info = os.stat(name, dir_fd=fd, follow_symlinks=False)
        if stat.S_ISLNK(info.st_mode):
            fail(403, 'path_forbidden', 'Links cannot be changed through this operation')
        if stat.S_ISREG(info.st_mode):
            expected_file(fd, name, request['expectedRevision'])
        elif request['expectedRevision'] is not None:
            fail(409, 'file_conflict', 'The path is no longer a regular file')
        if op == 'files.delete':
            verify_parent(root, root_fd, fd, value)
            changed = True
            if stat.S_ISDIR(info.st_mode):
                os.rmdir(name, dir_fd=fd)
            elif stat.S_ISREG(info.st_mode):
                os.unlink(name, dir_fd=fd)
            else:
                fail(422, 'not_file', 'Choose a file or an empty folder')
            return dict(result, success=True)
        if op == 'files.rename':
            new_fd, new_name = parent(root_fd, request['newPath'])
            try:
                verify_parent(root, root_fd, fd, value)
                verify_parent(root, root_fd, new_fd, request['newPath'])
                changed = True
                rename_noreplace(fd, name, new_fd, new_name)
                return dict(result, path=request['newPath'], success=True)
            finally:
                os.close(new_fd)
        fail(403, 'operation_forbidden', 'This host operation is unavailable')
    finally:
        os.close(fd)



def metadata_path(base, relative):
    names = relative.split('/')
    if any(not name or name in ['.', '..'] for name in names):
        fail(403, 'git_metadata_mismatch', 'Git metadata contains an invalid path')
    current = base
    for index, name in enumerate(names):
        current = os.path.join(current, name)
        try:
            info = os.lstat(current)
        except FileNotFoundError:
            return
        if stat.S_ISLNK(info.st_mode) or (index < len(names) - 1 and not stat.S_ISDIR(info.st_mode)):
            fail(403, 'git_metadata_mismatch', 'Git metadata cannot redirect through symbolic links')


def verify_git_write_paths(git_directory, common_directory, current_ref, request):
    leaves = ['index', 'HEAD', 'ORIG_HEAD', 'packed-refs', 'COMMIT_EDITMSG', 'MERGE_HEAD', 'MERGE_MSG', 'AUTO_MERGE']
    for base in set([git_directory, common_directory]):
        for leaf in leaves:
            metadata_path(base, leaf)
            metadata_path(base, leaf + '.lock')
        metadata_path(base, 'refs')
        metadata_path(base, 'logs')
    for suffix in ['objects', 'objects/pack', 'objects/info'] + ['objects/' + format(i, '02x') for i in range(256)]:
        metadata_path(common_directory, suffix)
    refs = [current_ref] if current_ref else []
    for name in [request.get('name'), request.get('branch'), request.get('startPoint')]:
        if name:
            refs.append('refs/heads/' + name)
    for reference in refs:
        if not reference.startswith('refs/'):
            fail(403, 'git_metadata_mismatch', 'Git HEAD does not name a repository reference')
        for base in set([git_directory, common_directory]):
            for relative in [reference, reference + '.lock', 'logs/' + reference, 'logs/' + reference + '.lock', 'logs/HEAD', 'logs/HEAD.lock']:
                metadata_path(base, relative)


def untracked_diff(root_fd, value):
    data, _, info = read_file(root_fd, value)
    try:
        content = data.decode('utf-8')
    except UnicodeDecodeError:
        fail(422, 'binary_file', 'This file is not UTF-8 text')
    if '\0' in content:
        fail(422, 'binary_file', 'This file contains binary data')

    def quote_path(path):
        escaped = ''.join('\\' + chr(byte) if byte in [34, 92] else chr(byte) if 32 <= byte < 127 else '\\' + format(byte, '03o') for byte in path.encode('utf-8'))
        return '"' + escaped + '"' if escaped != path else path

    before, after = quote_path('a/' + value), quote_path('b/' + value)
    mode = '100755' if info.st_mode & 0o100 else '100644'
    diff = 'diff --git ' + before + ' ' + after + '\nnew file mode ' + mode + '\n'
    if content:
        count = content.count('\n') + (0 if content.endswith('\n') else 1)
        body = '+' + content.replace('\n', '\n+')
        body = body[:-1] if content.endswith('\n') else body + '\n\\ No newline at end of file\n'
        diff += '--- /dev/null\n+++ ' + after + '\n@@ -0,0 +1' + (',' + str(count) if count != 1 else '') + ' @@\n' + body
    if len(diff.encode('utf-8')) > MAX_OUTPUT:
        fail(413, 'host_output_too_large', 'The host operation exceeds its output limit')
    return diff


def git(root, root_fd, request):
    global changed
    env = {key: value for key, value in os.environ.items() if not key.startswith('GIT_')}
    env.update({'GIT_OPTIONAL_LOCKS': '0', 'GIT_TERMINAL_PROMPT': '0', 'GIT_LITERAL_PATHSPECS': '1', 'GIT_CONFIG_NOSYSTEM': '1'})
    prefix = ['git', '-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'core.untrackedCache=false', '-c', 'gc.auto=0', '-c', 'maintenance.auto=false']

    def run(args, allow_failure=False):
        code, output, _ = command(prefix + args, env, cwd_fd=root_fd)
        if code and not allow_failure:
            fail(422, 'git_operation_failed', 'Git refused this operation. Check the repository and working changes')
        return code, output.decode('utf-8', errors='replace')

    # Metadata symlinks would let a repository redirect writes outside the selected checkout.
    try:
        if stat.S_ISLNK(os.stat('.git', dir_fd=root_fd, follow_symlinks=False).st_mode):
            fail(403, 'path_forbidden', 'Git metadata cannot be a symbolic link')
    except FileNotFoundError:
        pass
    # A parent repository would let the pane read or change files outside its root.
    code, repository = run(['rev-parse', '--show-toplevel'], True)
    if code:
        fail(422, 'not_git_repository', 'The pane directory is not a Git repository')
    if os.path.realpath(repository.strip()) != root:
        fail(403, 'git_root_mismatch', 'Select a pane at the repository root')
    # A .git file is valid only for a registered linked worktree with matching backlinks.
    _, git_directory = run(['rev-parse', '--absolute-git-dir'])
    _, common_directory = run(['rev-parse', '--git-common-dir'])
    git_directory = os.path.realpath(git_directory.strip())
    common_directory = os.path.realpath(os.path.join(root, common_directory.strip()))
    dotgit = os.path.join(root, '.git')
    try:
        metadata_info = os.stat('.git', dir_fd=root_fd, follow_symlinks=False)
        if stat.S_ISDIR(metadata_info.st_mode):
            if git_directory != dotgit or common_directory != dotgit:
                fail(403, 'git_metadata_mismatch', 'Git metadata does not belong to this pane checkout')
        elif stat.S_ISREG(metadata_info.st_mode):
            if os.path.dirname(git_directory) != os.path.join(common_directory, 'worktrees') or not os.path.isdir(common_directory):
                fail(403, 'git_metadata_mismatch', 'This checkout is not a registered linked worktree')
            with open(os.path.join(git_directory, 'gitdir'), 'r', encoding='utf-8') as stream:
                backlink = stream.read(8193).strip()
            with open(os.path.join(git_directory, 'commondir'), 'r', encoding='utf-8') as stream:
                commonlink = stream.read(8193).strip()
            dotgit_fd = os.open('.git', os.O_RDONLY | os.O_NOFOLLOW, dir_fd=root_fd)
            with os.fdopen(dotgit_fd, 'r', encoding='utf-8') as stream:
                forward = stream.read(8193).strip()
            if len(backlink) > 8192 or len(commonlink) > 8192 or len(forward) > 8192 or os.path.realpath(backlink) != dotgit or os.path.realpath(os.path.join(git_directory, commonlink)) != common_directory or not forward.startswith('gitdir: ') or os.path.realpath(os.path.join(root, forward[8:])) != git_directory:
                fail(403, 'git_metadata_mismatch', 'Linked worktree metadata does not point back to this checkout')
        else:
            fail(403, 'git_metadata_mismatch', 'Git metadata is not a regular file or directory')
    except OSError:
        fail(403, 'git_metadata_mismatch', 'Git metadata could not be verified for this checkout')
    storage_code, storage = run(['config', '--get', 'extensions.refStorage'], True)
    if storage_code not in [0, 1] or (storage.strip() and storage.strip() != 'files'):
        fail(501, 'git_ref_storage_unavailable', 'This Git reference storage is unavailable through the host API')
    head_code, head_ref = run(['symbolic-ref', '--quiet', 'HEAD'], True)
    if head_code not in [0, 1]:
        fail(403, 'git_metadata_mismatch', 'Git HEAD could not be verified')
    verify_git_write_paths(git_directory, common_directory, head_ref.strip() if head_code == 0 else None, request)
    op = request['operation']
    # Even status and diff may invoke a clean filter while comparing working files.
    # Keep the entire host Git contract free of repository-authored process execution.
    filter_code, filters = run(['config', '--get-regexp', '^filter\\..*\\.(clean|smudge|process)$'], True)
    if filter_code not in [0, 1]:
        fail(422, 'git_operation_failed', 'Git could not inspect repository filters')
    if filters.strip():
        fail(501, 'git_filters_require_trust', 'This repository uses executable Git filters. Use its terminal for Git operations')
    if op == 'git.status':
        _, raw = run(['status', '--porcelain=v1', '-z', '--untracked-files=all'])
        entries, index = raw.split('\0'), 0
        files_list = []
        while index < len(entries):
            row = entries[index]
            index += 1
            if not row:
                continue
            files_list.append({'path': row[3:], 'index': row[0], 'working_dir': row[1]})
            if row[0] in ['R', 'C'] or row[1] in ['R', 'C']:
                index += 1
        _, branch = run(['branch', '--show-current'])
        _, upstream = run(['for-each-ref', '--format=%(upstream:short)', 'refs/heads/' + branch.strip()])
        ahead, behind = 0, 0
        if upstream.strip():

            _, counts = run(['rev-list', '--left-right', '--count', 'HEAD...@{upstream}', '--'])
            ahead, behind = map(int, counts.split())
        return {'root': root, 'current': branch.strip(), 'tracking': upstream.strip() or None, 'ahead': ahead, 'behind': behind, 'files': files_list, 'isClean': not files_list}
    if op == 'git.diff':
        paths = []
        if request.get('path'):
            value = '/'.join(parts(request['path']))
            paths = [request['path']]
            if not request['staged']:
                _, untracked = run(['ls-files', '--others', '--exclude-standard', '--directory', '-z', '--', value])
                if value in untracked.split('\0'):
                    return {'root': root, 'diff': untracked_diff(root_fd, value)}
        _, diff = run(['diff', '--no-ext-diff', '--no-textconv', '--no-color'] + (['--cached'] if request['staged'] else []) + ['--'] + paths)
        return {'root': root, 'diff': diff}
    if op == 'git.log':
        code, head = run(['rev-parse', '--verify', 'HEAD'], True)
        if code:
            symbolic_code, symbolic = run(['symbolic-ref', '--quiet', 'HEAD'], True)
            if symbolic_code == 0:
                reference_code, _ = run(['show-ref', '--verify', '--quiet', symbolic.strip()], True)
                if reference_code == 1:
                    return {'root': root, 'all': [], 'latest': None, 'total': 0}
            fail(422, 'git_operation_failed', 'Git could not read this repository history')
        _, records = run(['log', '-'+str(request['limit']), '--format=%H%x00%cI%x00%s%x00%D%x00%b%x00%an%x00%ae%x00%P%x00', '-z', '--'])
        fields = records.split('\0')
        commits = []
        while fields and fields[0].strip():
            values, fields = fields[:8], fields[9:]
            if len(values) != 8:
                fail(502, 'invalid_git_output', 'Git returned an invalid history record')
            commit, date, message, refs, body, author, email, parents = values
            _, stats = run(['show', '--no-ext-diff', '--no-textconv', '--format=', '--numstat', '-z', '--no-renames', commit, '--'])
            changed_files = insertions = deletions = 0
            for entry in stats.split('\0'):
                if not entry:
                    continue
                numbers = entry.split('\t', 2)
                if len(numbers) == 3:
                    changed_files += 1
                    if numbers[0].isdigit(): insertions += int(numbers[0])
                    if numbers[1].isdigit(): deletions += int(numbers[1])
            commits.append({'hash': commit.strip(), 'date': date, 'message': message, 'refs': refs, 'body': body, 'author_name': author, 'author_email': email, 'parents': parents.split(), 'filesChanged': changed_files, 'insertions': insertions, 'deletions': deletions})
        _, total = run(['rev-list', '--count', 'HEAD', '--'])
        return {'root': root, 'all': commits, 'latest': commits[0] if commits else None, 'total': int(total)}
    if op == 'git.branches':
        _, raw = run(['for-each-ref', '--format=%(refname:short)%00%(objectname)%00%(HEAD)%00%(worktreepath)', 'refs/heads/'])
        branches, current = {}, ''
        for row in raw.splitlines():
            name, commit, head, worktree = row.split('\0')
            branches[name] = {'current': head == '*', 'name': name, 'commit': commit, 'label': name, 'linkedWorktree': bool(worktree) and os.path.realpath(worktree) != root}
            if head == '*': current = name
        return {'root': root, 'current': current, 'all': list(branches), 'branches': branches}
    if op in ['git.stage', 'git.unstage']:
        for value in request['paths']:
            parts(value)
            # Reject symlinked parent directories, including outside paths.
            fd, _ = parent(root_fd, value)
            os.close(fd)
        changed = True
        if op == 'git.stage':
            run(['add', '--'] + request['paths'])
        else:
            code, _ = run(['rev-parse', '--verify', 'HEAD'], True)
            run((['rm', '--cached', '--ignore-unmatch', '--'] if code else ['reset', '-q', 'HEAD', '--']) + request['paths'])
        return {'root': root, 'success': True}
    if op == 'git.commit':
        changed = True
        run(['commit', '--no-verify', '--no-gpg-sign', '-m', request['message'], '--'])
        _, commit = run(['rev-parse', 'HEAD'])
        _, branch = run(['branch', '--show-current'])
        _, stats = run(['show', '--no-ext-diff', '--no-textconv', '--format=', '--numstat', '-z', '--no-renames', 'HEAD', '--'])
        changes = insertions = deletions = 0
        for row in stats.split('\0'):
            values = row.split('\t', 2)
            if len(values) == 3:
                changes += 1
                if values[0].isdigit(): insertions += int(values[0])
                if values[1].isdigit(): deletions += int(values[1])
        return {'root': root, 'success': True, 'commit': commit.strip(), 'branch': branch.strip(), 'summary': {'changes': changes, 'insertions': insertions, 'deletions': deletions}}
    if op in ['git.branch', 'git.checkout']:
        name = request.get('name') if op == 'git.branch' else request['branch']
        run(['check-ref-format', '--branch', name])
        changed = True
        if op == 'git.branch':
            run(['branch', '--', name] + ([request['startPoint']] if request.get('startPoint') else []))
        else:
            run(['checkout', '--no-guess', name, '--'])
        return {'root': root, 'success': True, 'branch': name}
    fail(403, 'operation_forbidden', 'This Git operation is unavailable')


def main():
    payload = json.loads(sys.stdin.buffer.readline(16 * 1024 * 1024 + 1))
    request = payload['request']
    if request['operation'] in ['files.describe', 'files.raw']:
        return asset_operation(request, payload)
    sock = payload.get('socketPath') or remote_socket(payload['session'])
    root = pane_root(sock, request['pane_id'])
    if 'expectedRoot' in request and request['expectedRoot'] != root:
        fail(409, 'target_changed', 'The pane directory changed. Reload before making changes')
    fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX if 'expectedRoot' in request else fcntl.LOCK_SH)
        if 'expectedRoot' in request and pane_root(sock, request['pane_id']) != root:
            fail(409, 'target_changed', 'The pane directory changed. Reload before making changes')
        result = files(root, fd, request) if request['operation'].startswith('files.') else git(root, fd, request)
        print(json.dumps({'result': result}, ensure_ascii=True))
    finally:
        os.close(fd)


try:
    main()
except Failure as error:
    if asset_started:
        sys.exit(1)
    print(json.dumps({'error': {'status': error.status, 'code': error.code, 'message': error.message, 'confirmedNoEffect': not changed}}))
except OSError as error:
    if asset_started:
        sys.exit(1)
    code = {errno.ENOENT: (404, 'file_not_found', 'The file or directory is unavailable'), errno.ELOOP: (403, 'path_forbidden', 'Links cannot leave the pane directory'), errno.ENOTDIR: (403, 'path_forbidden', 'A path component is not a regular directory'), errno.EEXIST: (409, 'path_exists', 'The destination already exists'), errno.ENOTEMPTY: (409, 'directory_not_empty', 'Only empty folders can be deleted'), errno.EACCES: (403, 'permission_denied', 'The host denied file access'), errno.EPERM: (403, 'permission_denied', 'The host denied this operation')}.get(error.errno, (502, 'host_unavailable', 'The host operation could not complete'))
    print(json.dumps({'error': {'status': code[0], 'code': code[1], 'message': code[2], 'confirmedNoEffect': not changed}}))
except Exception:
    if asset_started:
        sys.exit(1)
    print(json.dumps({'error': {'status': 502, 'code': 'host_unavailable', 'message': 'The host operation could not complete', 'confirmedNoEffect': not changed}}))

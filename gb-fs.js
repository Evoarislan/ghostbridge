// gb-fs.js
//
// Host-side implementation of the PhantomJS `fs` module. The runtime page
// has no filesystem of its own: every fs call in gb-runtime is a blocking
// sync-channel round trip (op 'fs') that lands here.
//
// Relative paths resolve against `base`, which starts as the running
// script's directory and changes only via changeWorkingDirectory.
// workingDirectory reports the process cwd until changeWorkingDirectory is
// called, then the new base.
//
// Streams: 'r'/'rb' read, 'w'/'wb' truncate+write, 'a'/'ab' append. The
// binary modes are aliases of the text modes (UTF-8 strings, no byte
// arrays). Opening a missing file for read throws.

const fs = require('fs');
const path = require('path');

function createFsHost(scriptDir) {
  let base = scriptDir;
  let cwdChanged = false;
  const streams = new Map();
  let nextStream = 1;

  const abs = (p) => path.resolve(base, String(p));
  const test = (fn) => { try { return !!fn(); } catch { return false; } };
  const access = (p, mode) => test(() => (fs.accessSync(abs(p), mode), true));

  function rmTree(p) {
    fs.rmSync(p, { recursive: true, force: true });
  }

  const ops = {
    read: (p) => fs.readFileSync(abs(p), 'utf8'),
    write: (p, content, mode) => {
      const m = String(mode || 'w');
      const flag = m[0] === 'a' ? 'a' : 'w';
      fs.writeFileSync(abs(p), String(content), { flag });
    },
    exists: (p) => test(() => (fs.statSync(abs(p)), true)),
    isFile: (p) => test(() => fs.statSync(abs(p)).isFile()),
    isDirectory: (p) => test(() => fs.statSync(abs(p)).isDirectory()),
    isLink: (p) => test(() => fs.lstatSync(abs(p)).isSymbolicLink()),
    isReadable: (p) => access(p, fs.constants.R_OK),
    isWritable: (p) => access(p, fs.constants.W_OK),
    isExecutable: (p) => access(p, fs.constants.X_OK),
    list: (p) => ['.', '..'].concat(fs.readdirSync(abs(p)).sort()),
    remove: (p) => fs.unlinkSync(abs(p)),
    removeDirectory: (p) => fs.rmdirSync(abs(p)),
    removeTree: (p) => rmTree(abs(p)),
    makeDirectory: (p) => test(() => (fs.mkdirSync(abs(p)), true)),
    makeTree: (p) => test(() => (fs.mkdirSync(abs(p), { recursive: true }), true)),
    copy: (a, b) => fs.copyFileSync(abs(a), abs(b)),
    move: (a, b) => {
      try { fs.renameSync(abs(a), abs(b)); } catch (e) {
        if (e.code !== 'EXDEV') throw e;
        fs.copyFileSync(abs(a), abs(b));
        fs.unlinkSync(abs(a));
      }
    },
    touch: (p) => {
      const f = abs(p);
      const now = new Date();
      try { fs.utimesSync(f, now, now); } catch (e) {
        if (e.code !== 'ENOENT') throw e;
        fs.closeSync(fs.openSync(f, 'a'));
      }
    },
    size: (p) => fs.statSync(abs(p)).size,
    lastModified: (p) => fs.statSync(abs(p)).mtime.toISOString(),
    absolute: (p) => abs(p),
    workingDirectory: () => (cwdChanged ? base : process.cwd()),
    changeWorkingDirectory: (p) => {
      const d = abs(p);
      if (!test(() => fs.statSync(d).isDirectory())) return false;
      base = d;
      cwdChanged = true;
      return true;
    },

    // ---- streams (state lives in the host) ----
    open: (p, mode) => {
      const m = String(mode || 'r');
      const kind = m[0];
      if (kind !== 'r' && kind !== 'w' && kind !== 'a') throw new Error('fs.open: unsupported mode ' + m);
      const f = abs(p);
      const s = { kind, path: f, pos: 0 };
      if (kind === 'r') {
        s.content = fs.readFileSync(f, 'utf8'); // throws if missing
      } else {
        s.fd = fs.openSync(f, kind === 'w' ? 'w' : 'a');
      }
      const id = nextStream++;
      streams.set(id, s);
      return id;
    },
  };

  function stream(id) {
    const s = streams.get(id);
    if (!s) throw new Error('fs stream: closed or unknown stream');
    return s;
  }
  const sops = {
    read: (id, n) => {
      const s = stream(id);
      if (s.kind !== 'r') throw new Error('fs stream: not opened for reading');
      const end = n == null ? s.content.length : s.pos + n;
      const out = s.content.slice(s.pos, end);
      s.pos += out.length;
      return out;
    },
    readLine: (id) => {
      const s = stream(id);
      if (s.kind !== 'r') throw new Error('fs stream: not opened for reading');
      if (s.pos >= s.content.length) return '';
      let i = s.content.indexOf('\n', s.pos);
      let line;
      if (i === -1) { line = s.content.slice(s.pos); s.pos = s.content.length; }
      else { line = s.content.slice(s.pos, i); s.pos = i + 1; }
      return line.replace(/\r$/, '');
    },
    write: (id, data) => {
      const s = stream(id);
      if (s.kind === 'r') throw new Error('fs stream: not opened for writing');
      const buf = Buffer.from(String(data), 'utf8');
      if (s.kind === 'a') fs.writeSync(s.fd, buf);
      else { fs.writeSync(s.fd, buf, 0, buf.length, s.pos); s.pos += buf.length; }
    },
    writeLine: (id, data) => sops.write(id, String(data) + '\n'),
    seek: (id, pos) => {
      const s = stream(id);
      s.pos = Math.max(0, pos | 0);
    },
    atEnd: (id) => {
      const s = stream(id);
      return s.kind === 'r' ? s.pos >= s.content.length : true;
    },
    close: (id) => {
      const s = streams.get(id);
      if (!s) return;
      if (s.fd != null) fs.closeSync(s.fd);
      streams.delete(id);
    },
  };

  return {
    call(fn, args) {
      args = args || [];
      if (fn === 'stream') {
        const [sfn, id, ...rest] = args;
        if (!Object.prototype.hasOwnProperty.call(sops, sfn)) throw new Error('fs stream: unknown op ' + sfn);
        return sops[sfn](id, ...rest);
      }
      if (!Object.prototype.hasOwnProperty.call(ops, fn)) throw new Error('fs: unknown op ' + fn);
      return ops[fn](...args);
    },
    // Used by phantom.injectJs: script-dir/base first, then libraryPath.
    findInjectable(p, libraryPath) {
      const name = String(p);
      const cands = path.isAbsolute(name)
        ? [name]
        : [path.resolve(base, name)].concat((libraryPath || []).map((d) => path.resolve(d, name)));
      for (const c of cands) {
        if (test(() => fs.statSync(c).isFile())) return { filename: c, source: fs.readFileSync(c, 'utf8') };
      }
      return null;
    },
  };
}

module.exports = { createFsHost };

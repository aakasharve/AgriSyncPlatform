// Thin adb wrapper. Everything here talks to the ONE emulator started by the workflow.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const MAX = 64 * 1024 * 1024;

export function adb(args, { timeout = 60_000, allowFail = false } = {}) {
  try {
    return execFileSync('adb', args, { encoding: 'utf8', timeout, maxBuffer: MAX }).replace(/\r/g, '');
  } catch (e) {
    if (allowFail) return String((e.stdout || '') + (e.stderr || '')).replace(/\r/g, '');
    throw new Error(`adb ${args.join(' ')} failed: ${String(e.message).slice(0, 300)}`);
  }
}
export const sh = (cmd, opts) => adb(['shell', cmd], opts).trim();

export function screencap(file) {
  const buf = execFileSync('adb', ['exec-out', 'screencap', '-p'], { maxBuffer: MAX, timeout: 60_000 });
  fs.writeFileSync(file, buf);
  return buf.length;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- uiautomator
function attrs(tag) {
  const o = {};
  for (const m of tag.matchAll(/([\w-]+)="([^"]*)"/g)) o[m[1]] = m[2];
  return o;
}
export function parseNodes(xml) {
  return [...xml.matchAll(/<node\b[^>]*>/g)].map((m) => {
    const a = attrs(m[0]);
    const b = /\[(\d+),(\d+)\]\[(\d+),(\d+)\]/.exec(a.bounds || '');
    return {
      text: a.text || '', id: a['resource-id'] || '', pkg: a.package || '', desc: a['content-desc'] || '', cls: a.class || '',
      x: b ? Math.round((+b[1] + +b[3]) / 2) : 0, y: b ? Math.round((+b[2] + +b[4]) / 2) : 0,
    };
  });
}
export async function dumpUi() {
  let last = '';
  for (let i = 0; i < 4; i++) {
    const out = adb(['shell', 'uiautomator dump /sdcard/ci_window.xml'], { allowFail: true, timeout: 40_000 });
    last = out;
    const xml = adb(['shell', 'cat /sdcard/ci_window.xml'], { allowFail: true });
    if (xml.includes('<hierarchy')) return xml;
    await sleep(1500);
  }
  throw new Error('uiautomator dump failed: ' + last.slice(0, 200));
}

// A runtime-permission dialog is a window of the permission controller package.
export function permissionDialog(nodes) {
  const inCtl = nodes.filter((n) => /permissioncontroller|packageinstaller/i.test(n.pkg));
  if (!inCtl.length) return null;
  const allow = inCtl.find((n) => /permission_allow_foreground_only_button|permission_allow_button|permission_allow_one_time_button/.test(n.id))
    || inCtl.find((n) => /^(while using the app|allow)$/i.test(n.text));
  const message = inCtl.find((n) => /permission_message/.test(n.id));
  return { allow, message: message ? message.text : null, texts: inCtl.map((n) => n.text).filter(Boolean).slice(0, 12) };
}

export const tap = (x, y) => sh(`input tap ${x} ${y}`);
export const key = (code) => sh(`input keyevent ${code}`);
export const screenSize = () => {
  const m = /(\d+)x(\d+)/.exec(sh('wm size').split('\n').pop());
  return m ? { w: +m[1], h: +m[2] } : { w: 1080, h: 1920 };
};
export const imeShown = () => /mInputShown=true/.test(sh('dumpsys input_method', { allowFail: true }));
export const focusedWindow = () => (sh('dumpsys window', { allowFail: true, timeout: 40_000 }).match(/mCurrentFocus=.*$/m) || [''])[0];
export function resumedActivity() {
  const t = sh('dumpsys activity activities', { allowFail: true, timeout: 40_000 });
  return (t.match(/(?:ResumedActivity|mResumedActivity|topResumedActivity)[^\n]*/) || [''])[0];
}

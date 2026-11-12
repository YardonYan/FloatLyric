'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const on = (channel, cb) => {
  const handler = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('fl', {
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: patch => ipcRenderer.invoke('settings:set', patch)
  },
  ncm: {
    status: () => ipcRenderer.invoke('ncm:status'),
    state: () => ipcRenderer.invoke('ncm:state'),
    reconnect: () => ipcRenderer.invoke('ncm:reconnect'),
    launch: () => ipcRenderer.invoke('ncm:launch'),
    control: action => ipcRenderer.invoke('ncm:control', action)
  },
  lyrics: {
    current: () => ipcRenderer.invoke('lyrics:current'),
    refetch: () => ipcRenderer.invoke('lyrics:refetch'),
    fromText: raw => ipcRenderer.invoke('lyrics:fromText', raw)
  },
  pick: {
    start: () => ipcRenderer.invoke('pick:start'),
    sample: () => ipcRenderer.invoke('pick:sample'),
    commit: hex => ipcRenderer.invoke('pick:commit', hex),
    cancel: () => ipcRenderer.invoke('pick:cancel')
  },
  overlay: {
    bounds: b => ipcRenderer.invoke('overlay:bounds', b),
    toggle: () => ipcRenderer.invoke('overlay:toggle'),
    show: () => ipcRenderer.invoke('overlay:show')
  },
  panel: { show: () => ipcRenderer.invoke('panel:show'), hide: () => ipcRenderer.invoke('panel:hide') },
  app: { quit: () => ipcRenderer.invoke('app:quit'), version: () => ipcRenderer.invoke('app:version') },
  shell: { open: url => ipcRenderer.invoke('shell:open', url) },
  dev: {
    shot: out => ipcRenderer.invoke('dev:shot', out),
    sampleAt: at => ipcRenderer.invoke('dev:sampleAt', at)
  },
  on: {
    ncmState: cb => on('ncm:state', cb),
    ncmStatus: cb => on('ncm:status', cb),
    lyricsData: cb => on('lyrics:data', cb),
    lyricsLoading: cb => on('lyrics:loading', cb),
    settings: cb => on('settings:changed', cb),
    pickSample: cb => on('pick:sample', cb),
    pickPreview: cb => on('pick:preview', cb),
    pickStarted: cb => on('pick:started', cb),
    pickEnded: cb => on('pick:ended', cb)
  }
});